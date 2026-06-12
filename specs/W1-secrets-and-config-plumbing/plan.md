# W1 — Plan

**Branch:** `w1-secrets-and-config-plumbing` · **Builds on:** `spec.md`

## Reconciliation with existing state
Re-exploration before planning found three precedent constraints:

1. **`supabase/.env.example` ALREADY EXISTS** and uses `ANTHROPIC_API_KEY` (Anthropic SDK
   convention), not the AC's verbatim `CLAUDE_API_KEY`. It also enumerates
   `REDDIT_USER_AGENT`, `EVENTBRITE_TOKEN`, `DICE_TOKEN`, and `INGEST_SECRET` — the spec's
   AC named only three. **Precedent wins:** the env helper exports `ANTHROPIC_API_KEY` and
   recognizes the full set in `.env.example`. The AC's `CLAUDE_API_KEY` is satisfied in
   substance (the Claude API key has a typed accessor); only the variable *name* differs.
2. **`scoring.ts` imports types as** `from '../../../shared/types.ts'` — the canonical
   repo-root shared/types.ts path. The env helper has no type dependency on `shared/types.ts`,
   so this is a heads-up for downstream slices, not a constraint here.
3. **`Config.xcconfig`** uses the xcconfig URL-escape `https:/$()/REPLACE-ME.supabase.co` —
   `$()` is xcconfig's way to inject an empty expansion so `//` isn't read as a comment. Any
   example file we add must preserve that idiom.

## Approach
Five tightly-scoped changes; nothing speculative. Order is build-then-document.

### Change 1 — `supabase/functions/_shared/env.ts` (new)
Single typed-config module. Exports:

- `requireEnv(name: string): string` — reads `Deno.env.get(name)`, throws `ConfigError` with a
  message naming the missing var + the file where it should be set.
- `class ConfigError extends Error` — distinct error type so callers can pattern-match.
- `config` — a frozen object with lazy getters for every named secret. Accessing a missing
  one throws via `requireEnv`. Names:
  - `ANTHROPIC_API_KEY` (Claude judge — matches Anthropic SDK + existing `.env.example`)
  - `GOOGLE_PLACES_API_KEY`
  - `INGEST_SECRET`
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (functions talking back to the DB; the
    runtime injects these but explicit access keeps prod parity)
  - Optional (return `string | undefined`, no throw): `REDDIT_USER_AGENT`, `EVENTBRITE_TOKEN`,
    `DICE_TOKEN` — present in `.env.example`, used by W10 ingest-events.

Lazy getters (not eager constants) — so importing `_shared/env.ts` in a function that doesn't
need `INGEST_SECRET` won't crash at module-load time during local dev.

### Change 2 — refine `supabase/.env.example`
Already exists. Add a short header block clarifying:
- Required-for-MVP: `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, `INGEST_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- Optional fallbacks: `REDDIT_USER_AGENT`, `EVENTBRITE_TOKEN`, `DICE_TOKEN`.
- Local dev: `supabase functions serve --env-file supabase/.env`.
- Prod: `supabase secrets set --env-file supabase/.env`.

### Change 3 — `ios/Pulse/Config.local.xcconfig.example` (new)
Tracked example showing the local-stack config. `.gitignore` already excludes
`**/Config.local.xcconfig`, so the example file is what we ship in-tree. Contents:

```
SUPABASE_URL = http:/$()/localhost:54321
SUPABASE_ANON_KEY = <paste from `supabase start` output>
```

Preserves the `$()` URL-escape idiom from existing `Config.xcconfig`.

### Change 4 — `android-app/local.properties.example` (new)
Mirror for the Android side:

```
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<paste from `supabase start` output>
```

(No URL escape needed — Gradle properties read as raw strings.)

### Change 5 — `README.md` config section
A "Config & secrets" section that:
- Names every required var and where it's read.
- Documents the local-vs-prod toggle for iOS (`Config.local.xcconfig`) and Android
  (`local.properties`) — copy the `.example`, fill in, restart the build.
- Documents the `supabase functions serve --env-file` vs `supabase secrets set` split.
- Cites `ApiClient.swift:83-92` and `build.gradle.kts:21-28` as the read points (so future
  edits don't re-implement what already works).

## Files touched

| Path | Action |
|------|--------|
| `supabase/functions/_shared/env.ts` | create |
| `supabase/.env.example` | edit (add header block) |
| `ios/Pulse/Config.local.xcconfig.example` | create |
| `android-app/local.properties.example` | create |
| `README.md` | edit (add Config & secrets section) |

No changes to `ApiClient.swift`, `build.gradle.kts`, `.gitignore`, `config.toml`, or any
existing function — confirmed by the spec's exploration findings.

## Constitution Check
Engineering principles, gated.

| # | Principle | Status |
|---|-----------|--------|
| I | **Vertical slice.** | ✓ Single concern — config plumbing — touches one shared module + 4 docs/example files. |
| II | **Convention before invention.** | ✓ Env helper lives at `supabase/functions/_shared/env.ts` (precedent: `_shared/scoring.ts`). Var names follow `.env.example` precedent (`ANTHROPIC_API_KEY`). xcconfig example preserves the `$()` URL-escape idiom. |
| III | **AC are the contract.** | ✓ Every Coverage Map fragment maps to a change above. AC's `CLAUDE_API_KEY` ≠ impl name `ANTHROPIC_API_KEY` is reconciled in §Reconciliation; the *substance* (Claude key has typed accessor) holds. |
| IV | **Fail loud at boundaries.** | ✓ `ConfigError` names the missing var and the file to set it in — no silent fallback to `""` for required vars. |
| V | **No speculative scope.** | ✓ Optional fallback vars (Reddit/Eventbrite/DICE) get typed accessors only because they already appear in `.env.example` — not adding any vars not already listed. |
| VI | **No duplication of working code.** | ✓ Spec exploration confirmed iOS + Android already read config correctly; this item does NOT touch those code paths, only documents them. |
| VII | **Errors are typed.** | ✓ `ConfigError extends Error` — callers can pattern-match. |
| VIII | **No commented-out code.** | ✓ Nothing being replaced; net-new code only. |
| IX | **Tests where they catch real bugs.** | A small unit test for `requireEnv` (missing → throws `ConfigError`; present → returns value) is genuinely useful (it's the boundary). No tests for the doc files or example files. |
| X | **Isolate classes of change.** | ✓ One commit for env.ts + .env.example refinement; one commit for client example files + README. No conformance refactors mixed in (none needed). |
| XI | **No speculative version bumps.** | n/a — no shared package versions involved. |

## Risks
- **Var-naming AC drift.** If a downstream reviewer reads the AC literally, the
  `CLAUDE_API_KEY` → `ANTHROPIC_API_KEY` rename could read as a gap. The Reconciliation
  section + commit message will explicitly cite precedent. Acceptable.
- **`supabase functions serve --env-file` smoke.** Requires `supabase` CLI + a running stack
  on the verify host. Verify gallery captures terminal output, not a Playwright clip.

## Next phase
Tasks. Then pre-implement confirm.
