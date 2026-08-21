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
import saraminWeb, { parseSaraminList } from '../providers/saramin-web.mjs';
import jobkorea, { parseJobKoreaList, filterByKeywords } from '../providers/jobkorea.mjs';
import jumpit, { normalizeJumpitPosition, findJumpitPositions } from '../providers/jumpit.mjs';
import remember, { parseSitemapIds, extractPostingData, normalizePosting } from '../providers/remember.mjs';
import worknet, { parseWorknetXml, readErrorMessage } from '../providers/worknet.mjs';
import wanted, { normalizeWantedJob, findWantedJobs } from '../providers/wanted.mjs';
import { parseRobots, isAllowed, clearRobotsCache } from '../providers/_robots.mjs';

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

// ── 사람인 검색 결과 페이지 ──────────────────────────────────
// 표본은 2026-08-21 실제 응답의 구조를 그대로 줄인 것입니다.

const SARAMIN_LIST_HTML = `
<div class="content">
  <div class="item_recruit" value="51234567">
    <div class="area_corp"><strong class="corp_name"><a href="/zf_user/company-info/view?csn=1">㈜카카오페이</a></strong></div>
    <div class="area_job">
      <h2 class="job_tit"><a href="/zf_user/jobs/relay/view?rec_idx=51234567" title="백엔드 개발자 (Java/Kotlin)">백엔드 개발자 (Java/Kotlin)</a></h2>
      <div class="job_condition">
        <span><a href="#">서울 &gt; 강남구</a></span>
        <span>경력 3~7년</span>
        <span>대졸↑</span>
        <span>정규직</span>
      </div>
    </div>
  </div>
  <div class="item_recruit" value="51234568">
    <div class="area_corp"><strong class="corp_name"><a href="#">주식회사 토스</a></strong></div>
    <div class="area_job">
      <h2 class="job_tit"><a href="/zf_user/jobs/relay/view?rec_idx=51234568" title="데이터 엔지니어">데이터 엔지니어</a></h2>
      <div class="job_condition"><span>경기 성남시 분당구</span><span>신입</span></div>
    </div>
  </div>
</div>
`;

test('사람인 목록: 공고를 제목·회사·근무지로 옮긴다', () => {
  const jobs = parseSaraminList(SARAMIN_LIST_HTML);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, '백엔드 개발자 (Java/Kotlin)');
  assert.equal(jobs[0].company, '㈜카카오페이');
  assert.equal(jobs[0].location, '서울 > 강남구');
  assert.equal(jobs[0].url, 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567');
  assert.equal(jobs[1].company, '주식회사 토스');
});

test('사람인 목록: 원문 주소를 보존한다', () => {
  // 수집 규칙 셋째. 주소를 다시 쓰지 않고 사람인 원문으로 돌려보낸다.
  for (const job of parseSaraminList(SARAMIN_LIST_HTML)) {
    assert.ok(job.url.startsWith('https://www.saramin.co.kr/'), '원문 주소가 아니다: ' + job.url);
    assert.ok(/rec_idx=\d+/.test(job.url), '공고 번호가 빠졌다: ' + job.url);
  }
});

test('사람인 목록: 깨진 페이지에 조용히 실패하지 않는다', () => {
  assert.deepEqual(parseSaraminList(''), []);
  assert.deepEqual(parseSaraminList('<html><body>점검 중입니다</body></html>'), []);
  assert.deepEqual(parseSaraminList(null), []);
});

await testAsync('사람인 목록: 조건 없이 전체를 훑지 않는다', async () => {
  clearRobotsCache();
  const ctx = { fetchText: async () => '' };
  try {
    await saraminWeb.fetch({ provider: 'saramin-web' }, ctx);
    throw new Error('조건 없이 진행됐다');
  } catch (err) {
    assert.ok(/검색 조건이 없습니다/.test(err.message), '안내가 없다: ' + err.message);
  }
});

await testAsync('사람인 목록: robots 를 먼저 받고 막힌 경로면 멈춘다', async () => {
  clearRobotsCache();
  const asked = [];
  const ctx = {
    fetchText: async (url) => {
      asked.push(url);
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nDisallow: /zf_user/search\n';
      return SARAMIN_LIST_HTML;
    },
  };
  try {
    await saraminWeb.fetch({ provider: 'saramin-web', searchword: '백엔드' }, ctx);
    throw new Error('막힌 경로를 읽었다');
  } catch (err) {
    assert.ok(/robots\.txt/.test(err.message), 'robots 사유가 아니다: ' + err.message);
  }
  assert.equal(asked.length, 1, 'robots 판정 전에 목록을 받았다');
  assert.ok(asked[0].endsWith('/robots.txt'));
  clearRobotsCache();
});

await testAsync('사람인 목록: 페이지를 넘기고 같은 결과면 멈춘다', async () => {
  clearRobotsCache();
  const pages = [];
  let slept = 0;
  const ctx = {
    fetchText: async (url) => {
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nDisallow: /feed.php\n';
      pages.push(url);
      return SARAMIN_LIST_HTML;   // 서버가 매번 같은 목록을 준다
    },
    sleep: async () => { slept++; },
  };
  const jobs = await saraminWeb.fetch(
    { provider: 'saramin-web', searchword: '백엔드', max_pages: 5 }, ctx,
  );
  assert.equal(jobs.length, 2, '같은 공고가 중복으로 쌓였다');
  assert.equal(pages.length, 2, '같은 목록이 와도 계속 넘겼다');
  assert.ok(/recruitPage=1/.test(pages[0]));
  assert.ok(/recruitPage=2/.test(pages[1]));
  assert.equal(slept, 1, '요청 사이에 간격을 두지 않았다');
  clearRobotsCache();
});

