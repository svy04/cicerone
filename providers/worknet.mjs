// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 고용24(옛 워크넷) 채용정보 — 고용노동부가 운영하는 공공 채용 정보입니다.
//
// 긁는 것이 아니라 **공개 API** 입니다. 사용자가 본인 명의로 인증키를 받아야
// 하고, 도구가 대신 신청하지 않습니다.
//
//   1. https://openapi.work.go.kr 에서 오픈API 활용 신청
//   2. 승인 후 인증키(authKey) 발급
//   3. 환경변수 `WORKNET_API_KEY` 에 넣기 (저장소에 커밋하지 마세요)
//
// 민간 포털에 없는 것이 여기 있습니다. 공공기관·지자체 채용과 중소기업 공고가
// 많고, 임금이 숫자로 공개되는 비율이 민간 포털보다 높습니다.
//
// ── 확인한 것과 확인 못 한 것 ────────────────────────────────
// 실측 2026-08-21: `openapi.work.go.kr/opi/opi/opia/wantedApi.do` 는 200 을
// 돌려주고, 인증키가 없거나 틀리면 이렇게 답합니다.
//
//     <wantedRoot><message>유효하지 않은 인증키 입니다.</message>
//                 <messageCd>002</messageCd></wantedRoot>
//
// 이 오류 경로는 실제로 받아 확인했습니다. **정상 응답의 필드 이름은 문서 기준이고
// 실측하지 못했습니다** — 인증키가 있어야 볼 수 있기 때문입니다. 그래서 아래
// `pick()` 이 이름 후보를 여러 개 받습니다. 필드 이름이 문서와 다르면 공고가
// 조용히 사라지는 대신 「응답을 옮기지 못했다」고 알립니다.

import { assertAllowed } from './_robots.mjs';

const ORIGIN = 'https://openapi.work.go.kr';
const PATH = '/opi/opi/opia/wantedApi.do';
const DEFAULT_DISPLAY = 100;
const MAX_DISPLAY = 100;
const DEFAULT_MAX_PAGES = 3;
const PACE_MS = 1200;

/** 문서에서 확인한 질의 매개변수만 통과시킵니다. */
const ALLOWED_PARAMS = new Set([
  'region', 'occupation', 'career', 'salTp', 'minPay', 'maxPay',
  'holidayTp', 'minEdubg', 'maxEdubg', 'empTp', 'keyword', 'sortOrderBy',
]);

/**
 * XML 한 덩어리에서 태그 하나를 꺼냅니다. 이름 후보를 순서대로 봅니다.
 * @param {string} xml
 * @param {string[]} names
 * @returns {string}
 */
function pick(xml, names) {
  for (const name of names) {
    const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
    if (m) {
      const v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      if (v) return v;
    }
  }
  return '';
}

/**
 * 응답이 오류인지 봅니다. 오류면 서버가 준 한국어 문장을 그대로 돌려줍니다.
 * 시험에서 직접 부릅니다.
 *
 * @param {string} xml
 * @returns {string|null} 오류가 아니면 null
 */
export function readErrorMessage(xml) {
  if (typeof xml !== 'string') return null;
  const code = pick(xml, ['messageCd']);
  if (!code) return null;
  const message = pick(xml, ['message']) || `오류 코드 ${code}`;
  return `${message} (코드 ${code})`;
}

/**
 * 응답에서 공고 하나하나를 스캐너가 쓰는 모양으로 옮깁니다.
 * 시험에서 직접 부릅니다.
 *
 * @param {string} xml 응답 원문
 * @returns {Array<object>}
 */
