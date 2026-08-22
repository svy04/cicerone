// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 점핏 공고 목록 — 개발 직군 전용 채용 사이트입니다.
//
// ── 지키는 넷 ────────────────────────────────────────────────
//   1. 정체를 밝힌다 — ctx 가 붙이는 cicerone 사용자 에이전트로 200 이 옵니다.
//      브라우저 문자열을 흉내 내지 않습니다
//   2. robots.txt 를 본다 — 아래 「두 호스트」 참고
//   3. 원문 주소를 남긴다 — `jumpit.saramin.co.kr/position/{id}` 로 되돌립니다
//   4. 재배포하지 않는다 — 결과는 사용자 컴퓨터의 파일로만 갑니다
//
// ── 두 호스트 ────────────────────────────────────────────────
// 화면은 `jumpit.saramin.co.kr` 가 그리고, 공고 데이터는 `jumpit-api.saramin.co.kr`
// 가 줍니다. 호스트가 달라서 robots 를 두 번 봐야 하는데, 실측(2026-08-21) 결과가
// 이렇습니다.
//
//   · `jumpit.saramin.co.kr/robots.txt` → 200. `/positions` 는 금지 목록에 없습니다.
//     막힌 것은 `/resumes`·`/myjumpit`·`/scraps` 처럼 로그인해야 보이는 곳입니다
//   · `jumpit-api.saramin.co.kr/robots.txt` → CloudFront 403. **파일을 못 받았습니다**
//
// 그래서 이 모듈은 **화면 호스트의 robots 로 판정**합니다. 사람이 브라우저로 보는
// 화면(`/positions`)이 허용인지를 묻고, 허용이면 그 화면이 부르는 주소를 부릅니다.
// API 호스트의 robots 는 못 받았으니 없는 것으로 치지 않고, 못 받았다는 사실을
// 이 자리에 적어 둡니다. 나중에 그 파일이 열리고 금지가 적혀 있으면 이 모듈을
// 그때 멈춰야 합니다.
//
// ── 응답 형식 ────────────────────────────────────────────────
// 같은 주소가 `Accept` 에 따라 XML 이나 JSON 을 줍니다. JSON 을 달라고 합니다.

import { assertAllowed } from './_robots.mjs';

const SITE = 'https://jumpit.saramin.co.kr';
const API = 'https://jumpit-api.saramin.co.kr/api/positions';
const LIST_PATH = '/positions';
const DEFAULT_SIZE = 50;
const MAX_SIZE = 100;        // 실측 상한. 그 위는 확인 못 함
const DEFAULT_MAX_PAGES = 3;
const PACE_MS = 1200;        // robots 에 Crawl-delay 가 없어도 간격을 둡니다

/** 실측으로 확인한 질의 매개변수만 통과시킵니다. */
const ALLOWED_PARAMS = new Set(['sort', 'keyword', 'highlight']);

/**
 * 제목에 검색어 강조 태그가 섞여 옵니다(`서버/백엔드 <span>개발자</span>`).
 * 걷어냅니다.
 * @param {any} value
 * @returns {string}
 */
function plain(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * 응답 하나를 스캐너가 쓰는 모양으로 옮깁니다. 시험에서 직접 부릅니다.
 *
 * @param {any} p 응답의 positions 항목
 * @returns {object|null} 제목이나 번호가 없으면 null
 */
export function normalizeJumpitPosition(p) {
  if (!p || typeof p !== 'object') return null;
  const title = plain(p.title);
  const id = p.id;
  if (!title || id == null) return null;

  const locations = Array.isArray(p.locations) ? p.locations.map(plain).filter(Boolean) : [];

  // 경력 조건과 기술 스택은 목록 응답이 이미 주는 것이라 공고를 따로 부르지
  // 않습니다. 계약상 `description` 자리에 넣습니다.
  const bits = [];
  if (p.newcomer === true) bits.push('신입 가능');
  const from = Number.isFinite(p.minCareer) ? p.minCareer : null;
  const to = Number.isFinite(p.maxCareer) ? p.maxCareer : null;
  // 신입 공고는 두 값이 다 0 으로 옵니다. 그때 「경력 0~0년」을 붙이면
  // 바로 앞의 「신입 가능」과 같은 말을 두 번 하는 셈입니다.
  if (!(from === 0 && (to === 0 || to === null))) {
    if (from != null && to != null) bits.push(`경력 ${from}~${to}년`);
    else if (from != null) bits.push(`경력 ${from}년↑`);
    else if (to != null) bits.push(`경력 ~${to}년`);
  }
  if (Array.isArray(p.techStacks) && p.techStacks.length) bits.push(p.techStacks.map(plain).join(', '));

  /** @type {any} */
  const out = {
    title,
    url: `${SITE}/position/${id}`,
    company: plain(p.companyName),
    location: locations.join(', '),
  };
  if (bits.length) out.description = bits.join(' · ');

  // 마감일이 지난 공고는 목록에 남아 있어도 지원할 수 없습니다.
  if (p.alwaysOpen !== true && typeof p.closedAt === 'string') {
    const t = Date.parse(p.closedAt);
    if (!Number.isNaN(t)) out.closedAt = t;
  }
  return out;
}

/**
 * 응답에서 공고 배열을 꺼냅니다. 모양이 다르면 빈 배열입니다.
 * @param {any} body
 * @returns {Array<any>}
 */
export function findJumpitPositions(body) {
  const list = body?.result?.positions;
  return Array.isArray(list) ? list : [];
}

/** @type {Provider} */
export default {
  id: 'jumpit',

  detect(entry) {
    if (entry?.provider === 'jumpit') return { url: SITE + LIST_PATH };
    return null;
  },

  /**
   * @param {any} entry portals.yml 항목
   * @param {any} ctx HTTP 문맥
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    // 사람이 보는 화면이 허용인지부터 묻습니다 — 위 「두 호스트」 참고
    const { crawlDelay } = await assertAllowed(SITE + LIST_PATH, ctx, 'cicerone');
    const pace = Math.max(PACE_MS, (crawlDelay || 0) * 1000);

    const size = Math.min(Math.max(Number(entry?.size) || DEFAULT_SIZE, 1), MAX_SIZE);
    const maxPages = Math.max(1, Math.min(Number(entry?.max_pages) || DEFAULT_MAX_PAGES, 10));

    const base = new URL(API);
    base.searchParams.set('sort', 'reg_dt');
    base.searchParams.set('highlight', 'false');
    base.searchParams.set('size', String(size));

    for (const [k, v] of Object.entries(entry || {})) {
      if (ALLOWED_PARAMS.has(k) && v != null && v !== '') {
        base.searchParams.set(k, String(v));
      }
    }

    const now = Date.now();
    const jobs = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(base);
      url.searchParams.set('page', String(page));

      const body = await ctx.fetchJson(url.toString(), {
        headers: { accept: 'application/json' },
      });
      const found = findJumpitPositions(body);
      if (found.length === 0) break;

      let added = 0;
      for (const raw of found) {
        const job = normalizeJumpitPosition(raw);
        if (!job) continue;
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        added++;
        // 마감된 공고는 버립니다
        if (typeof job.closedAt === 'number' && job.closedAt < now) continue;
        delete job.closedAt;
        jobs.push(job);
      }
      if (added === 0) break;
      if (found.length < size) break;   // 마지막 쪽

      if (page < maxPages && typeof ctx.sleep === 'function') await ctx.sleep(pace);
    }

    return jobs;
  },
};