await testAsync('사람인 목록: 문서에 없는 매개변수를 주소에 붙이지 않는다', async () => {
  clearRobotsCache();
  let listUrl = '';
  const ctx = {
    fetchText: async (url) => {
      if (url.endsWith('/robots.txt')) return '';
      listUrl = url;
      return '';
    },
  };
  await saraminWeb.fetch(
    { provider: 'saramin-web', searchword: '백엔드', 아무거나: 'x', cookie: 'y' }, ctx,
  );
  assert.ok(/searchword=/.test(listUrl));
  assert.ok(!/cookie/.test(listUrl), '모르는 매개변수가 붙었다: ' + listUrl);
  clearRobotsCache();
});

// ── 잡코리아 목록 ────────────────────────────────────────────
// 표본은 2026-08-21 실제 응답의 구조를 그대로 줄인 것입니다.

const JOBKOREA_LIST_HTML = `
<div id="dev-gi-list"><div class="tplList tplJobList"><table><tbody>
  <tr class="devloopArea" data-gno="49820548" data-info=" 49820548|51467264|x|C|PL||63655">
    <td class="tplCo"><a href="/Recruit/Co_Read/C/63655">㈜아란교육</a></td>
    <td class="tplTit">
      <strong><a href="/Recruit/GI_Read/49820548?rPageCode=PL&amp;sn=6" title="[화성 향남] 유치원 파견 체육 강사 모집">[화성 향남] 유치원 파견 체육 강사 모집</a></strong>
      <p class="etc">
        <span class="cell">신입·경력</span>
        <span class="cell">초대졸↑</span>
        <span class="cell">경기 안산시 외</span>
        <span class="cell">정규직 외</span>
      </p>
    </td>
    <td class="odd"><span class="date dotum"><span class="tahoma">~09/20</span>(일)</span></td>
  </tr>
  <tr class="devloopArea" data-gno="49820549" data-info=" 49820549|1|y|C|PL||1">
    <td class="tplCo"><a href="/Recruit/Co_Read/C/1">네이버클라우드</a></td>
    <td class="tplTit">
      <strong><a href="/Recruit/GI_Read/49820549" title="백엔드 서버 개발자">백엔드 서버 개발자</a></strong>
      <p class="etc"><span class="cell">경력 5년↑</span><span class="cell">서울 분당구</span></p>
    </td>
  </tr>
</tbody></table></div></div>
`;

test('잡코리아 목록: 공고를 제목·회사·근무지로 옮긴다', () => {
  const jobs = parseJobKoreaList(JOBKOREA_LIST_HTML);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, '[화성 향남] 유치원 파견 체육 강사 모집');
  assert.equal(jobs[0].company, '㈜아란교육');
  assert.equal(jobs[0].url, 'https://www.jobkorea.co.kr/Recruit/GI_Read/49820548');
  assert.equal(jobs[1].title, '백엔드 서버 개발자');
  assert.equal(jobs[1].company, '네이버클라우드');
});

test('잡코리아 목록: 근무지를 자리 번호가 아니라 값으로 찾는다', () => {
  // p.etc 의 칸 수가 공고마다 달라서 세 번째 칸을 근무지로 고정하면 어긋난다.
  const jobs = parseJobKoreaList(JOBKOREA_LIST_HTML);
  assert.equal(jobs[0].location, '경기 안산시 외');   // 셋째 칸
  assert.equal(jobs[1].location, '서울 분당구');       // 둘째 칸
});

test('잡코리아 목록: 깨진 페이지에 조용히 실패하지 않는다', () => {
  assert.deepEqual(parseJobKoreaList(''), []);
  assert.deepEqual(parseJobKoreaList('<html><body>점검 중</body></html>'), []);
  assert.deepEqual(parseJobKoreaList(undefined), []);
});

test('잡코리아: 키워드를 서버가 아니라 받은 목록에서 거른다', () => {
  // robots 가 `/Search/?stext=` 를 막고 있어서 검색을 서버에 시키지 않는다.
  const jobs = parseJobKoreaList(JOBKOREA_LIST_HTML);
  assert.equal(filterByKeywords(jobs, ['백엔드']).length, 1);
  assert.equal(filterByKeywords(jobs, ['네이버']).length, 1);
  assert.equal(filterByKeywords(jobs, []).length, 2);
  assert.equal(filterByKeywords(jobs, ['없는말']).length, 0);
});

test('잡코리아: robots 가 막은 검색 경로를 코드가 아예 만들지 않는다', () => {
  const src = fs.readFileSync(path.join(here, 'jobkorea.mjs'), 'utf8');
  const built = src.replace(/^\s*\/\/.*$/gm, '');   // 설명 주석은 뺀다
  assert.ok(!/\/Search/.test(built), 'robots 가 막은 검색 경로가 코드에 있다');
  assert.ok(!/stext/.test(built), '검색어 매개변수가 코드에 있다');
});

