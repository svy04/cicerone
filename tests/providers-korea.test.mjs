#!/usr/bin/env node
// @ts-check
// providers/korea.test.mjs — 한국 공고 수집 모듈 검사.
//
// 착수 시 고정한 검사입니다.
//   1) 열쇠가 없으면 명확한 안내와 함께 멈춘다
//   2) 응답을 스캐너가 쓰는 모양으로 정확히 옮긴다
//   3) 마감된 공고를 걸러 낸다
//   4) 약관이 자동 수집을 금지한 플랫폼을 대상으로 하는 모듈이 없다
//   5) 지정하지 않은 회사를 훑지 않는다
//
// 네트워크를 쓰지 않습니다. 응답 표본은 공식 문서와 2026-08-21 실제 응답에서 가져왔습니다.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pass, fail } from './helpers.mjs';

import saramin, { normalizeSaraminJob } from '../providers/saramin.mjs';
import greeting, { extractNextData, findOpenings, normalizeOpening } from '../providers/greetinghr.mjs';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'providers');

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('동기 검사만 씁니다');
    pass(name);
  } catch (err) {
    fail(name + ' — ' + err.message);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name + ' — ' + err.message);
  }
}

console.log('\n한국 공고 수집 모듈 검사\n');

// ── 사람인 ───────────────────────────────────────────────────
// 사람인 공식 문서의 샘플 응답 (https://oapi.saramin.co.kr/guide/job-search)
const SARAMIN_SAMPLE = {
  url: 'http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27614114',
  active: 1,
  company: { detail: { href: 'http://example.com', name: '(주)사람인' } },
  position: {
    title: '(주)사람인 사무보조·문서작성 경력 채용합니다',
    location: { code: '101050', name: '서울 > 관악구' },
    'job-type': { code: '1', name: '정규직' },
    'experience-level': { code: 2, min: 2, max: 3, name: '경력 2~3년' },
  },
  id: '27614114',
  'posting-timestamp': '1559191564',
  'expiration-timestamp': '1561820399',
};

test('사람인: 공식 샘플 응답을 옮긴다', () => {
  const j = normalizeSaraminJob(SARAMIN_SAMPLE);
  assert.ok(j, '변환 결과가 없다');
  assert.equal(j.title, '(주)사람인 사무보조·문서작성 경력 채용합니다');
  assert.equal(j.company, '(주)사람인');
  assert.equal(j.location, '서울 > 관악구');
  assert.ok(j.url.startsWith('http'), '주소가 절대 경로가 아니다');
  assert.equal(j.postedAt, 1559191564 * 1000, '게시일이 밀리초로 변환되지 않았다');
});

test('사람인: 마감된 공고(active=0)를 걸러 낸다', () => {
  const closed = Object.assign({}, SARAMIN_SAMPLE, { active: 0 });
  assert.equal(normalizeSaraminJob(closed), null);
});

test('사람인: 제목이나 주소가 없으면 버린다', () => {
  assert.equal(normalizeSaraminJob({ url: 'https://x.test' }), null);
  assert.equal(normalizeSaraminJob({ position: { title: '제목만' } }), null);
  assert.equal(normalizeSaraminJob(null), null);
});

await testAsync('사람인: 열쇠가 없으면 안내와 함께 멈춘다', async () => {
  const saved = process.env.SARAMIN_ACCESS_KEY;
  delete process.env.SARAMIN_ACCESS_KEY;
  try {
    await saramin.fetch({ provider: 'saramin' }, { fetchJson: async () => ({}) });
    throw new Error('열쇠 없이 진행됐다');
  } catch (err) {
    assert.ok(/access-key/.test(err.message), '열쇠 이야기가 없다: ' + err.message);
    assert.ok(/oapi\.saramin\.co\.kr\/join/.test(err.message), '신청 경로 안내가 없다');
    assert.ok(/크롤링하지 않고/.test(err.message), '크롤링하지 않는다는 안내가 없다');
  } finally {
    if (saved) process.env.SARAMIN_ACCESS_KEY = saved;
  }
});

test('사람인: provider 를 명시했을 때만 잡는다', () => {
  assert.ok(saramin.detect({ provider: 'saramin' }));
  assert.equal(saramin.detect({ careers_url: 'https://www.saramin.co.kr/' }), null,
    '사람인 웹사이트 주소를 긁으려 한다');
});

// ── 그리팅 ───────────────────────────────────────────────────
// 2026-08-21 카카오페이 채용 페이지 응답의 구조를 줄인 표본
const GREETING_HTML = `<html><body>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"dehydratedState":{"queries":[
  {"queryKey":["boot"],"state":{"data":{"x":1}}},
  {"queryKey":["openings"],"state":{"data":[
    {"openingId":206749,"title":"서버 개발자 - 결제 서비스","openDate":"2026-07-01T00:00:00","dueDate":null,
     "group":{"name":"카카오페이"},
     "openingJobPosition":{"openingJobPositions":[
       {"workspacePlace":{"location":"판교","place":"경기 성남시"}}]}},
    {"openingId":214480,"title":"데이터 엔지니어","openDate":null,
     "group":{"name":"카카오페이"},"openingJobPosition":{"openingJobPositions":[]}}
  ]}}
]}}}}
</script></body></html>`;