export function parseWorknetXml(xml) {
  const out = [];
  if (typeof xml !== 'string') return out;

  for (const m of xml.matchAll(/<wanted>([\s\S]*?)<\/wanted>/gi)) {
    const item = m[1];

    const title = pick(item, ['title', 'wantedTitle']);
    const url = pick(item, ['wantedInfoUrl', 'infoUrl']);
    const authNo = pick(item, ['wantedAuthNo', 'wantedAuthNum']);
    if (!title) continue;
    if (!url && !authNo) continue;

    /** @type {any} */
    const job = {
      title,
      // 원문 주소를 그대로 씁니다. 응답에 없으면 인증번호로 되돌립니다.
      url: url || `${ORIGIN}/opi/opi/opia/wantedApi.do?wantedAuthNo=${authNo}`,
      company: pick(item, ['company', 'coNm', 'companyNm']),
      location: pick(item, ['region', 'workRegion', 'basicAddr']),
    };

    // 임금·경력·학력·근무형태는 응답이 이미 주는 것이라 따로 부르지 않습니다.
    const bits = [];
    const career = pick(item, ['career', 'careerNm']);
    if (career) bits.push(career);
    const edu = pick(item, ['minEdubg', 'minEdubgNm']);
    if (edu) bits.push(edu);
    const holiday = pick(item, ['holidayTpNm', 'holidayTp']);
    if (holiday) bits.push(holiday);
    const salType = pick(item, ['salTpNm', 'salTp']);
    const sal = pick(item, ['sal', 'salary']);
    if (sal) bits.push(salType ? `${salType} ${sal}` : sal);
    if (bits.length) job.description = bits.join(' · ');

    // 등록일은 `20260821` 처럼 옵니다.
    const reg = pick(item, ['regDt', 'regDate']).replace(/\D/g, '');
    if (reg.length === 8) {
      const t = Date.parse(`${reg.slice(0, 4)}-${reg.slice(4, 6)}-${reg.slice(6, 8)}T00:00:00+09:00`);
      if (!Number.isNaN(t)) job.postedAt = t;
    }

    // 마감일이 지난 공고는 목록에 남아 있어도 지원할 수 없습니다.
    const close = pick(item, ['closeDt', 'closeDate']).replace(/\D/g, '');
    if (close.length === 8) {
      const t = Date.parse(`${close.slice(0, 4)}-${close.slice(4, 6)}-${close.slice(6, 8)}T23:59:59+09:00`);
      if (!Number.isNaN(t)) job.closesAt = t;
    }

    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'worknet',

  detect(entry) {
    if (entry?.provider === 'worknet') return { url: ORIGIN + PATH };
    return null;
  },

  /**
   * @param {any} entry portals.yml 항목
   * @param {any} ctx HTTP 문맥
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    const key = process.env.WORKNET_API_KEY;
    if (!key) {
      throw new Error(
        'worknet: 인증키가 없습니다. 고용24 오픈API 는 본인 명의로 신청해 받은 인증키가 필요합니다.\n' +
        '  1. https://openapi.work.go.kr 에서 오픈API 활용 신청\n' +
        '  2. 승인 후 인증키를 환경변수 WORKNET_API_KEY 에 넣기\n' +
        '도구가 대신 신청하지 않습니다.',
      );
    }

    const { crawlDelay } = await assertAllowed(ORIGIN + PATH, ctx, 'career-ops');
    const pace = Math.max(PACE_MS, (crawlDelay || 0) * 1000);

    const display = Math.min(Math.max(Number(entry?.display) || DEFAULT_DISPLAY, 1), MAX_DISPLAY);
    const maxPages = Math.max(1, Math.min(Number(entry?.max_pages) || DEFAULT_MAX_PAGES, 20));

    const base = new URL(ORIGIN + PATH);
    base.searchParams.set('authKey', key);
    base.searchParams.set('callTp', 'L');       // L 목록 · D 상세
    base.searchParams.set('returnType', 'XML');
    base.searchParams.set('display', String(display));

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
      url.searchParams.set('startPage', String(page));

      const xml = await ctx.fetchText(url.toString(), { redirect: 'follow' });

      // 서버가 준 한국어 문장을 그대로 전합니다. 인증키 문제가 대부분입니다.
      const error = readErrorMessage(xml);
      if (error) throw new Error(`worknet: ${error}`);

      const found = parseWorknetXml(xml);
      if (found.length === 0) {
        // 첫 쪽부터 하나도 못 옮겼는데 응답에 공고 덩어리는 있었다면,
        // 필드 이름이 바뀐 것입니다. 조용히 빈손으로 끝내지 않습니다.
        if (page === 1 && /<wanted>/i.test(xml)) {
          throw new Error(
            'worknet: 응답에 공고가 들어 있는데 하나도 옮기지 못했습니다. ' +
            '필드 이름이 바뀐 것으로 보입니다 — providers/worknet.mjs 의 이름 후보를 고쳐야 합니다.',
          );
        }
        break;
      }

      let added = 0;
      for (const job of found) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        added++;
        if (typeof job.closesAt === 'number' && job.closesAt < now) continue;
        delete job.closesAt;
        jobs.push(job);
      }
      if (added === 0) break;
      if (found.length < display) break;   // 마지막 쪽

      if (page < maxPages && typeof ctx.sleep === 'function') await ctx.sleep(pace);
    }

    return jobs;
  },
};
