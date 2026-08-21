// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 사람인 채용정보 검색 API (https://oapi.saramin.co.kr/guide/job-search).
//
// 이 모듈은 크롤러가 아닙니다. 사람인이 공개한 공식 API를 씁니다.
// 사람인 이용약관 제23조 ③은 자동화된 수단으로 데이터베이스에 접근하는 것을
// 금지하고 있고, 잡코리아와의 크롤링 분쟁은 대법원까지 가서 확정됐습니다
// (서울고법 2016나2019365, 대법원 2017다224395). 그래서 이 도구는 사람인을 긁지 않고
// 사용자가 본인 명의로 발급받은 열쇠로 공식 창구를 두드립니다.
//
// 쓰기 전에 할 일 (사용자 본인이 합니다. 도구가 대신 신청하지 않습니다):
//   1. https://oapi.saramin.co.kr/join 에서 이용 신청
//   2. 승인 후 access-key 발급
//   3. 환경변수 SARAMIN_ACCESS_KEY 에 넣거나 portals.yml 항목에 access_key 로 적기
//
// 사람인이 정한 제한 (주의사항 원문 기준):
//   · 1일 500회
//   · 한 요청당 최대 110건
//   · access-key 를 남에게 주거나 공개하지 않기
//   · 받은 데이터를 되팔거나 대가를 받지 않기
//   · 사람인과 제휴 관계인 것처럼 보이게 하지 않기
//
// 열쇠를 저장소에 커밋하지 마세요. 환경변수를 권합니다.

const ENDPOINT = 'https://oapi.saramin.co.kr/job-search';
const MAX_COUNT = 110;      // 문서상 한 요청 최대
const DEFAULT_COUNT = 110;
const MAX_PAGES = 4;        // 하루 500회 한도를 감안한 기본 상한

/**
 * 발급 열쇠를 찾습니다. 환경변수를 먼저 보고, 없으면 portals.yml 항목을 봅니다.
 * @param {any} entry
 * @returns {string|null}
 */
function resolveKey(entry) {
  const fromEnv = process.env.SARAMIN_ACCESS_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const fromEntry = entry && (entry.access_key || entry.saramin_access_key);
  if (typeof fromEntry === 'string' && fromEntry.trim()) return fromEntry.trim();
  return null;
}

/**
 * 문서에 있는 요청 매개변수만 통과시킵니다.
 * 문서에 없는 이름을 임의로 만들어 보내지 않습니다.
 */
const ALLOWED_PARAMS = new Set([
  'keywords', 'bbs_gb', 'stock', 'sr',
  'loc_cd', 'loc_mcd', 'loc_bcd',
  'ind_cd', 'job_mid_cd', 'job_cd',
  'job_type', 'edu_lv', 'fields',
  'published', 'published_min', 'published_max',
  'updated', 'updated_min', 'updated_max',
  'deadline', 'sort',
]);

/**
 * 응답의 공고 하나를 스캐너가 쓰는 모양으로 옮깁니다.
 * 필드 이름은 사람인 문서 원문 그대로입니다.
 * @param {any} j
 * @returns {object|null}
 */
export function normalizeSaraminJob(j) {
  if (!j || typeof j !== 'object') return null;

  const title = j.position?.title;
  const url = j.url;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;

  // active 가 0 이면 이미 마감된 공고입니다. 죽은 공고에 평가를 쓰지 않습니다.
  if (j.active === 0 || j.active === '0') return null;

  const postedAt = (() => {
    const ts = Number(j['posting-timestamp']);
    return Number.isFinite(ts) && ts > 0 ? ts * 1000 : undefined;
  })();

  const out = {
    title: title.trim(),
    url: url.trim(),
    company: (j.company?.detail?.name || '').trim(),
    location: (j.position?.location?.name || '').trim(),
  };
  if (postedAt) out.postedAt = postedAt;
  return out;
}

/** @type {Provider} */
export default {
  id: 'saramin',

  detect(entry) {
    return entry?.provider === 'saramin' ? { url: ENDPOINT } : null;
  },

  /**
   * @param {any} entry portals.yml 항목
   * @param {any} ctx HTTP 문맥
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    const key = resolveKey(entry);
    if (!key) {
      throw new Error(
        'saramin: access-key 가 없습니다. https://oapi.saramin.co.kr/join 에서 본인 명의로 신청해 발급받은 뒤 ' +
        '환경변수 SARAMIN_ACCESS_KEY 에 넣거나 portals.yml 항목에 access_key 로 적으세요. ' +
        '이 도구는 사람인을 크롤링하지 않고 공식 API만 씁니다.',
      );
    }

    const count = Math.min(Number(entry?.count) || DEFAULT_COUNT, MAX_COUNT);
    const maxPages = Math.max(1, Math.min(Number(entry?.max_pages) || MAX_PAGES, 10));

    const base = new URL(ENDPOINT);
    base.searchParams.set('access-key', key);
    base.searchParams.set('count', String(count));
    // 게시일·마감일을 함께 받습니다
    base.searchParams.set('fields', entry?.fields || 'posting-date,expiration-date');

    for (const [k, v] of Object.entries(entry || {})) {
      if (ALLOWED_PARAMS.has(k) && v != null && v !== '') {
        base.searchParams.set(k, String(v));
      }
    }

    const jobs = [];
    const seen = new Set();

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(base);
      url.searchParams.set('start', String(page));

      const json = await ctx.fetchJson(url.toString(), {
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });

      // 오류 응답: { code, message }
      if (json && typeof json.code !== 'undefined' && json.jobs === undefined) {
        const hint = {
          1: 'access-key 를 넣지 않았습니다',
          2: 'access-key 가 유효하지 않습니다',
          3: '요청 매개변수가 유효하지 않습니다',
          4: '오늘 호출 한도(500회)를 넘었습니다',
        }[Number(json.code)] || '알 수 없는 오류';
        throw new Error(`saramin: ${hint} (code=${json.code}, message=${json.message || ''})`);
      }

      const list = json?.jobs?.job;
      const arr = Array.isArray(list) ? list : (list ? [list] : []);
      if (arr.length === 0) break;

      for (const raw of arr) {
        const job = normalizeSaraminJob(raw);
        if (!job) continue;
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }

      const total = Number(json?.jobs?.total);
      if (Number.isFinite(total) && (page + 1) * count >= total) break;
      if (arr.length < count) break;
      if (typeof ctx.sleep === 'function') await ctx.sleep(300);
    }

    return jobs;
  },
};