test('그리팅: 페이지에서 공고 데이터를 꺼낸다', () => {
  const data = extractNextData(GREETING_HTML);
  assert.ok(data, '__NEXT_DATA__ 를 못 찾았다');
  const openings = findOpenings(data);
  assert.equal(openings.length, 2, '공고 수가 다르다: ' + openings.length);
});

test('그리팅: 공고를 옮긴다', () => {
  const openings = findOpenings(extractNextData(GREETING_HTML));
  const j = normalizeOpening(openings[0], 'https://kakaopay.career.greetinghr.com');
  assert.equal(j.title, '서버 개발자 - 결제 서비스');
  assert.equal(j.company, '카카오페이');
  assert.equal(j.location, '판교');
  assert.equal(j.url, 'https://kakaopay.career.greetinghr.com/ko/o/206749');
  assert.ok(j.postedAt > 0, '게시일이 없다');
});

test('그리팅: 근무지나 게시일이 없어도 버리지 않는다', () => {
  const openings = findOpenings(extractNextData(GREETING_HTML));
  const j = normalizeOpening(openings[1], 'https://kakaopay.career.greetinghr.com');
  assert.ok(j, '선택 항목이 없다고 공고를 버렸다');
  assert.equal(j.location, '');
  assert.equal(j.postedAt, undefined);
});

test('그리팅: 깨진 페이지에 조용히 실패하지 않는다', () => {
  assert.equal(extractNextData('<html>내용 없음</html>'), null);
  assert.deepEqual(findOpenings(null), []);
  assert.equal(normalizeOpening({ title: '아이디 없음' }, 'https://x.test'), null);
});

test('그리팅: 그리팅 도메인만 잡는다', () => {
  assert.ok(greeting.detect({ careers_url: 'https://kakaopay.career.greetinghr.com/ko/main' }));
  const other = greeting.detect({ careers_url: 'https://www.wanted.co.kr/wdlist' });
  assert.ok(!other || !other.url, '그리팅이 아닌 주소를 잡았다');
});

await testAsync('그리팅: 회사를 지정하지 않으면 멈춘다', async () => {
  try {
    await greeting.fetch({ provider: 'greetinghr' }, { fetchText: async () => '' });
    throw new Error('회사 지정 없이 진행됐다');
  } catch (err) {
    assert.ok(/portals\.yml/.test(err.message), '설정 안내가 없다: ' + err.message);
    assert.ok(/지정한 회사만/.test(err.message), '범위 제한 안내가 없다');
  }
});

// ── 경계 ─────────────────────────────────────────────────────
// robots.txt 가 모든 봇에게 전면 금지를 건 곳은 대상으로 삼지 않는다.
// 이건 겁이 아니라 판결이 정상 크롤링과 가른 기준이다 — 서울중앙지법 2015가합517982 1심은
// "robots.txt 를 보지 않은 채 HTML 을 긁은 것"을 정상 크롤링과 다르다고 봤다.
// 실측(2026-08-21): 인크루트 `User-agent: * → Disallow: /`, 링크드인은 파일 머리에 무단 자동화 금지.
test('robots.txt 가 전면 금지한 곳을 대상으로 하는 모듈이 없다', () => {
  const disallowedByRobots = ['incruit', 'linkedin'];
  const files = fs.readdirSync(here).filter(f => f.endsWith('.mjs'));
  const hits = [];
  for (const b of disallowedByRobots) {
    for (const f of files) {
      if (f.toLowerCase().includes(b)) hits.push(f);
    }
  }
  assert.deepEqual(hits, [], 'robots.txt 가 전면 금지한 곳을 대상으로 하는 모듈이 있다: ' + hits.join(', '));
});

test('수집 모듈이 정체를 밝히고 요청 간격을 둔다', () => {
  // 판결이 정상 크롤링의 요건으로 본 것: 정체를 밝힌다 · robots 를 본다 ·
  // 원문 주소를 남긴다 · 재배포하지 않는다. 앞의 둘을 코드에서 확인한다.
  const korean = fs.readdirSync(here)
    .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
    .filter(f => /saramin|greetinghr|jobkorea|jumpit|remember|wanted/.test(f));
  assert.ok(korean.length > 0, '한국 수집 모듈이 하나도 없다');
  for (const f of korean) {
    const src = fs.readFileSync(path.join(here, f), 'utf8');
    assert.ok(/robots|판례|대법원|약관/.test(src), f + ' 에 수집 근거·경계 설명이 없다');
    assert.ok(/sleep|간격|delay|throttle/i.test(src), f + ' 에 요청 간격 처리가 없다');
  }
});

// 이 파일은 test-all.mjs 가 찾아 실행합니다. 관례상 process.exit 을 부르지 않고
// helpers.mjs 의 카운터에 결과를 남깁니다.