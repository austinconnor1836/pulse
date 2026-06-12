# W3 — Plan

**Branch:** `w3-google-places-client` · **Builds on:** `spec.md`

## API choice (settled by precedent + Google's own recommendation)
- **Text Search:** Places API (New) at `https://places.googleapis.com/v1/places:searchText`.
  Field-mask header keeps the payload small; nextPageToken-based pagination.
- **Distance Matrix:** Maps Distance Matrix API at
  `https://maps.googleapis.com/maps/api/distancematrix/json` (legacy — Google has not yet
  shipped a v1 equivalent). `mode=walking` returns duration in seconds.

Both pull the key from `config.googlePlacesApiKey` (W1).

## Module structure

```ts
// _shared/places.ts
export interface PlacesCandidate { id, name, address, location, rating?, hoursToday? }
export class PlacesError extends Error { operation, status, body }
export async function textSearch(purpose, location): Promise<PlacesCandidate[]>
export async function distanceMatrix(origin, candidates): Promise<Map<string, number>>

// Internal:
async function fetchJson<T>(op, request, opts?): Promise<T>      // retry + fixture
function hashRequest(op, request): string                        // sha256 16-char
function normalizeTextSearchPlace(p): PlacesCandidate            // → 6 AC fields
const DEFAULT_BACKOFF_MS = [1000, 4000]                          // injectable for tests
```

`fetchJson` is the single retry+fixture seam — both endpoints flow through it. Tests inject
shorter backoffs via an internal-only `__forTestSetBackoff` (or by making `fetchJson` take an
optional `backoffMs` arg).

## Approach
Three changes, ordered build → test → docs.

### Change 1 — Core module (`_shared/places.ts`)
- Types: `PlacesCandidate`, `PlacesError`.
- `fetchJson(op, {url, method, body, headers}, {backoffMs}?)` — read fixture if
  `PLACES_FIXTURE_DIR` set + file present; else live fetch; on `429`/`5xx` retry per
  `backoffMs` (default `[1000, 4000]`); on success, write back to `PLACES_RECORD_DIR` if
  set; map non-OK final response to `PlacesError(op, status, body)`.
