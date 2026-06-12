# W3 — Google Places client (Text Search + Distance Matrix)

**Branch:** `w3-google-places-client` · **Area:** supabase · **DependsOn:** W1 (merged)
**Status:** specify

## Problem
Find-spots (W5), plan-day (W6 via find-spots), and enrich-business (W11) all need a single,
typed Google Places client that handles candidate discovery (text search) + walk-time
distances + the API's pagination + rate-limit realities. Today the call sites are TODO
comments (`find-spots/index.ts:40-44`); no client exists. This item ships the shared module
so the next wave of slices can plug in.

## Exploration findings (what already exists — do NOT rebuild)
- **`find-spots/index.ts:40-41` names the expected functions in TODOs:**
  `googlePlacesTextSearch(body.purpose, body.location)` and
  `distanceMatrix(body.location, candidates)`. The AC names them `textSearch` and
  `distanceMatrix` (without the `googlePlaces` prefix); since the file is
  `_shared/places.ts`, the prefix would be redundant. **D1: ship as `textSearch` +
  `distanceMatrix`.** Find-spots's TODO comment updates in W5.
- **`enrich-business/index.ts:6-9, 21`** uses a **different** Places API — *Find Place by
  Name + Address* (~$0.017/call) for the website-match pass. That's a distinct endpoint
  (`places.googleapis.com/v1/places:searchText` with an exact-name query is one approach;
  the older `findplacefromtext` is another). **D7 out of scope:** W11's slice owns it.
- **`_shared/env.ts:33` exposes `config.googlePlacesApiKey`** (W1). The client will read
  it via the typed accessor — fails loud via `ConfigError` if absent. AC #2 ✓ by reuse.
- **`docs/realtime-ingestion.md` cost tiers** name Text Search at ~$0.032/call and Find
  Place at ~$0.017 — both within the documented Phase-1 budget.
- **Google's Places (new) API:** Text Search supports `pageSize` ≤ 20 and `pageToken` for
  pagination, max 60 results / 3 pages. Distance Matrix supports up to 25 origins × 25
  destinations per request, returns walk-time in seconds when `mode=walking`.
- **Existing Edge Function pattern** for a shared client: `_shared/scoring.ts`,
  `_shared/cors.ts`, `_shared/env.ts` — all pure modules with named exports + a 5-line
  header comment + nothing speculative. W3 mirrors that shape.
- **No existing Deno HTTP-mock helper** in the repo. The fixture path is the testable
  surface; live API calls in tests are out.

## Acceptance Criteria Coverage Map
Every atomic AC fragment, its type, and how it's closed out.

| # | AC fragment (verbatim) | Type | Disposition |
|---|------------------------|------|-------------|
| 1 | "`_shared/places.ts` exposes `textSearch(purpose, location)` → candidate venues (id, name, address, lat/lng, rating, hours)" | Backend | **Demonstrated** — calling `textSearch('cocktails near me', {lat,lng})` (against a recorded fixture, see D3) returns ≥1 typed `PlacesCandidate` with all 6 fields populated; unit test asserts the shape |
| 2 | "and `distanceMatrix(origin, candidates)` → walk minutes per candidate" | Backend | **Demonstrated** — calling `distanceMatrix({lat,lng}, [candidates])` returns `{candidateId → walkMinutes}` map; unit test asserts walkMinutes is a finite positive number for each input |
| 3 | "Uses GOOGLE_PLACES_API_KEY from the env helper (W1); fails with a clear error if absent" | Backend | **Demonstrated** — unit test: with the var unset, calling `textSearch(...)` throws `ConfigError` from `_shared/env.ts` (W1) with the named-var message |
| 4 | "Handles the API's pagination + rate-limit responses gracefully and normalizes results to the shared candidate shape" | Backend | **Demonstrated** — pagination: a fixture with 3 pages worth of `nextPageToken` returns the full ≤60-result set; rate-limit: a fixture replaying a 429 then 200 returns the successful payload after a single backoff retry; normalization: candidates always carry the 6 AC-named fields (defaults filled for `rating`/`hours` when Google omits them) |
| 5 | "A documented fixture/replay path lets find-spots be developed without burning live quota" | Convention | **Demonstrated** — `PLACES_FIXTURE_DIR` env var (optional, read via W1's `optionalEnv`): when set, requests are hashed to a deterministic filename and the JSON response is served from `${PLACES_FIXTURE_DIR}/${hash}.json` instead of hitting the network. README + the module header document the record-mode toggle (set the var and the env helper var simultaneously to capture first, replay subsequently). |

## Decisions to confirm (no real forks — exploration settled them all)

- **D1 — Export names.** `textSearch` + `distanceMatrix` (AC verbatim; the `googlePlaces`
  prefix in find-spots's TODO comment is redundant because the module is
  `_shared/places.ts`). W5 updates its TODO comment when it implements.
- **D2 — Candidate shape lives local.** The intermediate `PlacesCandidate` type
  (`id, name, address, location, rating, hoursToday`) stays in `_shared/places.ts` — not in
  `shared/types.ts`. Reasoning: it's a server-side intermediate (raw from Google before
  Claude-judge + scoring); only the post-judge `ScoredSpot` crosses the wire and that
  already lives in the W2 contract.