await testAsync('잡코리아: 확인하지 않은 탭 이름을 받지 않는다', async () => {
  clearRobotsCache();
  try {
    await jobkorea.fetch({ provider: 'jobkorea', menucode: 'search' }, { fetchText: async () => '' });
    throw new Error('모르는 탭으로 진행됐다');
  } catch (err) {
    assert.ok(/모르는 탭/.test(err.message), '안내가 없다: ' + err.message);
  }
});

await testAsync('잡코리아: robots 를 먼저 받고 간격을 두며 넘긴다', async () => {
  clearRobotsCache();
  const asked = [];
  let slept = 0;
  const ctx = {
    fetchText: async (url) => {
      asked.push(url);
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nDisallow: /Search/?stext=\nAllow: /recruit/joblist\n';
      return JOBKOREA_LIST_HTML;
    },
    sleep: async () => { slept++; },
  };
  const jobs = await jobkorea.fetch({ provider: 'jobkorea', menucode: 'duty', max_pages: 3 }, ctx);
  assert.ok(asked[0].endsWith('/robots.txt'), 'robots 판정 전에 목록을 받았다');
  assert.equal(jobs.length, 2, '같은 목록이 중복으로 쌓였다');
  assert.equal(slept, 1, '요청 사이에 간격을 두지 않았다');
  assert.equal(jobs[0].description, '신입·경력 · 초대졸↑ · 경기 안산시 외 · 정규직 외');
  assert.ok(!('meta' in jobs[0]), '계약에 없는 필드가 나갔다');
  clearRobotsCache();
});

// ── 점핏 ─────────────────────────────────────────────────────
// 표본은 2026-08-21 실제 응답에서 가져온 것입니다.

const JUMPIT_BODY = {
  message: '포지션 리스트가 조회되었습니다.',
  status: 200,
  result: {
    totalCount: 322,
    page: 1,
    positions: [
      {
        id: 54555530,
        title: 'Robot Application Engineer',
        jobCategory: '서버/백엔드 <span>개발자</span>',
        companyName: '플라잎',
        techStacks: ['C++', 'Python', 'ROS'],
        newcomer: false,
        minCareer: 3,
        maxCareer: 10,
        locations: ['경기 성남시 분당구'],
        alwaysOpen: false,
        closedAt: '2036-08-22T23:59:59',
      },
      {
        id: 54814214,
        title: '펌웨어 개발 <span>신입</span>',
        companyName: '가스디엔에이',
        techStacks: ['C', 'MCU'],
        newcomer: true,
        minCareer: 0,
        maxCareer: 0,
        locations: ['인천 서구'],
        alwaysOpen: true,
        closedAt: null,
      },
      {
        id: 111,
        title: '마감된 공고',
        companyName: '어느회사',
        newcomer: false,
        minCareer: 1,
        maxCareer: 3,
        locations: ['서울 강남구'],
        alwaysOpen: false,
        closedAt: '2020-01-01T23:59:59',
      },
    ],
  },
};

test('점핏: 응답을 스캐너가 쓰는 모양으로 옮긴다', () => {
  const job = normalizeJumpitPosition(JUMPIT_BODY.result.positions[0]);
  assert.equal(job.title, 'Robot Application Engineer');
  assert.equal(job.company, '플라잎');
  assert.equal(job.location, '경기 성남시 분당구');
  assert.equal(job.url, 'https://jumpit.saramin.co.kr/position/54555530');
  assert.equal(job.description, '경력 3~10년 · C++, Python, ROS');
});

test('점핏: 제목에 섞여 오는 강조 태그를 걷어낸다', () => {
  const job = normalizeJumpitPosition(JUMPIT_BODY.result.positions[1]);
  assert.equal(job.title, '펌웨어 개발 신입');
  assert.ok(!/</.test(job.title), '태그가 남았다: ' + job.title);
});

test('점핏: 신입 공고에 「경력 0~0년」을 붙이지 않는다', () => {
  const job = normalizeJumpitPosition(JUMPIT_BODY.result.positions[1]);
  assert.equal(job.description, '신입 가능 · C, MCU');
});

test('점핏: 제목이나 번호가 없으면 버린다', () => {
  assert.equal(normalizeJumpitPosition({ id: 1 }), null);
  assert.equal(normalizeJumpitPosition({ title: '제목만' }), null);
  assert.equal(normalizeJumpitPosition(null), null);
});

test('점핏: 모양이 다른 응답에 조용히 실패하지 않는다', () => {
  assert.deepEqual(findJumpitPositions({}), []);
  assert.deepEqual(findJumpitPositions({ result: { positions: '아니오' } }), []);
  assert.deepEqual(findJumpitPositions(null), []);
});

await testAsync('점핏: 마감된 공고를 걸러 내고 JSON 을 달라고 한다', async () => {
  clearRobotsCache();
  let accept = '';
  const ctx = {
    fetchText: async () => 'User-agent: *\nDisallow: /resumes\n',
    fetchJson: async (url, opts) => {
      accept = opts?.headers?.accept || '';
      return JSON.parse(JSON.stringify(JUMPIT_BODY));
    },
  };
  const jobs = await jumpit.fetch({ provider: 'jumpit', size: 20, max_pages: 1 }, ctx);
  assert.equal(accept, 'application/json', 'JSON 을 달라고 하지 않았다');
  assert.equal(jobs.length, 2, '마감된 공고가 남았다');
  assert.ok(!jobs.some(j => j.title === '마감된 공고'));
  assert.ok(!jobs.some(j => 'closedAt' in j), '계약에 없는 필드가 나갔다');
  clearRobotsCache();
});