- `textSearch(purpose, location)`:
  - POST to `places.googleapis.com/v1/places:searchText` with body
    `{ textQuery: purpose, locationBias: { circle: { center: {latitude, longitude}, radius: 5000 } }, pageSize: 20 }`.
  - Headers: `X-Goog-Api-Key`, `X-Goog-FieldMask:
    places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.regularOpeningHours,nextPageToken`.
  - Walk `nextPageToken` until empty or 60 results collected.
  - Normalize each `place` → `PlacesCandidate` with id, name (`displayName.text`), address
    (`formattedAddress`), location (`{lat: location.latitude, lng: location.longitude}`),
    rating, hoursToday (today's `regularOpeningHours.weekdayDescriptions[(dow+6)%7]` —
    Google returns Monday-first; map to JS getDay()'s Sunday-first).
- `distanceMatrix(origin, candidates)`:
  - Chunk candidates into groups of 25.
  - GET `maps.googleapis.com/maps/api/distancematrix/json?origins=lat,lng&destinations=lat1,lng1|lat2,lng2|...&mode=walking&key=...`.
  - Parse `rows[0].elements[i].duration.value` (seconds) → minutes via `Math.round(seconds / 60)`.
  - Return `Map<candidateId, walkMinutes>`; candidates with `status !== 'OK'` are omitted
    from the map (caller treats as "no walk path" — find-spots' hard-filter handles it).
- Header comment: 5-line purpose + spec link + "never logs API keys".

### Change 2 — Tests (`_shared/places.test.ts`)
Stubs `globalThis.fetch` (per-test save/restore). Six cases:
- **Shape**: `textSearch` returns candidates with all 6 fields populated; `rating`/`hoursToday`
  optional behavior (asserts they're `undefined` when Google omits them).
- **Missing env**: with `GOOGLE_PLACES_API_KEY` unset, `textSearch` throws `ConfigError`.
- **Pagination**: 3 sequential mock responses with `nextPageToken` → returns 60 results;
  stops at 60 even if more pages would exist.
- **Distance matrix shape + batching**: 27 candidates → 2 fetch calls (25 + 2); merged Map
  has 27 entries.
- **Distance matrix omits non-OK rows**: candidates returning `status: 'ZERO_RESULTS'` are
  not in the result Map.
- **Rate-limit retry**: `fetchJson` injected with `backoffMs = [1, 1]`; first call returns
  `{status: 429}`, second returns `{status: 200, body}` → returns body.

Backoff is injectable via an optional second arg to `textSearch`/`distanceMatrix`
(`{ backoffMs?: number[] }`). Public API stays `(purpose, location)` and
`(origin, candidates)` for callers; the test seam doesn't leak into find-spots.

### Change 3 — Fixture/replay documentation
Short section in `supabase/README.md` (create if absent) — "Places fixture/replay":
- `PLACES_FIXTURE_DIR=$(pwd)/supabase/functions/_shared/__fixtures__/places deno test ...`
  reads cached responses; runs zero-quota.
- `PLACES_RECORD_DIR=...` alongside live key captures live responses for replay.
- Hash function: sha-256 of `operation + JSON.stringify(request, sortedKeys)`, first 16
  chars.

Plus a `.keep` file under `__fixtures__/places/` so the dir exists in git.

## Files touched

| Path | Action |
|------|--------|
| `supabase/functions/_shared/places.ts` | create |
| `supabase/functions/_shared/places.test.ts` | create |
| `supabase/functions/_shared/__fixtures__/places/.keep` | create |
| `supabase/README.md` | create or edit (Places fixture/replay section) |

No changes to `find-spots/index.ts` or any other slice — W3 ships the helper; W5 plugs it in.

## Constitution Check

| # | Principle | Status |
|---|-----------|--------|
| I | **Vertical slice.** | ✓ Single concern — Places client + its test + its docs. |
| II | **Convention before invention.** | ✓ Module lives at `_shared/places.ts` per precedent. Header shape mirrors `_shared/env.ts:1-7`. Error type mirrors `ConfigError`. Test deps version-pinned to `deno.land/std@0.224.0` like W1/W2. |
| III | **AC are the contract.** | ✓ Every Coverage Map fragment maps to a Change above. |
| IV | **Fail loud at boundaries.** | ✓ Missing env → `ConfigError`. API non-OK after retries → `PlacesError(op, status, body)`. No silent fallbacks. |
| V | **No speculative scope.** | ✓ Two functions, two endpoints. No Place Details / Find Place / caching / telemetry. |
| VI | **No duplication of working code.** | ✓ Both endpoints share `fetchJson` for retry+fixture. Distance Matrix chunking is the only loop. |
| VII | **Errors are typed.** | ✓ `PlacesError extends Error` carries `operation`, `status`, `body`. |
| VIII | **No commented-out code.** | ✓ Net-new. |
| IX | **Tests where they catch real bugs.** | ✓ 6 cases: shape, missing env, pagination cap, batching boundary, omit-non-OK, retry-then-200. Each tests a real failure mode. |
| X | **Isolate classes of change.** | ✓ 3 commits: core+types, tests, docs. |
| XI | **No speculative version bumps.** | n/a. |

## Risks
- **Places (New) field-mask drift.** Google occasionally renames fields. Mitigation:
  the normalizer maps explicit field names, so a missing field shows up as `undefined` →
  caught by the shape test. A schema change would need a corresponding test update.
- **`weekdayDescriptions` index mapping.** Google's `weekdayDescriptions[0]` is Monday;
  JS `Date.getDay()` returns Sunday=0. The plan formula `(dow+6)%7` maps:
  `Sun→6, Mon→0, Tue→1, …, Sat→5`. Worth a comment.
- **Distance Matrix legacy API end-of-life.** Google has signaled it will be deprecated in
  favor of Routes API. Out of scope to pre-empt; if it changes, this single module is the
  swap point.
- **Fixture filename collision.** Hash is first 16 chars of sha-256 (~16⁶⁴ namespace, but
  truncation reduces collision resistance). Acceptable for dev fixtures, not for
  cache-as-source-of-truth — which it isn't.

## Next phase
Tasks. Then pre-implement confirm.
