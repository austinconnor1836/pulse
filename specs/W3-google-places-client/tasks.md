# W3 — Tasks

**Branch:** `w3-google-places-client` · **Builds on:** `spec.md`, `plan.md`

Three commits, in order.

---

## Commit A — Core module

### T1. Create `supabase/functions/_shared/places.ts`
- Header comment: 5-line purpose + reference to `specs/W3-google-places-client/spec.md` +
  one-line "never logs API keys".
- Import `Location` from `../../../shared/types.ts`; `config` from `./env.ts`.
- Export `interface PlacesCandidate { id, name, address, location: Location, rating?: number, hoursToday?: string }`.
- Export `class PlacesError extends Error { readonly operation, readonly status, readonly body }`.
- Export `DEFAULT_BACKOFF_MS = [1000, 4000] as const`.
- Internal `hashRequest(operation: string, request: unknown): string` — sha-256 via
  `crypto.subtle.digest` over `operation + JSON.stringify(request, sortKeys)`, return first
  16 hex chars. Use a tiny `sortKeys` replacer so JSON.stringify is deterministic on object
  field order.
- Internal `async fetchJson<T>(operation, init, opts?: { backoffMs?: readonly number[] })`:
  1. Build cache key: `hashRequest(operation, { url, body })`.
  2. If `Deno.env.get('PLACES_FIXTURE_DIR')` set and file exists → return parsed JSON.
  3. Else `fetch(init.url, { method, headers, body })`.
  4. If status in `[429, 500, 502, 503, 504]` and we have a backoff slot left, sleep that
     many ms and retry. Otherwise on non-OK, throw `PlacesError(operation, status, await
     response.text())`.
  5. On success, parse JSON; if `PLACES_RECORD_DIR` set, write the JSON to that dir.
  6. Return parsed.
- Export `async textSearch(purpose: string, location: Location, opts?): Promise<PlacesCandidate[]>`:
  - Read key via `config.googlePlacesApiKey` (throws `ConfigError` if absent).
  - Loop fetching pages; up to 60 results total.
  - Body: `{ textQuery: purpose, locationBias: { circle: { center: { latitude: location.lat, longitude: location.lng }, radius: 5000 } }, pageSize: 20, pageToken?: string }`.
  - Headers: `Content-Type: application/json`, `X-Goog-Api-Key: <key>`,
    `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.regularOpeningHours,nextPageToken`.
  - URL: `https://places.googleapis.com/v1/places:searchText`.
  - Normalize each `place`:
    ```ts
    {
      id: place.id,
      name: place.displayName?.text ?? place.id,
      address: place.formattedAddress ?? '',
      location: { lat: place.location.latitude, lng: place.location.longitude },
      rating: typeof place.rating === 'number' ? place.rating : undefined,
      hoursToday: place.regularOpeningHours?.weekdayDescriptions?.[(new Date().getDay() + 6) % 7],
    }
    ```
  - Comment the `(dow+6)%7` formula: Google's `weekdayDescriptions[0]` is Monday; JS's
    `getDay()` is Sunday=0.