await testAsync('점핏: 화면 호스트의 robots 가 막으면 API 를 부르지 않는다', async () => {
  clearRobotsCache();
  let calledApi = false;
  const ctx = {
    fetchText: async () => 'User-agent: *\nDisallow: /positions\n',
    fetchJson: async () => { calledApi = true; return {}; },
  };
  try {
    await jumpit.fetch({ provider: 'jumpit' }, ctx);
    throw new Error('막힌 화면인데 진행됐다');
  } catch (err) {
    assert.ok(/robots\.txt/.test(err.message), 'robots 사유가 아니다: ' + err.message);
  }
  assert.equal(calledApi, false, 'robots 가 막았는데 API 를 불렀다');
  clearRobotsCache();
});

// ── 리멤버 ───────────────────────────────────────────────────
// robots 가 목록 경로(`/job_postings/`)를 막고 있어서 사이트맵 + 공고 상세로 갑니다.
// 표본은 2026-08-21 실제 응답에서 가져온 것입니다.

const REMEMBER_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://career.rememberapp.co.kr/job/posting/11910</loc></url>
  <url><loc>https://career.rememberapp.co.kr/job/posting/335291</loc></url>
  <url><loc>https://career.rememberapp.co.kr/job/posting/335296</loc></url>
</urlset>`;

function rememberPage(data) {
  const payload = { props: { pageProps: { dehydratedState: { queries: [
    { queryKey: ['/banners'], state: { data: { data: null } } },
    { queryKey: [`/job_postings/${data.id}`], state: { data: { data } } },
  ] } } } };
  return `<!DOCTYPE html><html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

const REMEMBER_POSTING = {
  id: 335296,
  title: '[한국IoT기술원] B2G 영업 신입 및 경력직 채용',
  status: 'published',
  minExperience: null,
  maxExperience: 15,
  startsAt: '2026-08-20T00:00:00.000+09:00',
  endsAt: null,
  jobCategories: [
    { id: 240, level1: '영업', level2: '영업 전략·기획' },
    { id: 246, level1: '영업', level2: '국내B2G영업' },
  ],
  normalizedAddress: { level1: '서울', level2: '금천구' },
  organization: { id: 77065, name: '(주)한국아이오티기술원 ' },
};

test('리멤버: 사이트맵에서 공고 번호를 등록 순서대로 뽑는다', () => {
  assert.deepEqual(parseSitemapIds(REMEMBER_SITEMAP), [11910, 335291, 335296]);
  assert.deepEqual(parseSitemapIds(''), []);
  assert.deepEqual(parseSitemapIds(null), []);
});

test('리멤버: 공고 상세에서 데이터를 꺼낸다', () => {
  const d = extractPostingData(rememberPage(REMEMBER_POSTING));
  assert.equal(d.id, 335296);
  assert.equal(d.title, REMEMBER_POSTING.title);
});

test('리멤버: 데이터가 없는 페이지에 조용히 실패하지 않는다', () => {
  assert.equal(extractPostingData('<html><body>없음</body></html>'), null);
  assert.equal(extractPostingData('<script id="__NEXT_DATA__">{망가짐</script>'), null);
  assert.equal(extractPostingData(null), null);
});

test('리멤버: 공고를 스캐너가 쓰는 모양으로 옮긴다', () => {
  const job = normalizePosting(REMEMBER_POSTING);
  assert.equal(job.title, REMEMBER_POSTING.title);
  assert.equal(job.company, '(주)한국아이오티기술원');   // 뒤 공백을 턴다
  assert.equal(job.location, '서울 금천구');
  assert.equal(job.url, 'https://career.rememberapp.co.kr/job/posting/335296');
  assert.equal(job.description, '경력 ~15년 · 영업 전략·기획, 국내B2G영업');
  assert.ok(Number.isFinite(job.postedAt), '게시일이 없다');
});

test('리멤버: 제목이나 번호가 없으면 버린다', () => {
  assert.equal(normalizePosting({ id: 1 }), null);
  assert.equal(normalizePosting({ title: '제목만' }), null);
  assert.equal(normalizePosting(null), null);
});

await testAsync('리멤버: 최근 등록분부터 limit 만큼만 읽고 간격을 둔다', async () => {
  clearRobotsCache();
  const asked = [];
  let slept = 0;
  const ctx = {
    fetchText: async (url) => {
      asked.push(url);
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nAllow: /sitemap*.xml\nAllow: /job/\nDisallow: /job_postings/\n';
      if (url.endsWith('/sitemap-jobs.xml')) return REMEMBER_SITEMAP;
      const id = Number(url.split('/').pop());
      return rememberPage({ ...REMEMBER_POSTING, id });
    },
    sleep: async () => { slept++; },
  };
  const jobs = await remember.fetch({ provider: 'remember', limit: 2 }, ctx);
  assert.equal(jobs.length, 2, 'limit 을 넘겨 읽었다');
  assert.equal(jobs[0].url, 'https://career.rememberapp.co.kr/job/posting/335296', '최근 등록분부터가 아니다');
  assert.equal(jobs[1].url, 'https://career.rememberapp.co.kr/job/posting/335291');
  assert.ok(!asked.some(u => /\/job\/posting\/11910/.test(u)), 'limit 밖의 공고까지 읽었다');
  assert.equal(slept, 1, '요청 사이에 간격을 두지 않았다');
  clearRobotsCache();
});

