// @ts-check
// _robots.mjs — robots.txt 를 실제로 읽고 경로 허용 여부를 판정한다.
//
// 왜 있나: 수집 규칙 넷 중 두 번째("robots.txt 를 본다")를 코드로 집행하기 위해서다.
// 문서에 "robots 를 지킨다"고 적어 두는 것과 요청 전에 실제로 확인하는 것은 다르다.
//
// 이 규칙이 임의 기준이 아닌 이유: 서울중앙지법 2015가합517982(잡코리아 대 사람인)
// 1심이 정상 크롤링과 문제 된 수집을 가를 때 "가상사설망으로 주소를 분산하고
// robots.txt 를 보지 않은 채 HTML 을 긁은 것은 정상 크롤링과 다르다"고 적시했다.
// 반대로 "정체를 명시하고 아웃링크로 보내는 검색로봇은 선별 허용"이라고 봤다.
//
// 구현 범위: robots.txt 의 실제 관행을 따른다.
//   · User-agent 그룹을 읽고, 우리 이름에 맞는 그룹이 있으면 그것을, 없으면 `*` 그룹을 쓴다
//   · Allow 와 Disallow 중 **경로가 더 긴 규칙이 이긴다** (구글이 문서화한 방식)
//   · 같은 길이면 Allow 가 이긴다
//   · `*` 와 `$` 와일드카드를 처리한다
//   · Crawl-delay 를 읽어 호출자에게 넘긴다
//
// 한 호스트의 robots.txt 는 프로세스 안에서 한 번만 받는다. 판정하려고 매번
// 받으면 그 자체가 서버에 부담이다.

const cache = new Map();

/** robots.txt 를 못 받았을 때 쓰는 기본값 — 막지 않는다. */
const PERMISSIVE = { rules: [], crawlDelay: null, fetched: false };

/**
 * robots.txt 한 줄의 경로 패턴을 정규식으로 바꾼다.
 * `*` 는 아무 문자열, `$` 는 끝을 뜻한다. 나머지는 글자 그대로.
 * @param {string} pattern
 * @returns {RegExp}
 */
function patternToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') out += '.*';
    else if (ch === '$' && i === pattern.length - 1) out += '$';
    else out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out);
}

/**
 * robots.txt 본문을 파싱한다. 우리 이름에 맞는 그룹을 고르고, 없으면 `*` 그룹.
 *
 * @param {string} text robots.txt 원문
 * @param {string} agent 우리 사용자 에이전트에서 뽑은 이름 (소문자)
 * @returns {{rules: Array<{allow: boolean, pattern: string, re: RegExp}>, crawlDelay: number|null, fetched: boolean}}
 */
export function parseRobots(text, agent = '*') {
  const groups = new Map();   // user-agent -> { rules, crawlDelay }
  let current = [];

  const ensure = (ua) => {
    const key = ua.toLowerCase();
    if (!groups.has(key)) groups.set(key, { rules: [], crawlDelay: null });
    return groups.get(key);
  };

  let lastWasUserAgent = false;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // 연속된 User-agent 줄은 같은 규칙 묶음을 공유한다
      if (!lastWasUserAgent) current = [];
      current.push(value);
      lastWasUserAgent = true;
      continue;
    }
    lastWasUserAgent = false;

    if (current.length === 0) continue;

    if (field === 'allow' || field === 'disallow') {
      // 빈 Disallow 는 "아무것도 막지 않는다"는 뜻이라 규칙으로 넣지 않는다
      if (field === 'disallow' && value === '') continue;
      for (const ua of current) {
        ensure(ua).rules.push({
          allow: field === 'allow',
          pattern: value,
          re: patternToRegExp(value),
        });
      }
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) {
        for (const ua of current) ensure(ua).crawlDelay = n;
      }
    }
  }

  // 우리 이름에 맞는 그룹이 있으면 그것을 쓴다. 없으면 `*`.
  const wanted = agent.toLowerCase();
  let picked = null;
  for (const [key, group] of groups) {
    if (key === '*') continue;
    if (wanted.includes(key) || key.includes(wanted)) { picked = group; break; }
  }
  if (!picked) picked = groups.get('*') || { rules: [], crawlDelay: null };

  return { rules: picked.rules, crawlDelay: picked.crawlDelay, fetched: true };
}

/**
 * 경로가 허용되는지 판정한다.
 * 경로가 더 긴 규칙이 이기고, 같은 길이면 Allow 가 이긴다.
 *
 * @param {{rules: Array<{allow: boolean, pattern: string, re: RegExp}>}} robots
 * @param {string} pathname 질의 문자열을 포함한 경로
 * @returns {boolean}
 */
export function isAllowed(robots, pathname) {
  if (!robots || !Array.isArray(robots.rules) || robots.rules.length === 0) return true;

  let best = null;
  for (const rule of robots.rules) {
    if (!rule.re.test(pathname)) continue;
    if (
      best === null ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

/**
 * 한 호스트의 robots.txt 를 받아 파싱한다. 프로세스 안에서 호스트당 한 번만 받는다.
 *
 * 못 받으면 막지 않는다(`fetched: false`). robots.txt 가 없는 서버가 흔하고,
 * 못 받았다는 이유로 접근을 막으면 정상적인 사이트까지 못 읽는다. 다만 호출자가
 * `fetched` 를 보고 판단할 수 있게 그 사실을 알린다.
 *
 * @param {string} url 대상 주소
 * @param {any} ctx HTTP 문맥 (fetchText 를 가진 것)
 * @param {string} [agent] 사용자 에이전트 이름
 * @returns {Promise<{rules: Array<any>, crawlDelay: number|null, fetched: boolean}>}
 */
export async function loadRobots(url, ctx, agent = 'career-ops') {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return PERMISSIVE;
  }

  const key = origin + '|' + agent;
  if (cache.has(key)) return cache.get(key);

  let result = PERMISSIVE;
  try {
    const text = await ctx.fetchText(origin + '/robots.txt', { redirect: 'follow' });
    if (typeof text === 'string' && text.length > 0 && text.length < 512 * 1024) {
      result = parseRobots(text, agent);
    }
  } catch {
    // 404·403·타임아웃 — 막지 않는다
  }

  cache.set(key, result);
  return result;
}

/**
 * 요청 전에 부르는 관문. 막힌 경로면 이유를 담아 던진다.
 *
 * @param {string} url 읽으려는 주소
 * @param {any} ctx HTTP 문맥
 * @param {string} [agent] 사용자 에이전트 이름
 * @returns {Promise<{crawlDelay: number|null}>}
 */
export async function assertAllowed(url, ctx, agent = 'career-ops') {
  const robots = await loadRobots(url, ctx, agent);
  const u = new URL(url);
  const path = u.pathname + (u.search || '');

  if (!isAllowed(robots, path)) {
    throw new Error(
      `robots.txt 가 이 경로를 막고 있습니다: ${u.origin}${path}\n` +
      '이 도구는 robots.txt 를 지킵니다. 막힌 경로는 읽지 않습니다.',
    );
  }
  return { crawlDelay: robots.crawlDelay };
}

/** 시험용 — 호스트 캐시를 비운다. */
export function clearRobotsCache() {
  cache.clear();
}
