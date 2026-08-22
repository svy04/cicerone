// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 리멤버 커리어 공고 — 사이트맵으로 목록을 얻고, 공고 하나씩 읽습니다.
//
// ── 지키는 넷 ────────────────────────────────────────────────
//   1. 정체를 밝힌다 — ctx 가 붙이는 cicerone 사용자 에이전트로 200 이 옵니다.
//      브라우저 문자열을 흉내 내지 않습니다
//   2. robots.txt 를 본다 — 요청 전에 `assertAllowed` 가 판정합니다
//   3. 원문 주소를 남긴다 — `career.rememberapp.co.kr/job/posting/{id}` 를 씁니다
//   4. 재배포하지 않는다 — 결과는 사용자 컴퓨터의 파일로만 갑니다
//
// ── 왜 공고를 하나씩 읽나 ────────────────────────────────────
// 다른 모듈은 목록 한 장에서 공고 수십 개를 한꺼번에 가져옵니다. 여기만 다릅니다.
// 실측(2026-08-21) robots.txt 가 이렇게 적고 있기 때문입니다.
//
//     Allow: /sitemap*.xml
//     Allow: /job/
//     Disallow: /*?*seed=
//     Disallow: /job_postings/        ← 화면이 목록을 받아 오는 경로
//
// 목록을 만들어 주는 `/job_postings/` 가 막혀 있고, `/job/postings` 화면의 HTML
// 에는 공고가 들어 있지 않습니다. 남는 허용 경로는 사이트맵과 공고 상세뿐입니다.
// 그래서 사이트맵에서 번호를 얻고 공고를 하나씩 엽니다.
//
// 대신 **요청 수가 공고 수만큼 늘어납니다.** 사이트맵에는 13,748건이 들어 있어서
// 전부 읽으면 하루가 걸리고 서버에도 부담입니다. 그래서 이 모듈은 기본 25건만,
// 번호가 큰 쪽(= 최근 등록분)부터 읽습니다. `limit` 으로 조절하되, 올린 만큼
// 요청이 그대로 늘어난다는 것을 알고 올려야 합니다.
//
// 공고 상세 HTML 은 서버가 데이터를 같이 실어 보냅니다(`__NEXT_DATA__`).
// 제목·회사·근무지·경력·기간이 전부 거기 있어서 화면을 흉내 낼 필요가 없습니다.

import { assertAllowed } from './_robots.mjs';

const ORIGIN = 'https://career.rememberapp.co.kr';
const SITEMAP = '/sitemap-jobs.xml';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;   // 이 위는 요청 수가 감당이 안 됩니다
const PACE_MS = 1200;

/**
 * 사이트맵에서 공고 번호를 뽑습니다. 등록 순서대로(오름차순) 돌려줍니다.
 * 시험에서 직접 부릅니다.
 *
 * @param {string} xml sitemap-jobs.xml 원문
 * @returns {number[]}
 */
export function parseSitemapIds(xml) {
  if (typeof xml !== 'string') return [];
  const ids = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const hit = m[1].match(/\/job\/posting\/(\d+)/);
    if (hit) ids.push(Number(hit[1]));
  }
  return ids;
}

/**
 * 공고 상세 HTML 에서 데이터를 꺼냅니다. 시험에서 직접 부릅니다.
 *
 * @param {string} html 공고 상세 페이지 원문
 * @returns {any|null} 못 찾으면 null
 */