await testAsync('리멤버: 마감·비공개 공고를 걸러 낸다', async () => {
  clearRobotsCache();
  const ctx = {
    fetchText: async (url) => {
      if (url.endsWith('/robots.txt')) return '';
      if (url.endsWith('/sitemap-jobs.xml')) return REMEMBER_SITEMAP;
      const id = Number(url.split('/').pop());
      if (id === 335296) return rememberPage({ ...REMEMBER_POSTING, id, endsAt: '2020-01-01T00:00:00.000+09:00' });
      if (id === 335291) return rememberPage({ ...REMEMBER_POSTING, id, status: 'closed' });
      return rememberPage({ ...REMEMBER_POSTING, id });
    },
    sleep: async () => {},
  };
  const jobs = await remember.fetch({ provider: 'remember', limit: 3 }, ctx);
  assert.equal(jobs.length, 1, '마감·비공개 공고가 남았다');
  assert.equal(jobs[0].url, 'https://career.rememberapp.co.kr/job/posting/11910');
  assert.ok(!('status' in jobs[0]) && !('endsAt' in jobs[0]), '계약에 없는 필드가 나갔다');
  clearRobotsCache();
});

await testAsync('리멤버: 공고 하나가 없어져도 나머지를 포기하지 않는다', async () => {
  clearRobotsCache();
  const ctx = {
    fetchText: async (url) => {
      if (url.endsWith('/robots.txt')) return '';
      if (url.endsWith('/sitemap-jobs.xml')) return REMEMBER_SITEMAP;
      const id = Number(url.split('/').pop());
      if (id === 335296) throw new Error('HTTP 404 Not Found');
      return rememberPage({ ...REMEMBER_POSTING, id });
    },
    sleep: async () => {},
  };
  const jobs = await remember.fetch({ provider: 'remember', limit: 3 }, ctx);
  assert.equal(jobs.length, 2, '하나가 없어졌다고 멈췄다');
});

test('리멤버: robots 가 막은 목록 경로를 코드가 부르지 않는다', () => {
  const src = fs.readFileSync(path.join(here, 'remember.mjs'), 'utf8');
  const built = src.replace(/^\s*\/\/.*$/gm, '');   // 설명 주석은 뺀다
  assert.ok(!/job_postings/.test(built), 'robots 가 막은 목록 경로가 코드에 있다');
  assert.ok(!/seed=/.test(built), 'robots 가 막은 seed 매개변수가 코드에 있다');
});

// ── 고용24 (옛 워크넷) ───────────────────────────────────────
// 공개 API 입니다. 오류 응답은 2026-08-21 실제로 받아 확인했고,
// 정상 응답의 필드 이름은 문서 기준입니다(인증키가 있어야 볼 수 있음).

const WORKNET_ERROR_XML =
  '<?xml version="1.0" encoding="UTF-8"?><wantedRoot>' +
  '<message>유효하지 않은 인증키 입니다.</message><messageCd>002</messageCd></wantedRoot>';

const WORKNET_OK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wantedRoot>
  <total>2</total>
  <wanted>
    <company>(주)한국소프트</company>
    <title>웹 백엔드 개발자 모집</title>
    <salTpNm>연봉</salTpNm>
    <sal>4,000만원</sal>
    <region>서울 구로구</region>
    <holidayTpNm>주5일근무</holidayTpNm>
    <minEdubg>대졸</minEdubg>
    <career>경력</career>
    <regDt>20260820</regDt>
    <closeDt>20360930</closeDt>
    <wantedAuthNo>K120260820001</wantedAuthNo>
    <wantedInfoUrl>https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?wantedAuthNo=K120260820001</wantedInfoUrl>
  </wanted>
  <wanted>
    <company>지방자치단체</company>
    <title>마감된 공고</title>
    <region>부산 해운대구</region>
    <regDt>20200101</regDt>
    <closeDt>20200201</closeDt>
    <wantedAuthNo>K120200101001</wantedAuthNo>
  </wanted>