- Export `async distanceMatrix(origin: Location, candidates: readonly PlacesCandidate[], opts?): Promise<Map<string, number>>`:
  - Read key via `config.googlePlacesApiKey`.
  - Chunk candidates into groups of 25.
  - For each chunk: GET
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${lat,lng}&destinations=${...|...}&mode=walking&key=${KEY}`.
  - Parse `rows[0].elements[i]`: if `element.status === 'OK'`, set
    `map.set(chunk[i].id, Math.round(element.duration.value / 60))`. Skip otherwise.
  - Return merged Map.

### T2. Create `supabase/functions/_shared/__fixtures__/places/.keep`
Empty file (or one-line comment) so the dir is tracked.

**Commit A message:** `W3: Google Places client (textSearch + distanceMatrix)`

---

## Commit B — Tests

### T3. Create `supabase/functions/_shared/places.test.ts`
Helper:
```ts
function withMockedFetch(handler: (req: Request) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => handler(new Request(input as RequestInfo, init));
  return () => { globalThis.fetch = original; };
}
```

Six tests:

1. **textSearch shape.** Mocked fetch returns one page with one place carrying all 6 fields.
   Assert returned `PlacesCandidate` has every AC-named field; assert `rating === 4.5` and
   `hoursToday` equals the mocked weekday string.

2. **textSearch normalizes optional-field absence.** Mocked fetch returns a place without
   `rating` and without `regularOpeningHours`. Assert `rating === undefined`,
   `hoursToday === undefined`, other fields populated.

3. **textSearch throws ConfigError when GOOGLE_PLACES_API_KEY unset.** Delete the env var;
   call → assert throws `ConfigError`; restore.

4. **textSearch paginates and caps at 60.** Mocked fetch returns a stub that:
   - Page 1: 20 places + `nextPageToken: 'pg2'`
   - Page 2: 20 places + `nextPageToken: 'pg3'`
   - Page 3: 20 places (no token).
   Assert result.length === 60; assert fetch was called 3 times.

5. **distanceMatrix batches at 25.** 27 candidates, mocked fetch returns one OK row per
   destination per request. Assert fetch was called 2 times; assert Map size === 27.

6. **distanceMatrix omits non-OK elements.** 3 candidates, mocked response:
   `[{status:'OK', duration:{value:600}}, {status:'ZERO_RESULTS'}, {status:'OK', duration:{value:300}}]`.
   Assert Map has 2 entries (indices 0 and 2), 10 and 5 minutes respectively.

7. **fetchJson retries on 429.** Two-shot mock: first response `429`, second `200`.
   `textSearch` called with `{backoffMs: [1, 1]}` opts → returns successfully. Assert
   fetch was called 2 times.

### T4. Run tests
`deno test --allow-env --allow-read --allow-net=places.googleapis.com,maps.googleapis.com supabase/functions/_shared/places.test.ts`.
Mocked fetch shouldn't hit the net, but `--allow-net` is needed by Deno's permission system
if the production code paths reference network domains.

Actually — since fetch is stubbed in every test, `--allow-net` should not be needed. Try
without it first.

**Commit B message:** `W3: places.test.ts — 7 cases (shape, pagination, batching, retry)`

---

## Commit C — Docs + fixture dir

### T5. Add "Places fixture/replay" section to `supabase/README.md`
Create the file if absent. Section content:

```md
## Places fixture/replay

`_shared/places.ts` is the typed Google Places client (W3). Two optional env vars let you
develop without burning live quota:

- `PLACES_FIXTURE_DIR=$(pwd)/supabase/functions/_shared/__fixtures__/places deno test ...`
  reads cached responses keyed by a sha-256(operation + sorted JSON request) → first 16
  chars. Runs zero-quota.
- `PLACES_RECORD_DIR=$(pwd)/supabase/functions/_shared/__fixtures__/places` (paired with the
  real `GOOGLE_PLACES_API_KEY`) records live responses into the dir on the first run, so
  the next run can replay.

Fixtures live at `supabase/functions/_shared/__fixtures__/places/<hash>.json`. Commit them
when you want a deterministic replay for CI / a teammate.
```

**Commit C message:** `W3: supabase/README.md — Places fixture/replay docs`

---

## Verification (Phase 5 preview)

| AC fragment | Evidence |
|---|---|
| 1, 2 (typed clients) | Demonstrated — tests 1, 2, 5, 6 outputs. |
| 3 (env helper + clear error) | Demonstrated — test 3 output. |
| 4 (pagination + rate-limit + normalize) | Demonstrated — tests 4 (pagination cap), 7 (429 retry), 1/2 (normalization). |
| 5 (fixture/replay path documented) | Explained — cite supabase/README.md "Places fixture/replay" section + the module header. |

## Tracker-mirror policy
No mirror. Backbone is the source of truth.

## Next gate
Pre-implement confirm — already approved ("Yes"). Proceeding to implement.
