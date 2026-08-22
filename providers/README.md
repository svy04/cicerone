# providers/

Job-source provider modules for the zero-token portal scanner (`scan.mjs`).

## Purpose

Each non-helper `*.mjs` file in this directory maps one public, no-auth job
source (ATS API, RSS/XML feed, or server-rendered HTML page) to the scanner's
normalized `Job` shape. Providers are zero-token by design: they hit public
endpoints directly, with no LLM calls and no login. The user-facing catalog of
supported sources lives in
[docs/SUPPORTED_JOB_BOARDS.md](../docs/SUPPORTED_JOB_BOARDS.md).

## 한국 소스 (이 포크에서 추가)

이 저장소는 한국 시장이 정본이라 국내 공고 소스를 따로 둡니다. `saramin.mjs` 와 `greetinghr.mjs` 입니다.

**새로 만들 때 지켜야 하는 넷** — 판결이 정상적인 수집과 문제 된 수집을 가른 기준입니다(서울중앙지법 2015가합517982 1심).

1. **정체를 밝힌다** — `user-agent.mjs` 의 공용 사용자 에이전트를 씁니다. 브라우저 문자열을 흉내 내지 않습니다
2. **robots.txt 를 본다** — 막아 둔 경로는 건드리지 않습니다. 인크루트와 링크드인은 전면 금지라 대상이 아닙니다
3. **원문 주소를 남긴다** — `url` 필드에 공고 원문 주소를 그대로 넣습니다
4. **요청 간격을 둔다** — `ctx.sleep(ms)` 를 씁니다. 한 번에 몰아치지 않습니다

`tests/providers-korea.test.mjs` 가 1·2·4를 검사합니다. 근거와 판례는 `docs/market-evidence.md` 5절에 있습니다.

공식 API 를 쓰는 모듈은 **열쇠를 사용자가 직접 발급받게** 하고, 열쇠가 없을 때 어디서 신청하는지 안내하며 멈춥니다. 도구가 대신 신청하지 않습니다.

## Module contract

The authoritative contract is the JSDoc type catalog in
[`_types.js`](_types.js). Every provider is the **default export** of its
file:

```js
/** @typedef {import('./_types.js').Provider} Provider */

/** @type {Provider} */
export default {
  id: 'myboard',                 // unique across all loaded providers
  detect(entry) { ... },         // optional: claim a portals.yml entry
  async fetch(entry, ctx) { ... } // required: return Job[]
};
```

- `id` (required) — unique string; on a duplicate the first loaded provider
  wins and the later file is skipped with a warning (`_registry.mjs`).
- `detect(entry)` (optional) — return `{ url }` to claim a `portals.yml`
  entry, or `null`. Two styles exist: URL-pattern matching on
  `entry.careers_url` (e.g. `greenhouse.mjs`, `lever.mjs`) and explicit-only
  (`return entry?.provider === 'myboard' ? { url: FEED_URL } : null`) for
  board-wide feeds.
- `fetch(entry, ctx)` (required) — resolve the source and return an array of
  `Job` objects.

### Job shape (see `_types.js` for the full typedef)

- `title` — required, non-empty after trim.
- `url` — required, absolute; used as the dedup key.
- `company`, `location` — strings, may be empty.
- `description` — optional; populate ONLY when the list payload carries it
  for free (no extra per-job request — the scanner is zero-token).
- `postedAt` — optional epoch ms; omit when the source has no usable date.

### Context (`ctx`)

`fetch` receives an HTTP context built by [`_http.mjs`](_http.mjs):
`fetchText(url, opts?)` and `fetchJson(url, opts?)` with a 10s default
timeout and a `cicerone` user agent; non-2xx responses throw an `Error`
carrying `.status`, `.body`, and `.retryAfter`. Paginating providers should
honor the optional `ctx.maxPages` hint (the portal health probe passes 1) and
use the optional `ctx.sleep(ms)` pacing hook when present.

## Loading and routing

There is no index file — discovery is filesystem-convention-based
(`_registry.mjs`):

1. Every `providers/*.mjs` file NOT starting with `_` is dynamically
   imported, in alphabetical order (so `detect()` priority is deterministic).
2. For each `portals.yml` entry, routing precedence is: explicit
   `provider: <id>` field first (bypasses detect), then the configured
   `local-parser`, then each provider's `detect()` in load order — first
   non-null hit wins.

Underscore-prefixed files are shared helpers, never loaded as providers:
`_types.js` (contract typedefs), `_registry.mjs` (loader/router),
`_http.mjs` (HTTP transport), `_html-entities.mjs`, `_trust-validator.mjs`.

## Security conventions

Every provider validates the target host against an allowlist before
fetching and passes `redirect: 'error'` so a server-side redirect cannot be
used for SSRF (see `assertGreenhouseUrl` in `greenhouse.mjs` for the
pattern). A shared regression test enforces this across providers:
`tests/providers/ats-ssrf-hardening.test.mjs`.

## Adding a provider

1. Create `providers/<name>.mjs` with the default export above. Mirror a
   provider of the same type: `greenhouse.mjs` (per-tenant JSON API),
   `larajobs.mjs` (RSS parsed in-process), or `radancy.mjs` (server-rendered
   HTML). RSS/HTML providers should export their pure parser function for
   direct unit testing.
2. Add `tests/providers/<name>.test.mjs` — it is auto-discovered
   (`tests/**/*.test.mjs`), no registration needed. Follow the existing
   pattern: dynamic-import the provider, assert `id`, exercise `detect()`
   positive/negative cases, and call `fetch` with a mock `ctx` whose
   `fetchJson`/`fetchText` return fixtures. Run it with
   `node test-all.mjs --only providers/<name>`.
3. Add a row to
   [docs/SUPPORTED_JOB_BOARDS.md](../docs/SUPPORTED_JOB_BOARDS.md) in the
   same PR.

Core providers must be zero-auth against public endpoints; auth-gated or
login-required sources belong in the plugin layer instead (see
[ARCHITECTURE.md](../ARCHITECTURE.md) and `CONTRIBUTING.md`).
