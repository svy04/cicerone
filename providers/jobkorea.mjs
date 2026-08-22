// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 잡코리아 공고 목록 — 직무·지역·기업형태 탭을 읽습니다.
//
// ── 지키는 넷 ────────────────────────────────────────────────
//   1. 정체를 밝힌다 — ctx 가 붙이는 cicerone 사용자 에이전트를 씁니다
//   2. robots.txt 를 본다 — 요청 전에 `assertAllowed` 가 판정합니다
//   3. 원문 주소를 남긴다 — 공고마다 잡코리아 원문 주소를 보존합니다
//   4. 재배포하지 않는다 — 결과는 사용자 컴퓨터의 파일로만 갑니다
//
// ── 키워드 검색을 쓰지 않는 이유 ──────────────────────────────
// 잡코리아 robots.txt(실측 2026-08-21)는 User-agent `*` 에서 이렇게 적고 있습니다.
//
//     Disallow: /Search/?stext=
//     Disallow: /Search?TS_Search=
//     Allow: /recruit/joblist
//     Allow: /Recruit/GI_Read
//
// 그래서 이 모듈은 검색어로 찾지 않고, **허용된 목록 탭**만 읽습니다.
// 원하는 키워드가 있으면 받아 온 제목에 대고 사용자 컴퓨터에서 거릅니다.
// 서버에 검색을 시키지 않는다는 뜻입니다. `assertAllowed` 가 이중으로 막지만,
// 애초에 그 경로를 만들지 않는 것이 이 파일의 설계입니다.
//
// 페이지 구조 실측 2026-08-21: 서버가 HTML 을 그립니다(`__NEXT_DATA__` 없음).
// 공고 하나가 `<tr class="devloopArea" data-gno="...">` 로 들어 있고 기본 40건입니다.

import { decodeEntities } from './_html-entities.mjs';
import { assertAllowed } from './_robots.mjs';

const ORIGIN = 'https://www.jobkorea.co.kr';
const LIST_PATH = '/recruit/joblist';
const DEFAULT_MAX_PAGES = 3;
const PACE_MS = 1200;   // robots 에 Crawl-delay 가 없어도 간격을 둡니다

/** 실측으로 확인한 탭 이름만 받습니다. */
const MENUCODES = new Set(['duty', 'local', 'industry', 'cotype1', 'edu3']);

