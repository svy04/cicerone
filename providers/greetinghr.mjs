// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 그리팅(greetinghr) 채용 페이지.
//
// 국내 기업이 자기 채용 페이지를 만들 때 쓰는 채용 관리 시스템입니다.
// 주소 형태는 `{회사}.career.greetinghr.com` 입니다.
// 카카오페이, 여기어때 같은 곳이 이 위에 채용 페이지를 올려 두었습니다.
//
// 왜 이 경로인가: 채용 포털은 이용약관이 자동 수집을 금지하고 크롤링 분쟁 판례가 있습니다.
// 반면 기업이 직접 운영하는 채용 페이지는 사람이 보라고 공개해 둔 것이고,
// 그리팅 채용 서브도메인의 robots.txt 는 `User-agent: * / Allow: /` 입니다 (2026-08-21 확인).
// 개발자가 채용 정보를 얻는 경로 1위도 기업 채용 페이지였습니다
// (프로그래머스 2022 설문, 중복응답 44.0%).
//
// 지키는 것:
//   · 사용자가 portals.yml 에 적어 둔 회사만 읽습니다. 그리팅 전체를 훑지 않습니다
//   · robots.txt 를 따릅니다
//   · 요청 사이에 간격을 둡니다
//   · 원문 주소를 그대로 보존합니다. 수집한 공고를 어디에도 재배포하지 않습니다
//
// 읽는 방법: 목록 페이지는 Next.js 서버 렌더링이고, 공고 배열이 페이지 안의
// `__NEXT_DATA__` 스크립트에 JSON 으로 들어 있습니다. 추가 요청 없이 한 번에 받습니다.

const HOST_RE = /^([a-z0-9-]+)\.career\.greetinghr\.com$/i;

/**
 * portals.yml 항목에서 회사 채용 페이지 주소를 뽑습니다.
 * @param {any} entry
 * @returns {string|null}
 */
function resolveUrl(entry) {
  const raw = entry?.careers_url || entry?.api;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const u = new URL(raw.trim());
      if (HOST_RE.test(u.hostname)) return u.toString();
    } catch { /* 주소가 아니면 아래로 */ }
  }
  // provider 를 명시하고 slug 만 준 경우
  const slug = entry?.greeting_slug;
  if (typeof slug === 'string' && /^[a-z0-9-]+$/i.test(slug)) {
    return `https://${slug}.career.greetinghr.com/ko/main`;
  }
  return null;
}

/**
 * 페이지 HTML 에서 __NEXT_DATA__ JSON 을 꺼냅니다.
 * @param {string} html
 * @returns {any|null}
 */
export function extractNextData(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * __NEXT_DATA__ 안에서 공고 배열을 찾습니다.
 * React Query 가 담아 둔 dehydratedState 의 queries 중 openings 를 씁니다.
 * @param {any} nextData
 * @returns {Array<any>}
 */
export function findOpenings(nextData) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return [];

  for (const q of queries) {
    const key = q?.queryKey;
    const flat = Array.isArray(key) ? key.map(k => (typeof k === 'string' ? k : '')).join('|') : '';
    if (!/openings/i.test(flat)) continue;

    const data = q?.state?.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.openings)) return data.openings;
    if (Array.isArray(data?.data)) return data.data;
  }
  return [];
}

/**
 * 공고 하나를 스캐너가 쓰는 모양으로 옮깁니다.
 * 필드 이름은 그리팅 응답 원문 그대로입니다.
 * @param {any} o
 * @param {string} origin 회사 채용 페이지의 origin
 * @param {string} fallbackCompany
 * @returns {object|null}
 */
export function normalizeOpening(o, origin, fallbackCompany = '') {
  if (!o || typeof o !== 'object') return null;

  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const id = o.openingId;
  if (!title || id == null) return null;

  const url = `${origin}/ko/o/${id}`;

  // 근무지: openingJobPosition 안에 배열로 들어 있습니다
  const positions = o.openingJobPosition?.openingJobPositions;
  let location = '';
  if (Array.isArray(positions) && positions.length) {
    const place = positions[0]?.workspacePlace;
    location = (place?.location || place?.place || '').toString().trim();
  }

  const postedAt = (() => {
    if (!o.openDate) return undefined;
    const t = Date.parse(o.openDate);
    return Number.isNaN(t) ? undefined : t;
  })();

  const out = {
    title,
    url,
    company: (o.group?.name || fallbackCompany || '').toString().trim(),
    location,
  };
  if (postedAt) out.postedAt = postedAt;
  return out;
}

/** @type {Provider} */
export default {
  id: 'greetinghr',

  detect(entry) {
    const url = resolveUrl(entry);
    if (url) return { url };
    return entry?.provider === 'greetinghr' ? { url: '' } : null;
  },

  /**
   * @param {any} entry
   * @param {any} ctx
   * @returns {Promise<Array<object>>}
   */
  async fetch(entry, ctx) {
    const url = resolveUrl(entry);
    if (!url) {
      throw new Error(
        'greetinghr: 회사 채용 페이지 주소가 없습니다. portals.yml 항목에 ' +
        'careers_url 로 https://{회사}.career.greetinghr.com/ko/main 을 적거나 ' +
        'greeting_slug 로 회사 식별자를 적으세요. 이 모듈은 지정한 회사만 읽습니다.',
      );
    }

    const origin = new URL(url).origin;
    const html = await ctx.fetchText(url, { redirect: 'follow' });
    const nextData = extractNextData(html);

    if (!nextData) {
      throw new Error(
        `greetinghr: ${origin} 페이지에서 공고 데이터를 찾지 못했습니다. ` +
        '페이지 구조가 바뀌었을 수 있습니다. 브라우저로 열어 확인하세요.',
      );
    }

    const openings = findOpenings(nextData);
    const fallbackCompany = entry?.name || '';

    const jobs = [];
    const seen = new Set();
    for (const o of openings) {
      const job = normalizeOpening(o, origin, fallbackCompany);
      if (!job || seen.has(job.url)) continue;
      seen.add(job.url);
      jobs.push(job);
    }
    return jobs;
  },
};