</wantedRoot>`;

test('고용24: 서버가 준 오류 문장을 그대로 읽는다', () => {
  assert.equal(readErrorMessage(WORKNET_ERROR_XML), '유효하지 않은 인증키 입니다. (코드 002)');
  assert.equal(readErrorMessage(WORKNET_OK_XML), null);
  assert.equal(readErrorMessage(null), null);
});

test('고용24: 응답을 스캐너가 쓰는 모양으로 옮긴다', () => {
  const jobs = parseWorknetXml(WORKNET_OK_XML);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, '웹 백엔드 개발자 모집');
  assert.equal(jobs[0].company, '(주)한국소프트');
  assert.equal(jobs[0].location, '서울 구로구');
  assert.ok(jobs[0].url.includes('work24.go.kr'), '원문 주소가 아니다: ' + jobs[0].url);
  assert.equal(jobs[0].description, '경력 · 대졸 · 주5일근무 · 연봉 4,000만원');
  assert.ok(Number.isFinite(jobs[0].postedAt), '등록일이 없다');
});

test('고용24: 주소가 없으면 인증번호로 되돌린다', () => {
  const jobs = parseWorknetXml(WORKNET_OK_XML);
  assert.ok(jobs[1].url.includes('K120200101001'), '인증번호가 빠졌다: ' + jobs[1].url);
});

test('고용24: 제목이 없거나 응답이 아니면 버린다', () => {
  assert.deepEqual(parseWorknetXml('<wantedRoot><wanted><company>회사만</company></wanted></wantedRoot>'), []);
  assert.deepEqual(parseWorknetXml(''), []);
  assert.deepEqual(parseWorknetXml(null), []);
});

await testAsync('고용24: 인증키가 없으면 신청 절차를 알리고 멈춘다', async () => {
  const saved = process.env.WORKNET_API_KEY;
  delete process.env.WORKNET_API_KEY;
  try {
    await worknet.fetch({ provider: 'worknet' }, { fetchText: async () => '' });
    throw new Error('열쇠 없이 진행됐다');
  } catch (err) {
    assert.ok(/인증키가 없습니다/.test(err.message), '안내가 없다: ' + err.message);
    assert.ok(/openapi\.work\.go\.kr/.test(err.message), '신청 경로가 없다');
    assert.ok(/대신 신청하지 않습니다/.test(err.message), '대리 신청 금지 문구가 없다');
  } finally {
    if (saved !== undefined) process.env.WORKNET_API_KEY = saved;
  }
});

await testAsync('고용24: 인증키가 틀리면 서버 문장을 그대로 전한다', async () => {
  clearRobotsCache();
  const saved = process.env.WORKNET_API_KEY;
  process.env.WORKNET_API_KEY = '틀린열쇠';
  try {
    await worknet.fetch({ provider: 'worknet' }, {
      fetchText: async (url) => (url.endsWith('/robots.txt') ? '' : WORKNET_ERROR_XML),
    });
    throw new Error('오류 응답인데 진행됐다');
  } catch (err) {
    assert.ok(/유효하지 않은 인증키/.test(err.message), '서버 문장이 없다: ' + err.message);
  } finally {
    if (saved === undefined) delete process.env.WORKNET_API_KEY;
    else process.env.WORKNET_API_KEY = saved;
    clearRobotsCache();
  }
});

await testAsync('고용24: 마감된 공고를 걸러 낸다', async () => {
  clearRobotsCache();
  const saved = process.env.WORKNET_API_KEY;
  process.env.WORKNET_API_KEY = '열쇠';
  try {
    const jobs = await worknet.fetch({ provider: 'worknet', display: 100 }, {
      fetchText: async (url) => (url.endsWith('/robots.txt') ? '' : WORKNET_OK_XML),
      sleep: async () => {},
    });
    assert.equal(jobs.length, 1, '마감된 공고가 남았다');
    assert.equal(jobs[0].title, '웹 백엔드 개발자 모집');
    assert.ok(!('closesAt' in jobs[0]), '계약에 없는 필드가 나갔다');
  } finally {
    if (saved === undefined) delete process.env.WORKNET_API_KEY;
    else process.env.WORKNET_API_KEY = saved;
    clearRobotsCache();
  }
});

await testAsync('고용24: 필드 이름이 바뀌면 조용히 빈손으로 끝내지 않는다', async () => {
  // 정상 응답의 필드 이름은 실측하지 못했습니다. 이름이 어긋났을 때
  // 「공고 0건」으로 조용히 지나가면 원인을 못 찾습니다.
  clearRobotsCache();
  const saved = process.env.WORKNET_API_KEY;
  process.env.WORKNET_API_KEY = '열쇠';
  const changed = '<wantedRoot><wanted><companyName>회사</companyName><jobTitle>제목</jobTitle></wanted></wantedRoot>';
  try {
    await worknet.fetch({ provider: 'worknet' }, {
      fetchText: async (url) => (url.endsWith('/robots.txt') ? '' : changed),
    });
    throw new Error('필드가 어긋났는데 조용히 끝났다');
  } catch (err) {
    assert.ok(/필드 이름이 바뀐 것으로 보입니다/.test(err.message), '안내가 없다: ' + err.message);
  } finally {
    if (saved === undefined) delete process.env.WORKNET_API_KEY;
    else process.env.WORKNET_API_KEY = saved;
    clearRobotsCache();
  }
});

// ── 원티드 ───────────────────────────────────────────────────
// 표본은 2026-08-21 실제 응답에서 가져온 것입니다.
// 이 모듈만 기본값이 꺼짐입니다 — robots.txt 가 403 이라 확인할 수 없기 때문입니다.

const WANTED_BODY = {
  links: { prev: null, next: '/api/v4/jobs?country=kr&offset=2' },
  data: [
    {
      status: 'active',
      id: 382106,
      position: '교육 운영 매니저(5년이상)(팀장급)',
      company: { id: 30177, name: '에이블런' },
      address: { location: '서울', district: '마포구', full_location: '서울 마포구 성암로 330' },
      annual_from: 5,
      annual_to: 10,
      due_time: null,
    },
    {
      status: 'active',
      id: 382107,
      position: '신입 백엔드 개발자',
      company: { name: '어느회사' },
      address: { location: '경기', district: '성남시 분당구' },
      annual_from: 0,
      annual_to: 0,
      due_time: null,
    },
    {
      status: 'closed',
      id: 382108,
      position: '닫힌 공고',
      company: { name: '어느회사' },
      address: { location: '서울' },
      annual_from: 1,
      annual_to: 3,
      due_time: null,
    },
  ],
};

test('원티드: 응답을 스캐너가 쓰는 모양으로 옮긴다', () => {
  const job = normalizeWantedJob(WANTED_BODY.data[0]);
  assert.equal(job.title, '교육 운영 매니저(5년이상)(팀장급)');
  assert.equal(job.company, '에이블런');
  assert.equal(job.location, '서울 마포구');
  assert.equal(job.url, 'https://www.wanted.co.kr/wd/382106');
  assert.equal(job.description, '경력 5~10년');
});

test('원티드: annual_from 은 연봉이 아니라 연차다', () => {
  // 이름이 연봉처럼 생겨서 한 번 잘못 읽으면 「연봉 5만원」이 나온다.
  const job = normalizeWantedJob(WANTED_BODY.data[1]);
  assert.equal(job.description, '신입');
  assert.ok(!/원|만원|연봉/.test(job.description), '연봉으로 읽었다: ' + job.description);
});

test('원티드: 제목이나 번호가 없으면 버린다', () => {
  assert.equal(normalizeWantedJob({ id: 1 }), null);
  assert.equal(normalizeWantedJob({ position: '제목만' }), null);
  assert.equal(normalizeWantedJob(null), null);
});

test('원티드: 모양이 다른 응답에 조용히 실패하지 않는다', () => {
  assert.deepEqual(findWantedJobs({}), []);
  assert.deepEqual(findWantedJobs({ data: '아니오' }), []);
  assert.deepEqual(findWantedJobs(null), []);
});

await testAsync('원티드: 기본값은 꺼짐이고 무엇을 모르는지 말한다', async () => {
  clearRobotsCache();
  let calledApi = false;
  const ctx = {
    fetchText: async () => { throw new Error('HTTP 403 Forbidden'); },   // robots.txt 가 403
    fetchJson: async () => { calledApi = true; return WANTED_BODY; },
  };
  try {
    await wanted.fetch({ provider: 'wanted' }, ctx);
    throw new Error('꺼짐인데 진행됐다');
  } catch (err) {
    assert.ok(/기본값이 꺼짐/.test(err.message), '안내가 없다: ' + err.message);
    assert.ok(/use_api: true/.test(err.message), '켜는 방법이 없다');
    assert.ok(/대신 정하지 않습니다/.test(err.message), '판단 주체가 불분명하다');
  }
  assert.equal(calledApi, false, '꺼짐인데 API 를 불렀다');
  clearRobotsCache();
});

await testAsync('원티드: 켜면 읽고 닫힌 공고를 걸러 낸다', async () => {
  clearRobotsCache();
  const ctx = {
    fetchText: async () => { throw new Error('HTTP 403 Forbidden'); },
    fetchJson: async () => JSON.parse(JSON.stringify({ ...WANTED_BODY, links: { next: null } })),
  };
  const jobs = await wanted.fetch({ provider: 'wanted', use_api: true }, ctx);
  assert.equal(jobs.length, 2, '닫힌 공고가 남았다');
  assert.ok(!jobs.some(j => j.title === '닫힌 공고'));
  assert.ok(!jobs.some(j => 'status' in j || 'dueAt' in j), '계약에 없는 필드가 나갔다');
  clearRobotsCache();
});

await testAsync('원티드: 읽을 수 있는 robots 가 막으면 플래그가 켜져 있어도 멈춘다', async () => {
  // 플래그가 가리는 것은 「확인할 수 없는 상태」 하나뿐이다.
  // 파일을 받을 수 있게 되면 그것이 정본이고, 플래그가 덮지 않는다.
  clearRobotsCache();
  let calledApi = false;
  const ctx = {
    fetchText: async () => 'User-agent: *\nAllow: /\nDisallow: /api/\n',
    fetchJson: async () => { calledApi = true; return WANTED_BODY; },
  };
  try {
    await wanted.fetch({ provider: 'wanted', use_api: true }, ctx);
    throw new Error('막힌 경로인데 진행됐다');
  } catch (err) {
    assert.ok(/robots\.txt 가 이 경로를 막고/.test(err.message), 'robots 사유가 아니다: ' + err.message);
  }
  assert.equal(calledApi, false, 'robots 가 막았는데 API 를 불렀다');
  clearRobotsCache();
});

await testAsync('원티드: 읽을 수 있는 robots 가 허용하면 플래그 없이도 읽는다', async () => {
  clearRobotsCache();
  const ctx = {
    fetchText: async () => 'User-agent: *\nAllow: /\n',
    fetchJson: async () => JSON.parse(JSON.stringify({ ...WANTED_BODY, links: { next: null } })),
  };
  const jobs = await wanted.fetch({ provider: 'wanted' }, ctx);
  assert.equal(jobs.length, 2, '허용인데 안 읽었다');
  clearRobotsCache();
});

// ── robots.txt 판정 ──────────────────────────────────────────
// 실측한 robots.txt 원문(2026-08-21)으로 검증한다. 이 판정이 수집 규칙 둘째
// ("robots.txt 를 본다")를 코드로 집행하는 자리다.

const SARAMIN_ROBOTS = [
  'User-agent: GPTBot',
  'Disallow: /',
  'User-agent: *',
  'Disallow: /feed.php',
  'Allow   : /zf_user/jobs/relay/recruit-view',
  'Sitemap: https://www.saramin.co.kr/sitemap.xml',
].join('\n');

const INCRUIT_ROBOTS = [
  'User-agent: Googlebot',
  'Allow: /',
  'User-agent: *',
  'Disallow: /',
].join('\n');

test('robots: 사람인은 공고 경로를 허용하고 feed.php 만 막는다', () => {
  const r = parseRobots(SARAMIN_ROBOTS, 'career-ops');
  assert.equal(isAllowed(r, '/zf_user/jobs/relay/recruit-view?rec_idx=1'), true);
  assert.equal(isAllowed(r, '/zf_user/search/recruit'), true);
  assert.equal(isAllowed(r, '/feed.php'), false, 'robots 가 막은 경로를 허용으로 판정했다');
});

test('robots: 인크루트는 우리에게 전면 금지다', () => {
  const r = parseRobots(INCRUIT_ROBOTS, 'career-ops');
  assert.equal(isAllowed(r, '/list/'), false);
  assert.equal(isAllowed(r, '/'), false);
});

test('robots: 우리 이름 그룹이 있으면 그것을 쓴다', () => {
  const src = ['User-agent: career-ops', 'Disallow: /private/', 'User-agent: *', 'Disallow: /'].join('\n');
  const mine = parseRobots(src, 'career-ops');
  assert.equal(isAllowed(mine, '/jobs/'), true, '내 그룹이 있는데 * 그룹을 적용했다');
  assert.equal(isAllowed(mine, '/private/'), false);
});

test('robots: 더 긴 경로 규칙이 이긴다', () => {
  const src = ['User-agent: *', 'Disallow: /jobs/', 'Allow: /jobs/public/'].join('\n');
  const r = parseRobots(src, 'career-ops');
  assert.equal(isAllowed(r, '/jobs/private/1'), false);
  assert.equal(isAllowed(r, '/jobs/public/1'), true, '더 긴 Allow 가 이겨야 한다');
});

test('robots: 와일드카드와 끝 표시를 처리한다', () => {
  const src = ['User-agent: *', 'Disallow: /*.pdf$', 'Disallow: /tmp/*/private'].join('\n');
  const r = parseRobots(src, 'career-ops');
  assert.equal(isAllowed(r, '/a/b/file.pdf'), false);
  assert.equal(isAllowed(r, '/a/b/file.pdf.html'), true, '$ 를 끝 표시로 처리하지 않았다');
  assert.equal(isAllowed(r, '/tmp/x/private'), false);
});

test('robots: 빈 Disallow 는 아무것도 막지 않는다', () => {
  const r = parseRobots(['User-agent: *', 'Disallow:'].join('\n'), 'career-ops');
  assert.equal(isAllowed(r, '/anything'), true);
});

test('robots: Crawl-delay 를 읽는다', () => {
  const r = parseRobots(['User-agent: *', 'Crawl-delay: 5', 'Disallow: /x'].join('\n'), 'career-ops');
  assert.equal(r.crawlDelay, 5);
});

test('robots: 파일이 없으면 막지 않는다', () => {
  const r = parseRobots('', 'career-ops');
  assert.equal(isAllowed(r, '/anything'), true);
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

test('robots 를 통째로 무시하는 스위치가 없다', () => {
  // 원티드의 `use_api` 는 「robots.txt 를 받을 수 없는 상태」 하나만 가린다.
  // 이것이 일반적인 robots 무시 스위치로 번지면 도구 전체의 둘째 규칙 주장이 거짓이 된다.
  const files = fs.readdirSync(here).filter(f => f.endsWith('.mjs'));
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(here, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    if (/ignore_robots|skip_robots|bypass_robots|robots_off|noRobots/i.test(src)) hits.push(f);
  }
  assert.deepEqual(hits, [], 'robots 무시 스위치가 있다: ' + hits.join(', '));
});

test('수집 모듈이 정체를 밝히고 요청 간격을 둔다', () => {
  // 판결이 정상 크롤링의 요건으로 본 것: 정체를 밝힌다 · robots 를 본다 ·
  // 원문 주소를 남긴다 · 재배포하지 않는다. 앞의 둘을 코드에서 확인한다.
  const korean = fs.readdirSync(here)
    .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
    .filter(f => /saramin|greetinghr|jobkorea|jumpit|remember|worknet|wanted/.test(f));
  assert.ok(korean.length > 0, '한국 수집 모듈이 하나도 없다');
  for (const f of korean) {
    const src = fs.readFileSync(path.join(here, f), 'utf8');
    assert.ok(/robots|판례|대법원|약관/.test(src), f + ' 에 수집 근거·경계 설명이 없다');
    assert.ok(/sleep|간격|delay|throttle/i.test(src), f + ' 에 요청 간격 처리가 없다');
  }
});

// 이 파일은 test-all.mjs 가 찾아 실행합니다. 관례상 process.exit 을 부르지 않고
// helpers.mjs 의 카운터에 결과를 남깁니다.