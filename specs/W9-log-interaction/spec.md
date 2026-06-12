# W9 — log-interaction Edge Function (feedback-loop write)

**Branch:** `w9-log-interaction` · **Area:** supabase · **DependsOn:** W1 (merged), W2 (merged)
**Status:** specify

## Problem
Find-spots (W5) and plan-day (W6) only get smarter if we observe what users actually
do with their results. The `public.user_interactions` table exists (migration
`00000000000006_user_feedback_loop.sql`) and is the rollup source for per-user weights,
heuristic-signal metrics, and spot-reinforcement. The Edge Function that writes to it is a
stub today (`supabase/functions/log-interaction/index.ts`) with an ad-hoc local
`LogInteractionRequest` type and a `// TODO: implement` insert. W9 wires it: validate the
W2-typed payload, forward the user's JWT into a Supabase client so RLS applies, and write
the row.

## Exploration findings (what already exists — do NOT rebuild)
- **`public.user_interactions` table is the target.** Columns map 1:1 to
  `LogInteractionRequest` (W2 `shared/types.ts:254-271`) plus `user_id` (FK to `auth.users`)
  and `at` (server-side `now()`). Migration: `00000000000006_user_feedback_loop.sql:34-70`.
- **`interaction_kind` enum (migration line 13-32) has 15 values** matching `InteractionKind`
  union in `shared/types.ts:236-251` — same `@SerialName` strings on the wire.
- **`query_location` is `geography(point, 4326)`** (migration line 48). Input is
  `{lat, lng}`; insert as PostGIS WKT `SRID=4326;POINT(${lng} ${lat})` (PostgreSQL
  auto-casts text → geography).
- **RLS policy:** `auth.uid() = user_id` for all operations
  (migration line 76-78). If we insert with the user's JWT and `user_id = auth.uid()`, RLS
  passes automatically.
- **`config.toml:42-43` already sets `verify_jwt = true` for log-interaction.** AC #3
  (auth enforcement) is config-side already.
- **The stub's philosophy** (lines 6-8): *"Designed to be FAST and FORGIVING — never error
  the calling UI for a missing optional field. Drop unknown kinds rather than 400."* This
  reads as a conflict with backbone AC #4 *"Invalid payloads return 400 with a typed error"*
  — resolved as D1 below.
- **W1 `_shared/env.ts` does NOT expose `SUPABASE_ANON_KEY`.** Required = service-role +
  URL only. W9 needs the anon key for the RLS-forwarding-client pattern (Supabase
  auto-injects `SUPABASE_ANON_KEY` into Edge Functions in production; local dev sources it
  from `supabase/.env`). W9 adds `config.supabaseAnonKey` to W1's helper — additive change,
  no existing caller affected.
- **Supabase client in Deno Edge Functions:** import via
  `npm:@supabase/supabase-js@2`. Same npm-specifier pattern as W4's
  `npm:@anthropic-ai/sdk`. Edge Functions support background work via
  `EdgeRuntime.waitUntil(promise)` — the response returns immediately and the insert
  completes after.
- **No Edge Function in pulse has been wired end-to-end before.** `enrich-business` is
  partially built but it's a cron, not user-facing. W9 establishes the pattern for W5/W6/W8.

## Acceptance Criteria Coverage Map

| # | AC fragment (verbatim) | Type | Disposition |
|---|------------------------|------|-------------|
| 1a | "POST /functions/v1/log-interaction accepts a LogInteractionRequest (W2)" | Backend | **Demonstrated** — typed import from `shared/types.ts`; request body type-checked at parse time |
| 1b | "and writes to the user_feedback_loop tables (migration 00000000000006)" | Backend | **Demonstrated** — `supabase.from('user_interactions').insert(...)` succeeds against the local stack; row appears in the table with the W2 payload mapped to the schema columns |
| 1c | "RLS-scoped to auth.uid()" | Backend | **Demonstrated** — using the anon key + forwarded user JWT, the insert sets `user_id = auth.uid()` via the JWT's `sub` claim; another user's JWT cannot write rows attributed to the first user (RLS policy enforces) |
| 2 | "Fire-and-forget contract honored: returns 202/200 fast; never blocks the client" | Backend | **Demonstrated** — response returns 202 within ~10 ms (before the DB roundtrip completes); insert runs via `EdgeRuntime.waitUntil()` in the background |
| 3 | "verify_jwt = true enforced; an unauthenticated call is rejected" | Convention | **Explained** — `config.toml:42-43` sets `verify_jwt = true`; Supabase rejects the request at the platform layer before our code runs, returning 401. Verify by citation + a smoke test against the local stack |
| 4 | "Invalid payloads return 400 with a typed error" | Backend | **Demonstrated** — unparseable JSON → 400 `{error: "invalid_json"}`; missing required `kind` field → 400 `{error: "missing_field", field: "kind"}`; unknown enum value → 200 `{ok: true, dropped: "unknown_kind"}` (per D1) |

## Decisions to confirm (settled by exploration / spec)

- **D1 — 400 vs. drop-with-200 reconciliation.** The backbone AC says invalid → 400; the stub
  says drop-with-200. Reconciled:
  - **400** for truly malformed requests: non-JSON body, missing the required `kind` field.
  - **200 with `dropped` field** for valid envelopes that fail business validation: unknown
    `kind` enum value, optional `spotPlaceId` for a `spot_*` kind, optional fields with the
    wrong primitive type. Per the stub philosophy + AC #2's fire-and-forget UX — the iOS/
    Android clients should never see a 400 for "we logged this event with a typo in the
    kind field."
  - The `LogInteractionResponse` shape from W2 (`{ok, dropped?}`) supports this exactly.
