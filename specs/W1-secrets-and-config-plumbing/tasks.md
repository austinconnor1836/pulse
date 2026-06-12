# W1 — Tasks

**Branch:** `w1-secrets-and-config-plumbing` · **Builds on:** `spec.md`, `plan.md`

Two commits, in order. Build first, document second.

---

## Commit 1 — Edge Function env helper

### T1. Create `supabase/functions/_shared/env.ts`
- Export `class ConfigError extends Error` — message format:
  ``Missing required env var "${name}". Set it in supabase/.env (local) or via `supabase secrets set ${name}=…` (prod).``
- Export `function requireEnv(name: string): string` — calls `Deno.env.get(name)`; throws
  `ConfigError(name)` if undefined OR empty string.
- Export `function optionalEnv(name: string): string | undefined` — same source, undefined on
  missing/empty.
- Export `const config` — frozen object with **lazy getters** (not eager constants), so
  importing `env.ts` doesn't crash module-load when an unused-by-this-function var is unset:
  - Required (throw on access if missing): `anthropicApiKey`, `googlePlacesApiKey`,
    `ingestSecret`, `supabaseUrl`, `supabaseServiceRoleKey`.
  - Optional (undefined on missing): `redditUserAgent`, `eventbriteToken`, `diceToken`.
- Mapping (camelCase → env var):

  | Getter | Env var |
  |---|---|
  | `anthropicApiKey` | `ANTHROPIC_API_KEY` |
  | `googlePlacesApiKey` | `GOOGLE_PLACES_API_KEY` |
  | `ingestSecret` | `INGEST_SECRET` |
  | `supabaseUrl` | `SUPABASE_URL` |
  | `supabaseServiceRoleKey` | `SUPABASE_SERVICE_ROLE_KEY` |
  | `redditUserAgent` | `REDDIT_USER_AGENT` |
  | `eventbriteToken` | `EVENTBRITE_TOKEN` |
  | `diceToken` | `DICE_TOKEN` |

- File header: one-line comment naming the module's role + that secret values never log.

### T2. Unit test — `supabase/functions/_shared/env.test.ts`
- Deno test runner (matches what `supabase functions` ships).
- `requireEnv("UNSET_NAME_FOR_TEST")` → throws `ConfigError`, message contains the name.
- `requireEnv("SET_NAME_FOR_TEST")` after `Deno.env.set(...)` → returns the value.
- `optionalEnv("UNSET")` → `undefined`; `optionalEnv("SET")` → value.
- `config.anthropicApiKey` accessor: throws when unset; returns value when set.
- Restore env between cases (`Deno.env.delete`).

### T3. Refine `supabase/.env.example`
- Add a header block above the existing vars:
  - Required for MVP: `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, `INGEST_SECRET`,
    `SUPABASE_SERVICE_ROLE_KEY`.
  - Optional fallbacks: `REDDIT_USER_AGENT`, `EVENTBRITE_TOKEN`, `DICE_TOKEN`.
  - Local: `supabase functions serve --env-file supabase/.env`.
  - Prod: `supabase secrets set --env-file supabase/.env`.
- Add `SUPABASE_SERVICE_ROLE_KEY=` to the variable list (currently missing).
- Keep existing vars + their comments.

**Commit 1 message:** `W1: env helper for Edge Functions`

---

## Commit 2 — Client examples + docs

### T4. Create `ios/Pulse/Config.local.xcconfig.example`
- Tracked in-tree (`.gitignore` excludes only the real `Config.local.xcconfig`).
- Contents (preserves the `$()` URL-escape idiom from existing `Config.xcconfig`):

  ```
  // Copy to Config.local.xcconfig. xcodegen reads these into Info.plist.
  // Local stack: run `supabase start`, paste anon key from its output.

  SUPABASE_URL = http:/$()/localhost:54321
  SUPABASE_ANON_KEY = <paste from `supabase start` output>
  ```

### T5. Create `android-app/local.properties.example`
- Tracked in-tree (`.gitignore` excludes `local.properties`).
- Contents:

  ```
  # Copy to local.properties. Gradle reads via gradleProperty into BuildConfig.
  # Local stack: run `supabase start`, paste anon key from its output.

  SUPABASE_URL=http://localhost:54321
  SUPABASE_ANON_KEY=<paste from `supabase start` output>
  ```

### T6. Add "Config & secrets" section to `README.md`
- Where to set each secret: `supabase/.env` (server) vs `Config.local.xcconfig` (iOS) vs
  `local.properties` (Android).
- Local-vs-prod toggle: replace `localhost:54321` with the prod project URL + anon key.
- Cite the read sites — `ApiClient.swift:83-92` (iOS) and `build.gradle.kts:21-28` (Android)
  — so future edits don't re-implement existing wiring.
- One-liner about the AC-name reconciliation: the Claude API key is named
  `ANTHROPIC_API_KEY` to match the Anthropic SDK convention.

### T7. Sanity-verify `.gitignore` (no edit expected)
- Confirm with `git check-ignore -v` that:
  - `supabase/.env` is ignored.
  - `ios/Pulse/Config.local.xcconfig` is ignored.
  - `android-app/local.properties` is ignored.
- If any gap shows up, add the rule in this commit and note it; otherwise this is a no-edit
  verification step.

**Commit 2 message:** `W1: client config examples + README config section`

---

## Verification (Phase 5 preview)

The Coverage Map closes out via:

| AC fragment | Evidence in gallery |
|---|---|
| 1, 2 (typed helper + throws clear error) | Demonstrated — Deno test output (T2) + a one-shot import-and-call from a scratch function showing both paths. |
| 3 (`.env.example` lists every required var) | Explained — show file contents post-T3, cite line numbers. |
| 4 (`supabase functions serve --env-file` resolves vars) | Demonstrated — terminal recording: `supabase functions serve --env-file supabase/.env`, hit a probe endpoint, helper reads the var. |
| 5 (prod uses `supabase secrets set`) | Explained — cite README section from T6. |
| 6 (iOS/Android documented local-vs-prod) | Explained — cite README + example files. |
| 7 (no secret committed; `.gitignore` covers) | Explained — paste `git check-ignore` output from T7. |

## Tracker-mirror policy

No mirror. Pulse has no external tracker; the workflow backbone is the source of truth.

## Next gate

Pre-implement confirm.