- **D3 — Fixture/replay via `PLACES_FIXTURE_DIR`.** Optional env var (W1's `optionalEnv`).
  When set: deterministic-hash the request (endpoint + params) → JSON filename → file is
  read instead of fetched. When unset: live fetch. Adds optional `PLACES_RECORD_DIR` for
  capture: when set alongside `PLACES_FIXTURE_DIR`, missed-cache requests fall through to
  live + write the response back. Documented in the module header + README.
- **D4 — Pagination.** Text Search fetches all pages by default (≤60, Google's hard cap).
  Caller (find-spots) can cap via `maxResults` which truncates *after* pagination so the
  result set is consistently the top-N by Google's ranking.
- **D5 — Rate-limit handling.** Single retry with exponential backoff (1 s, 4 s) on
  `429` / `5xx`. After 2 retries fail, throw `PlacesError(operation, status, body)` —
  typed, named, with the upstream body for debugging. Same retry pattern will apply when
  W4 (Claude client) ships.
- **D6 — Distance Matrix batching.** Up to 25 destinations per request (Google's cap). For
  `candidates.length > 25`, send in chunks of 25 and merge. One request shape per origin.
- **D7 — Find Place by Name + Address is W11's territory.** Distinct endpoint, distinct
  purpose (website-match for enrich-business), not in W3's AC. Explicit follow-up note for
  W11.

## Requirements (each traces to a fragment)
- **R1 (→1,2):** New module `supabase/functions/_shared/places.ts` exporting
  `textSearch(purpose: string, location: Location): Promise<PlacesCandidate[]>` and
  `distanceMatrix(origin: Location, candidates: PlacesCandidate[]): Promise<Map<string, number>>`
  (id → walk minutes). Uses `Location` from `shared/types.ts` (W2).
- **R2 (→1, 4):** `PlacesCandidate` type local to the module — exactly the 6 AC-named
  fields: `id`, `name`, `address`, `location: Location`, `rating?: number`,
  `hoursToday?: string`. Normalization fills `rating` from Google's `rating` field and
  `hoursToday` from `regularOpeningHours.weekdayDescriptions[dow]` when present.
- **R3 (→3):** Reads the API key via `config.googlePlacesApiKey` from W1's
  `_shared/env.ts` — throws `ConfigError` on missing var.
- **R4 (→4):** Pagination — `textSearch` walks `nextPageToken` until exhausted or 60
  results. Rate-limit — `429`/`5xx` triggers `[1s, 4s]` backoff retries; final failure
  throws `PlacesError`.
- **R5 (→5):** `PLACES_FIXTURE_DIR` (optional) reads cached JSON keyed by request hash.
  `PLACES_RECORD_DIR` (optional) writes responses back. Module header + a short README
  section in `supabase/README.md` (create if absent) document the toggle.
- **R6 (→1,2,3,4):** Deno unit tests covering the shape assertions, missing-env behavior,
  pagination, and the 429-backoff path — all using committed fixture files (no live
  network in tests).

## Story-local rules (resolved decisions)
- Module lives at `supabase/functions/_shared/places.ts` — matches the precedent set by
  `_shared/scoring.ts`, `_shared/cors.ts`, `_shared/env.ts`.
- Header comment shape mirrors `_shared/env.ts:1-7`: 5-line purpose statement + reference
  to this spec + a one-line note that the module never logs API keys.
- Tests use `assertAlmostEquals`/`assertEquals` from `https://deno.land/std@0.224.0/assert/mod.ts`
  (same version pin as `env.test.ts`, `scoring.parity.test.ts`).
- Fixture files live at `supabase/functions/_shared/__fixtures__/places/<hash>.json`.
- Errors typed as `class PlacesError extends Error` with `operation`, `status`, `body`
  fields — mirrors W1's `ConfigError` pattern.

## Resolved Questions
- *Module location?* → `supabase/functions/_shared/places.ts` (convention).
- *Export names — with or without `googlePlaces` prefix?* → Without (D1, AC verbatim).
- *Candidate type in shared/types.ts or local?* → Local (D2).
- *How to develop without burning live quota?* → `PLACES_FIXTURE_DIR` replay (D3).
- *Find Place by Name + Address?* → Out of scope; W11's territory (D7).

## Open product/UX questions
- None. This is a pure backend client behind a stable AC.

## Out of scope
- *Find Place by Name + Address* endpoint (W11 enrich-business).
- *Place Details* endpoint (rich photos, reviews — not in W5 find-spots' MVP).
- Caching responses to Postgres (cross-cutting concern; not W3).
- Quota / cost telemetry (a Phase-3 concern per docs/realtime-ingestion.md).
- The Claude judge client (that's W4, parallel slice).
