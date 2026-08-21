// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 원티드 공고 목록 — 신입·경력 개발 직군이 많은 국내 채용 플랫폼입니다.
//
// ── 지키는 넷 ────────────────────────────────────────────────
//   1. 정체를 밝힌다 — ctx 가 붙이는 career-ops 사용자 에이전트로 200 이 옵니다.
//      브라우저 문자열을 흉내 내지 않습니다
//   2. robots.txt 를 본다 — 아래 「기본값이 꺼짐인 이유」 참고
//   3. 원문 주소를 남긴다 — `www.wanted.co.kr/wd/{id}` 로 되돌립니다
//   4. 재배포하지 않는다 — 결과는 사용자 컴퓨터의 파일로만 갑니다
//
// ── 기본값이 꺼짐인 이유 ─────────────────────────────────────
// 이 모듈만 `use_api: true` 를 켜야 움직입니다. 실측(2026-08-21)이 이렇습니다.
//
//   · `https://www.wanted.co.kr/robots.txt` → **403**. 파일 자체를 못 받습니다
//   · `/wdlist` 화면 → 200. 다만 HTML 에 공고 링크가 0 개입니다(자바스크립트가 그림)
//   · `/api/v4/jobs` → 200, JSON. 로그인도 브라우저 흉내도 필요 없습니다
//
// 규칙 둘째를 지키려면 robots.txt 를 봐야 하는데 그 파일부터 못 받습니다.
// 대신 보관된 스냅샷(Wayback, 2026-01-08)이 있고, 거기에는 `Disallow: /api/` 가
// 적혀 있습니다. **오늘 서버의 파일이 아닐 수 있습니다.**
//
// 그래서 이 도구는 스스로 켜지 않습니다. 아는 것을 그대로 적어 두고, 읽을지
// 말지는 쓰는 사람이 정합니다. `portals.yml` 에 `use_api: true` 를 적으면
// 그 판단을 한 것으로 봅니다.
//
// **읽을 수 있는 robots.txt 를 이 플래그가 덮지는 않습니다.** 나중에 파일이
// 열리고 거기에 금지가 적혀 있으면, 플래그가 켜져 있어도 멈춥니다. 플래그가
// 가리는 것은 "확인할 수 없는 상태" 하나뿐입니다.

import { loadRobots, isAllowed } from './_robots.mjs';

const ORIGIN = 'https://www.wanted.co.kr';
const LIST_PATH = '/wdlist';
const API_PATH = '/api/v4/jobs';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_MAX_PAGES = 3;
const PACE_MS = 1200;

/** 실측으로 확인한 질의 매개변수만 통과시킵니다. */
const ALLOWED_PARAMS = new Set(['country', 'job_sort', 'years', 'locations', 'tag_type_ids']);

const OFF_MESSAGE =
  'wanted: 기본값이 꺼짐입니다. 원티드는 robots.txt 가 403 이라 우리가 그 파일을 받을 수 없습니다.\n' +
  '  · 보관된 스냅샷(2026-01-08)에는 공고 데이터가 오는 `/api/` 가 금지로 적혀 있습니다\n' +
  '  · 오늘 서버의 파일이 그와 같은지는 확인할 방법이 없습니다\n' +
  '  · 허용된 `/wdlist` 화면 HTML 에는 공고가 들어 있지 않습니다\n' +
  '읽기로 정했다면 portals.yml 의 이 항목에 `use_api: true` 를 적으세요. 도구가 대신 정하지 않습니다.';

/**
 * 응답 하나를 스캐너가 쓰는 모양으로 옮깁니다. 시험에서 직접 부릅니다.
 *
 * @param {any} j 응답의 data 항목
 * @returns {object|null} 제목이나 번호가 없으면 null
 */
