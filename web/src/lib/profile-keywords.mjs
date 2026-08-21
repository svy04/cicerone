/**
 * profile-keywords.mjs — read search keywords out of `config/profile.yml`'s
 *  block, or the Korean fork's .
 *
 * The core already does this in `providers/_profile-keywords.mjs`
 * (`profileTargetKeywords`), and this is a deliberate mirror of it, not a
 * second design: Turbopack's root is pinned to `web/` and refuses modules
 * outside it (see next.config.mjs and tracker-table.mjs's header), so a
 * build-time import of the core helper is not available here.
 *
 * It exists as a named, tested function because the inline version it replaces
 * had drifted from the core's in both fields it reads, and did so silently:
 *
 *   ...(typeof roles.primary === "string" ? [roles.primary] : []),
 *   ...(Array.isArray(roles.archetypes) ? roles.archetypes : []),
 *
 * `primary` is a LIST in `config/profile.example.yml` — and in what the web's
 * own writer emits (`api/profile/route.ts` → `{ primary: roles.slice(0, 6) }`)
 * — so the string test never fired. `archetypes` is a list of
 * `{name, level, fit}` objects, so spreading it raw yielded objects that the
 * caller's string cleaner then dropped. Both halves returned nothing, which
 * made `seedExploreFilters`'s profile.yml fallback dead code: the web wrote a
 * profile it could not read back.
 *
 * Plain `.mjs`, same pattern as clean-chips.mjs, so the test can import the
 * real module under Node without a TypeScript runner.
 */

/**
 * Extract candidate search keywords from a parsed profile.yml. Reads both
 * `target_roles: { primary[], archetypes[].name }` and `target: { roles[] }`.
 * Order is preserved and matches
 * the core helper's. Never throws — a missing or malformed block yields [].
 *
 * Returns raw strings; de-duplication and trimming are the caller's, so the
 * web can run them through the same `cleanChips` as every other keyword list.
 *
 * @param {unknown} profile - A parsed profile.yml (or anything at all).
 * @returns {string[]}
 */
export function profileTargetKeywords(profile) {
  if (!profile || typeof profile !== "object") return [];

  const out = [];

  const roles = profile.target_roles;
  if (roles && typeof roles === "object") {
    if (Array.isArray(roles.primary)) out.push(...roles.primary);
    if (Array.isArray(roles.archetypes)) out.push(...roles.archetypes.map((a) => a && a.name));
  }

  // Korean fork layout: the role list moved under `target`, which also carries
  // career_stage and the hiring track. Both shapes are read so a profile
  // written against either one keeps working (mirrors the core helper).
  const target = profile.target;
  if (target && typeof target === "object" && Array.isArray(target.roles)) {
    out.push(...target.roles);
  }

  return out.filter((k) => typeof k === "string");
}