export function extractPostingData(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1]);
    const queries = json?.props?.pageProps?.dehydratedState?.queries;
    if (!Array.isArray(queries)) return null;
    for (const q of queries) {
      const data = q?.state?.data?.data;
      if (data && typeof data === 'object' && data.title) return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 공고 하나를 스캐너가 쓰는 모양으로 옮깁니다. 시험에서 직접 부릅니다.
 *
 * @param {any} d extractPostingData 가 돌려준 객체
 * @returns {object|null} 제목이나 번호가 없으면 null
 */
export function normalizePosting(d) {
  if (!d || typeof d !== 'object') return null;
  const title = String(d.title || '').trim();
  const id = d.id;
  if (!title || id == null) return null;

  const addr = d.normalizedAddress;
  const location = addr
    ? [addr.level1, addr.level2].filter(Boolean).join(' ')
    : (Array.isArray(d.addresses) && d.addresses[0]
        ? [d.addresses[0].addressLevel1, d.addresses[0].addressLevel2].filter(Boolean).join(' ')
        : '');

  // 경력 조건은 상세에 이미 있는 값이라 따로 부르지 않습니다.
  const bits = [];
  const min = Number.isFinite(d.minExperience) ? d.minExperience : null;
  const max = Number.isFinite(d.maxExperience) ? d.maxExperience : null;
  if (min != null && max != null) bits.push(`경력 ${min}~${max}년`);
  else if (min != null) bits.push(`경력 ${min}년↑`);
  else if (max != null) bits.push(`경력 ~${max}년`);
  if (Array.isArray(d.jobCategories) && d.jobCategories.length) {
    bits.push(d.jobCategories.map(c => c?.level2 || c?.level1).filter(Boolean).slice(0, 3).join(', '));
  }

  /** @type {any} */
  const out = {
    title,
    url: `${ORIGIN}/job/posting/${id}`,
    company: String(d.organization?.name || '').trim(),
    location,
  };
  if (bits.length) out.description = bits.join(' · ');

  const startsAt = typeof d.startsAt === 'string' ? Date.parse(d.startsAt) : NaN;
  if (!Number.isNaN(startsAt)) out.postedAt = startsAt;

  out.status = String(d.status || '');
  if (typeof d.endsAt === 'string') {
    const t = Date.parse(d.endsAt);
    if (!Number.isNaN(t)) out.endsAt = t;
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'remember',

  detect(entry) {
    if (entry?.provider === 'remember') return { url: ORIGIN + '/job/postings' };
    return null;
  },

  /**
   * @param {any} entry portals.yml 항목
   * @param {any} ctx HTTP 문맥
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    const { crawlDelay } = await assertAllowed(ORIGIN + SITEMAP, ctx, 'cicerone');
    const pace = Math.max(PACE_MS, (crawlDelay || 0) * 1000);

    const limit = Math.min(Math.max(Number(entry?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const xml = await ctx.fetchText(ORIGIN + SITEMAP, { redirect: 'follow' });
    const ids = parseSitemapIds(xml);
    if (ids.length === 0) return [];

    // 사이트맵은 번호 오름차순입니다. 뒤쪽이 최근 등록분입니다.
    const targets = ids.slice(-limit).reverse();

    const keywords = Array.isArray(entry?.keywords)
      ? entry.keywords.map(k => String(k).toLowerCase()).filter(Boolean)
      : [];

    const now = Date.now();
    const jobs = [];

    for (let i = 0; i < targets.length; i++) {
      const url = `${ORIGIN}/job/posting/${targets[i]}`;

      // 공고 하나가 없어졌다고 나머지를 포기하지 않습니다.
      let html;
      try {
        html = await ctx.fetchText(url, { redirect: 'follow' });
      } catch {
        if (i < targets.length - 1 && typeof ctx.sleep === 'function') await ctx.sleep(pace);
        continue;
      }

      const job = normalizePosting(extractPostingData(html));
      if (job) {
        const live = job.status === '' || job.status === 'published';
        const open = typeof job.endsAt !== 'number' || job.endsAt >= now;
        delete job.status;
        delete job.endsAt;

        const hay = `${job.title} ${job.company}`.toLowerCase();
        const wanted = keywords.length === 0 || keywords.some(k => hay.includes(k));

        if (live && open && wanted) jobs.push(job);
      }

      if (i < targets.length - 1 && typeof ctx.sleep === 'function') await ctx.sleep(pace);
    }

    return jobs;
  },
};
