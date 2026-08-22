// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 사람인 공고 목록 — 검색 결과 페이지를 읽습니다.
//
// `saramin.mjs` 는 공식 API(열쇠 필요)를 씁니다. 이 모듈은 열쇠 없이 공개
// 검색 결과 페이지를 읽습니다. 둘 다 있는 이유: 열쇠를 받아 둔 사용자는 API 가
// 안정적이고, 아직 안 받은 사용자도 바로 쓸 수 있어야 합니다.
//
// ── 지키는 넷 ────────────────────────────────────────────────
//   1. 정체를 밝힌다 — ctx 가 붙이는 cicerone 사용자 에이전트를 씁니다.
//      브라우저 문자열을 흉내 내지 않습니다
//   2. robots.txt 를 본다 — 요청 전에 `assertAllowed` 가 판정합니다.
//      실측(2026-08-21): `/zf_user/search/recruit` 은 User-agent `*` 에서 허용,
//      금지된 것은 `/feed.php`·`/zf_user/jobs/view/etc` 등입니다. Crawl-delay 없음
//   3. 원문 주소를 남긴다 — 공고마다 사람인 원문 주소를 그대로 보존합니다
//   4. 재배포하지 않는다 — 결과는 사용자 컴퓨터의 파일로만 갑니다
//
// 이 넷은 임의 기준이 아니라 서울중앙지법 2015가합517982 1심이 정상 크롤링과
// 문제 된 수집을 가른 지점입니다. 그 사건에서 문제가 된 것은 경쟁 채용 사이트가
// 남의 공고를 긁어 자기 사이트에 게재한 일이었습니다.
//
// 페이지 구조 실측 2026-08-21: 서버가 HTML 을 그립니다(`__NEXT_DATA__` 없음).
// 공고 하나가 `div.item_recruit` 로 들어 있고 기본 40건입니다.

import { decodeEntities } from './_html-entities.mjs';
import { assertAllowed } from './_robots.mjs';

const ORIGIN = 'https://www.saramin.co.kr';
const SEARCH_PATH = '/zf_user/search/recruit';
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;   // UI 선택지 상한. 서버 상한은 확인 못 함
const DEFAULT_MAX_PAGES = 3;
const PACE_MS = 1200;        // robots 에 Crawl-delay 가 없어도 간격을 둡니다

/** 문서에서 확인한 질의 매개변수만 통과시킵니다. 없는 이름을 만들지 않습니다. */
const ALLOWED_PARAMS = new Set([
  'searchword', 'recruitSort', 'loc_mcd', 'loc_cd', 'exp_cd',
  'job_category', 'job_type', 'edu_lv', 'inner_com_type', 'search_optional_item',
]);

/**
 * 태그를 걷어내고 공백을 정리합니다.
 * @param {string} html
 * @returns {string}
 */
function text(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 검색 결과 HTML 에서 공고를 뽑습니다. 시험에서 직접 부릅니다.
 *
 * @param {string} html 검색 결과 페이지 원문
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseSaraminList(html) {
  const out = [];
  if (typeof html !== 'string') return out;

  // 공고 하나 = <div class="item_recruit" value="{rec_idx}"> … </div>
  // 중첩 div 를 정규식으로 세지 않고, 다음 item_recruit 나 목록 끝까지를 한 덩어리로 봅니다.
  const blocks = html.split(/<div[^>]*class="[^"]*\bitem_recruit\b[^"]*"/i).slice(1);

  for (const raw of blocks) {
    const head = raw.slice(0, 300);
    const idMatch = head.match(/value="(\d+)"/);
    if (!idMatch) continue;
    const recIdx = idMatch[1];

    // 제목 — h2.job_tit 안의 a 태그. title 속성이 있으면 그것이 가장 깨끗합니다
    const titleBlock = raw.match(/<h2[^>]*class="[^"]*\bjob_tit\b[^"]*"[\s\S]*?<\/h2>/i);
    if (!titleBlock) continue;
    const titleAttr = titleBlock[0].match(/title="([^"]+)"/);
    const title = titleAttr ? decodeEntities(titleAttr[1]).trim() : text(titleBlock[0]);
    if (!title) continue;

    // 회사 — strong.corp_name 안의 a
    const corp = raw.match(/<strong[^>]*class="[^"]*\bcorp_name\b[^"]*"[\s\S]*?<\/strong>/i);
    const company = corp ? text(corp[0]) : '';

    // 조건 — div.job_condition 의 span 들. 첫 칸이 근무지입니다
    const cond = raw.match(/<div[^>]*class="[^"]*\bjob_condition\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    let location = '';
    if (cond) {
      const spans = [...cond[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
        .map(m => text(m[1]))
        .filter(Boolean);
      location = spans[0] || '';
    }

    out.push({
      title,
      url: `${ORIGIN}/zf_user/jobs/relay/view?rec_idx=${recIdx}`,
      company,
      location,
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'saramin-web',

  detect(entry) {
    if (entry?.provider === 'saramin-web') return { url: ORIGIN + SEARCH_PATH };
    return null;
  },

  /**
   * @param {any} entry portals.yml 항목
   * @param {any} ctx HTTP 문맥
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    const base = new URL(ORIGIN + SEARCH_PATH);

    const pageSize = Math.min(Number(entry?.count) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const maxPages = Math.max(1, Math.min(Number(entry?.max_pages) || DEFAULT_MAX_PAGES, 10));

    base.searchParams.set('recruitPageCount', String(pageSize));
    if (!entry?.recruitSort) base.searchParams.set('recruitSort', 'relation');

    for (const [k, v] of Object.entries(entry || {})) {
      if (ALLOWED_PARAMS.has(k) && v != null && v !== '') {
        base.searchParams.set(k, String(v));
      }
    }

    // 설정을 먼저 봅니다. 조건이 없으면 요청을 한 번도 보내지 않고 멈춥니다.
    if (!base.searchParams.get('searchword') && !base.searchParams.get('loc_mcd')) {
      throw new Error(
        'saramin-web: 검색 조건이 없습니다. portals.yml 항목에 searchword 나 loc_mcd 중 하나는 넣어야 합니다. ' +
        '조건 없이 전체를 훑는 것은 이 도구가 하지 않습니다.',
      );
    }

    // robots 관문 — 막힌 경로면 여기서 멈춥니다
    const { crawlDelay } = await assertAllowed(base.toString(), ctx, 'cicerone');
    const pace = Math.max(PACE_MS, (crawlDelay || 0) * 1000);

    const jobs = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(base);
      url.searchParams.set('recruitPage', String(page));

      const html = await ctx.fetchText(url.toString(), { redirect: 'follow' });
      const found = parseSaraminList(html);
      if (found.length === 0) break;

      let added = 0;
      for (const job of found) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
        added++;
      }
      if (added === 0) break;   // 같은 페이지가 반복되면 멈춥니다

      if (page < maxPages && typeof ctx.sleep === 'function') await ctx.sleep(pace);
    }

    return jobs;
  },
};