- **D2 — RLS via forwarded JWT.** Edge Function creates a Supabase client with the **anon
  key** and forwards the user's `Authorization: Bearer <jwt>` header. Insert proceeds as the
  user; RLS `auth.uid() = user_id` passes automatically. Service-role key is NOT used here
  — keeping it scoped to cron/admin paths.
- **D3 — Fire-and-forget via `EdgeRuntime.waitUntil`.** Schedule the insert with
  `EdgeRuntime.waitUntil(insertPromise)` and return 202 immediately. Errors during the
  background insert are logged via `console.error` but never bubble to the client. (AC #2
  explicitly says the response is fast; the only way to honor that with a DB write is
  background dispatch.)
- **D4 — PostGIS WKT for `query_location`.** Input `{lat, lng}` → SQL value
  `SRID=4326;POINT(${lng} ${lat})`. PostgreSQL auto-casts text → geography. Reject
  obviously-invalid coords (NaN, |lat| > 90, |lng| > 180) at the validation step → drop with
  200, not 400 (per D1).
- **D5 — Add `SUPABASE_ANON_KEY` to W1's env helper.** Minimal additive change:
  `config.supabaseAnonKey` joins the required list. Supabase auto-injects this in
  production; local dev gets it from `supabase/.env` (W1's documented flow). Update
  `supabase/.env.example` to list it.
- **D6 — Drop unknown kind vs. throw.** Unknown `kind` (a string that's not in the
  `InteractionKind` union) → response `{ok: true, dropped: "unknown_kind"}` + a
  `console.warn` for forensics. Matches stub philosophy + future-compatibility: an old
  client sending a deprecated kind should never break.

## Requirements (each traces to a fragment)
- **R1 (→1a, 4):** Replace the ad-hoc local `LogInteractionRequest` with the canonical
  `LogInteractionRequest` + `InteractionKind` from `shared/types.ts` (W2). Validate at
  parse time.
- **R2 (→D5):** Extend `_shared/env.ts` (W1) with a required `supabaseAnonKey` getter for
  `SUPABASE_ANON_KEY`. Add `SUPABASE_ANON_KEY=` to `supabase/.env.example` under the
  "Required for MVP" header.
- **R3 (→1b, 1c, D2):** Create a Supabase client per-request with the anon key + the user's
  forwarded `Authorization` header (`npm:@supabase/supabase-js@2`). Insert into
  `user_interactions` with columns mapped from the W2 payload (W2 field name → snake_case
  column).
- **R4 (→1c):** Set `user_id` from the JWT's `sub` claim (or let RLS enforce; we don't set
  it explicitly — the policy `with check (auth.uid() = user_id)` requires it). Actually: we
  *do* set `user_id = (await supabase.auth.getUser()).data.user.id` so the row is correctly
  attributed; RLS validates.
- **R5 (→2, D3):** Schedule the insert via `EdgeRuntime.waitUntil(insertPromise)`. Return
  202 immediately. Background-insert errors → `console.error`, not propagated.
- **R6 (→4, D1, D6):** Validation order:
  1. Parse JSON → on failure, 400 `{error: "invalid_json"}`.
  2. Check `kind` present and string → on failure, 400 `{error: "missing_field", field: "kind"}`.
  3. Check `kind` is a known `InteractionKind` value → on failure, 200 `{ok: true, dropped: "unknown_kind"}`.
  4. Validate `queryLocation` if present (NaN / out-of-range) → on failure, 200 `{ok: true, dropped: "invalid_location"}`.
  5. Schedule insert; return 202.
- **R7 (→3):** Cite `supabase/config.toml:42-43` in verify; smoke-test an unauthenticated
  POST against the local stack and confirm 401.
- **R8 (→1a, 4):** Deno unit tests for the validation order — each path (200 valid, 400
  invalid JSON, 400 missing kind, 200 dropped unknown kind, 200 dropped invalid location).
  Mock the Supabase client via the same DI seam pattern as W4 (`__setSupabaseClientForTest`).

## Story-local rules (resolved decisions)
- **Edge Function file:** `supabase/functions/log-interaction/index.ts` (existing stub —
  rewrite, do not create new).
- **Supabase client:** `npm:@supabase/supabase-js@2`. Convention precedent: W4's
  `npm:@anthropic-ai/sdk@0.40.1`.
- **Response shape:** `LogInteractionResponse` from W2 (`{ok: boolean, dropped?: string}`).
  Always return that shape on 200/202; for 400 return `{ok: false, error: string, field?: string}`.
- **HTTP status:** 202 for success (background insert pending); 400 for the two
  malformed-request cases; 200 for "valid envelope but dropped for business reason".
- **`cors.ts` reused** as in every other function.

## Resolved Questions
- *Use anon key or service-role for the insert?* → Anon + forwarded JWT (D2).
- *Block on the insert or fire-and-forget?* → Fire-and-forget via `EdgeRuntime.waitUntil` (D3).
- *PostGIS geometry input format?* → WKT `SRID=4326;POINT(lng lat)` (D4).
- *Where does the anon key live in env.ts?* → New required getter `config.supabaseAnonKey` (D5).
- *Unknown enum value → 400 or drop?* → Drop with 200 (D6 + AC reconciliation D1).

## Open product/UX questions
- None. This is a pure backend write behind a stable AC + an existing schema.

## Out of scope
- **The nightly rollup job** that reads `user_interactions` and updates `user_preferences`
  + `heuristic_signal_metrics` + `spot_reinforcement`. Different slice (post-MVP cron).
- **Per-user weight application at find-spots query time.** Belongs in W5 once
  `user_preferences` has data.
- **Batch logging.** Single events per request is enough for MVP.
- **Client-side retry on 5xx.** Client concern; out of W9.
- **Cohort assignment / collaborative filtering.** Post-MVP.
