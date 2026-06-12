# W1 — Secrets & config plumbing across Edge Functions and clients

**Branch:** `w1-secrets-and-config-plumbing` · **Area:** supabase (+ clients) · **DependsOn:** —
**Status:** specify

## Problem
The Edge Functions need secrets (Claude API key, Google Places key, the cron `x-ingest-secret`)
and the mobile clients need to point at a Supabase URL + anon key — local stack for dev, prod
later. Today there is no single, validated way to load these, and there's no `.env.example` to
document what's required. This item establishes that plumbing so every downstream backend slice
(W3, W4, …) can assume config is available and fail loudly when it isn't.

## Exploration findings (what already exists — do NOT rebuild)
- **iOS is already wired.** `ios/project.yml:40-41` maps `SUPABASE_URL`/`SUPABASE_ANON_KEY` into
  `Info.plist`; `ios/Pulse/ApiClient.swift:83-92` reads them via `configValue(...)` and throws
  `ApiError.missingConfig` when absent. Values come from `Config.xcconfig` (placeholders today).
- **Android is already wired.** `android-app/build.gradle.kts:21-28` reads `SUPABASE_URL`/
  `SUPABASE_ANON_KEY` from env → `gradleProperty` (`local.properties`) → `""` fallback into
  `BuildConfig`; `ViewModels.kt:24-25` consumes `BuildConfig.*`.
- **`.gitignore` already covers** `.env`, `.env.*.local`, `**/Config.local.xcconfig`,
  `local.properties`.
- **Gap = the Edge Function side.** Functions currently have no env helper. `_shared/scoring.ts`
  exists; the convention for Deno-shared code is `supabase/functions/_shared/`.

So W1's actual work is server-side config + documentation, NOT re-plumbing the clients.

## Acceptance Criteria Coverage Map
Every atomic AC fragment, its type, and how it's closed out.

| # | AC fragment (verbatim) | Type | Disposition |
|---|------------------------|------|-------------|
| 1 | "Edge Functions read CLAUDE_API_KEY, GOOGLE_PLACES_API_KEY, and INGEST_SECRET … via a single typed config helper (e.g. `_shared/env.ts`)" | Backend | **Demonstrated** — a function importing the helper returns its values; missing-var path returns a clear error |
| 2 | "throws a clear error when a required var is missing" | Backend | **Demonstrated** — calling the helper with an unset var throws a named, message-bearing error (unit-testable) |
| 3 | "`supabase/.env.example` lists every required var" | Convention | **Explained** — file exists listing all required keys with comments; cited in verify |
| 4 | "`supabase functions serve --env-file` picks them up locally" | Backend | **Demonstrated** — local serve with the env file resolves the vars (smoke evidence) |
| 5 | "production uses `supabase secrets set`" | Context | **Explained** — documented in the secrets-flow doc; not exercised locally |
| 6 | "iOS Config.xcconfig and Android local.properties carry SUPABASE_URL + SUPABASE_ANON_KEY and a documented way to point at the local stack vs prod" | Convention | **Explained** — already wired (see findings); this item adds the doc + a `Config.local.xcconfig` example + local-vs-prod note |
| 7 | "No secret is committed; .gitignore covers .env and Config.xcconfig" | Convention | **Explained** — verify `.gitignore` rules + `git check-ignore` proof; the committed `Config.xcconfig` holds only placeholders |

## Requirements (each traces to a fragment)
- **R1 (→1,2):** `supabase/functions/_shared/env.ts` exporting a `requireEnv(name)` + a typed
  `config` accessor for `CLAUDE_API_KEY`, `GOOGLE_PLACES_API_KEY`, `INGEST_SECRET` (and the
  Supabase service vars Edge Functions need). Missing → throw `ConfigError(name)`.
- **R2 (→3,5):** `supabase/.env.example` enumerating every required var with a one-line comment;
  a short "secrets flow" doc section (local `--env-file` vs prod `supabase secrets set`).
- **R3 (→4):** Confirm `supabase functions serve --env-file supabase/.env` resolves the vars
  (smoke).
- **R4 (→6):** Add `ios/Pulse/Config.local.xcconfig` example/instructions + a README/doc note on
  pointing iOS & Android at `http://localhost:54321` vs prod. No client code changes expected.
- **R5 (→7):** Verify nothing secret is tracked (`git check-ignore` on `.env`, a sample
  `Config.local.xcconfig`); keep `Config.xcconfig` placeholder-only.

## Story-local rules (resolved decisions)
- Edge-function shared code lives in `supabase/functions/_shared/` (matches existing
  `_shared/scoring.ts`). The env helper goes there, not at repo root.
- Client plumbing is already correct; this item documents and example-files it rather than
  changing `ApiClient.swift` / `build.gradle.kts`.

## Resolved Questions
- *Where does the env helper live?* → `supabase/functions/_shared/env.ts` (convention-settled by
  `_shared/scoring.ts`).
- *Do the clients need code changes?* → No; exploration shows both already read config correctly.

## Open product/UX questions
- None. Exploration settled the design; this is mechanical config plumbing.

## Out of scope
- Auth/JWT (that's W14). This item only ensures the anon key + URL reach the clients and the
  service secrets reach the functions.