export function normalizeWantedJob(j) {
  if (!j || typeof j !== 'object') return null;
  const title = String(j.position || '').trim();
  const id = j.id;
  if (!title || id == null) return null;

  const addr = j.address || {};
  const location = [addr.location, addr.district].filter(Boolean).join(' ');

  // 경력 연차는 목록 응답이 이미 주는 것이라 공고를 따로 부르지 않습니다.
  // `annual_from`·`annual_to` 는 **연봉이 아니라 연차**입니다.
  const bits = [];
  const from = Number.isFinite(j.annual_from) ? j.annual_from : null;
  const to = Number.isFinite(j.annual_to) ? j.annual_to : null;
  if (from === 0 && (to === 0 || to === null)) bits.push('신입');
  else if (from != null && to != null) bits.push(`경력 ${from}~${to}년`);
  else if (from != null) bits.push(`경력 ${from}년↑`);
  else if (to != null) bits.push(`경력 ~${to}년`);

  /** @type {any} */
  const out = {
    title,
    url: `${ORIGIN}/wd/${id}`,
    company: String(j.company?.name || '').trim(),
    location,
  };
  if (bits.length) out.description = bits.join(' · ');

  out.status = String(j.status || '');
  if (typeof j.due_time === 'string') {
    const t = Date.parse(j.due_time);
    if (!Number.isNaN(t)) out.dueAt = t;
  }
  return out;
}

/**
 * 응답에서 공고 배열을 꺼냅니다. 모양이 다르면 빈 배열입니다.
 * @param {any} body
 * @returns {Array<any>}
 */
export function findWantedJobs(body) {
  return Array.isArray(body?.data) ? body.data : [];
}

/** @type {Provider} */
export default {
  id: 'wanted',

  detect(entry) {
    if (entry?.provider === 'wanted') return { url: ORIGIN + LIST_PATH };
    return null;
  },

  /**
   * @param {any} entry portals.yml 항목
   * @param {any} ctx HTTP 문맥
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    const robots = await loadRobots(ORIGIN + API_PATH, ctx, 'career-ops');

    if (robots.fetched) {
      // 파일을 받았다면 그것이 정본입니다. 플래그로 덮지 않습니다.
      if (!isAllowed(robots, API_PATH)) {
        throw new Error(
          `robots.txt 가 이 경로를 막고 있습니다: ${ORIGIN}${API_PATH}\n` +
          '이 도구는 robots.txt 를 지킵니다. 막힌 경로는 읽지 않습니다.\n' +
          '(원티드 robots.txt 를 받을 수 있게 됐고, 거기에 금지가 적혀 있습니다.)',
        );
      }
    } else if (entry?.use_api !== true) {
      throw new Error(OFF_MESSAGE);
    }

    const pace = Math.max(PACE_MS, (robots.crawlDelay || 0) * 1000);
    const limit = Math.min(Math.max(Number(entry?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const maxPages = Math.max(1, Math.min(Number(entry?.max_pages) || DEFAULT_MAX_PAGES, 10));

    const base = new URL(ORIGIN + API_PATH);
    base.searchParams.set('country', 'kr');
    base.searchParams.set('job_sort', 'job.latest_order');
    base.searchParams.set('years', '-1');
    base.searchParams.set('limit', String(limit));

    for (const [k, v] of Object.entries(entry || {})) {
      if (ALLOWED_PARAMS.has(k) && v != null && v !== '') {
        base.searchParams.set(k, String(v));
      }
    }

    const now = Date.now();
    const jobs = [];
    const seen = new Set();

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(base);
      if (page > 0) url.searchParams.set('offset', String(page * limit));

      const body = await ctx.fetchJson(url.toString(), { headers: { accept: 'application/json' } });
      const found = findWantedJobs(body);
      if (found.length === 0) break;

      let added = 0;
      for (const raw of found) {
        const job = normalizeWantedJob(raw);
        if (!job) continue;
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        added++;

        const live = job.status === '' || job.status === 'active';
        const open = typeof job.dueAt !== 'number' || job.dueAt >= now;
        delete job.status;
        delete job.dueAt;
        if (live && open) jobs.push(job);
      }
      if (added === 0) break;
      if (!body?.links?.next) break;   // 서버가 다음 쪽이 없다고 말하면 멈춥니다

      if (page < maxPages - 1 && typeof ctx.sleep === 'function') await ctx.sleep(pace);
    }

    return jobs;
  },
};