/** 목록 주소에 붙는 것으로 확인된 매개변수. 없는 이름을 만들지 않습니다. */
const ALLOWED_PARAMS = new Set([
  'menucode', 'duty', 'local', 'localorder', 'industry',
  'cotype', 'edu', 'career', 'jobtype',
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
 * 목록 HTML 에서 공고를 뽑습니다. 시험에서 직접 부릅니다.
 *
 * `p.etc span.cell` 은 공고마다 칸 수가 달라서(경력·학력·근무지·고용형태·급여가
 * 있을 때만 나옵니다) 자리로 세지 않고 값의 생김새로 가릅니다.
 *
 * @param {string} html 목록 페이지 원문
 * @returns {Array<{title: string, url: string, company: string, location: string, meta: string[]}>}
 */
export function parseJobKoreaList(html) {
  const out = [];
  if (typeof html !== 'string') return out;

  const rows = html.split(/<tr[^>]*class="[^"]*\bdevloopArea\b[^"]*"/i).slice(1);

  for (const raw of rows) {
    const head = raw.slice(0, 400);
    const gnoMatch = head.match(/data-gno="(\d+)"/);
    if (!gnoMatch) continue;
    const gno = gnoMatch[1];

    // 제목 — td.tplTit 안의 a. title 속성이 가장 깨끗합니다
    const titBlock = raw.match(/<td[^>]*class="[^"]*\btplTit\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (!titBlock) continue;
    const anchor = titBlock[1].match(/<a[^>]*href="\/Recruit\/GI_Read\/\d+[^"]*"[^>]*>/i);
    const titleAttr = anchor ? anchor[0].match(/title="([^"]*)"/) : null;
    let title = titleAttr ? decodeEntities(titleAttr[1]).trim() : '';
    if (!title) {
      const strong = titBlock[1].match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
      title = strong ? text(strong[1]) : '';
    }
    if (!title) continue;

    // 회사 — td.tplCo 안의 첫 a 하나만 씁니다. 그 칸에는 회사명 뒤로
    // 「관심기업」「코스닥」 같은 표지가 더 붙습니다. 칸 전체를 긁으면 회사 이름이 오염됩니다.
    const coBlock = raw.match(/<td[^>]*class="[^"]*\btplCo\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const coAnchor = coBlock ? coBlock[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i) : null;
    const company = coAnchor ? text(coAnchor[1]) : (coBlock ? text(coBlock[1]) : '');

    // 부가 정보 — p.etc 의 span.cell 들
    const etc = titBlock[1].match(/<p[^>]*class="[^"]*\betc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const meta = etc
      ? [...etc[1].matchAll(/<span[^>]*class="[^"]*\bcell\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
          .map(m => text(m[1]))
          .filter(Boolean)
      : [];

    // 근무지 — 광역시·도 이름으로 시작하는 칸. 자리 번호로 세지 않습니다
    const location = meta.find(v => /^(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주|전국|해외)/.test(v)) || '';

    out.push({
      title,
      url: `${ORIGIN}/Recruit/GI_Read/${gno}`,
      company,
      location,
      meta,
    });
  }
  return out;
}

/**
 * 받아 온 공고를 사용자 컴퓨터에서 거릅니다.
 * 서버에 검색을 시키지 않으므로 robots 를 건드리지 않습니다.
 *
 * @param {Array<{title: string, company: string}>} jobs
 * @param {string[]} keywords
 * @returns {Array<any>}
 */
export function filterByKeywords(jobs, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return jobs;
  const needles = keywords.map(k => String(k).toLowerCase()).filter(Boolean);
  if (needles.length === 0) return jobs;
  return jobs.filter(job => {
    const hay = `${job.title} ${job.company}`.toLowerCase();
    return needles.some(n => hay.includes(n));
  });
}

/** @type {Provider} */
export default {
  id: 'jobkorea',

  detect(entry) {
    if (entry?.provider === 'jobkorea') return { url: ORIGIN + LIST_PATH };
    return null;
  },

  /**
   * @param {any} entry portals.yml 항목
   * @param {any} ctx HTTP 문맥
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    const base = new URL(ORIGIN + LIST_PATH);

    const menucode = String(entry?.menucode || 'duty');
    if (!MENUCODES.has(menucode)) {
      throw new Error(
        `jobkorea: 모르는 탭입니다: ${menucode}. 확인된 것은 ${[...MENUCODES].join(', ')} 입니다.`,
      );
    }
    base.searchParams.set('menucode', menucode);

    for (const [k, v] of Object.entries(entry || {})) {
      if (ALLOWED_PARAMS.has(k) && v != null && v !== '') {
        base.searchParams.set(k, String(v));
      }
    }

    // robots 관문 — 막힌 경로면 여기서 멈춥니다
    const { crawlDelay } = await assertAllowed(base.toString(), ctx, 'cicerone');
    const pace = Math.max(PACE_MS, (crawlDelay || 0) * 1000);

    const maxPages = Math.max(1, Math.min(Number(entry?.max_pages) || DEFAULT_MAX_PAGES, 10));

    const jobs = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(base);
      if (page > 1) url.searchParams.set('Page', String(page));

      let html;
      try {
        html = await ctx.fetchText(url.toString(), { redirect: 'follow' });
      } catch (err) {
        // 첫 페이지가 실패하면 알립니다. 뒷 페이지는 거기까지 받은 것으로 끝냅니다.
        // 잡코리아의 다음 쪽 주소는 실측에서 확정하지 못했고(`/recruit/_GI_List?Page=2`
        // 는 404), 여기서 조용히 멈추면 "1페이지만 받아 왔다"가 됩니다.
        if (page === 1) throw err;
        break;
      }

      const found = parseJobKoreaList(html);
      if (found.length === 0) break;

      let added = 0;
      for (const job of found) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
        added++;
      }
      // `Page` 를 서버가 무시하면 같은 목록이 다시 옵니다. 그때 멈춥니다.
      if (added === 0) break;

      if (page < maxPages && typeof ctx.sleep === 'function') await ctx.sleep(pace);
    }

    // 경력·학력·고용형태·급여는 목록 HTML 이 이미 주는 것이라 따로 요청하지 않습니다.
    // 공고 하나를 더 부르지 않는다는 뜻이고, 계약상 `description` 자리에 넣습니다.
    return filterByKeywords(jobs, entry?.keywords).map(({ meta, ...job }) => (
      meta && meta.length ? { ...job, description: meta.join(' · ') } : job
    ));
  },
};
