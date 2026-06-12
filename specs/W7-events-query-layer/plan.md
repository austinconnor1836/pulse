# W7 — Plan

**Branch:** `w7-events-query-layer` · **Builds on:** `spec.md`

The spec settled every decision (D1–D6). Plan is a short execution map.

## Approach
Three commits.

### Commit A — Migration
File: `supabase/migrations/00000000000008_nearby_events_function.sql`.

```sql
-- W7: KNN events query — uses events_geo_gist + events_start_at indexes.
-- Returns events filtered by distance + time window, sorted by proximity then recency.
-- Source-of-truth: specs/W7-events-query-layer/spec.md

create or replace function public.nearby_events(
  origin_lat double precision,
  origin_lng double precision,
  radius_m integer,
  when_start timestamptz,
  when_end timestamptz,
  max_results integer default 50
)
returns table (
  id uuid,
  canonical_key text,
  title text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  announced_at timestamptz,
  ingested_at timestamptz,
  venue_name text,
  venue_place_id text,
  lat double precision,
  lng double precision,
  tags text[],
  sources text[],
  source_urls text[],
  confidence text,
  cost text,
  supersedes_id uuid
)
language sql stable as $$
  with origin as (
    select ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography as g
  )
  select
    e.id, e.canonical_key, e.title, e.description,
    e.start_at, e.end_at, e.announced_at, e.ingested_at,
    e.venue_name, e.venue_place_id,
    ST_Y(e.geo::geometry) as lat,
    ST_X(e.geo::geometry) as lng,
    e.tags, e.sources, e.source_urls,
    e.confidence, e.cost,
    e.supersedes_id
  from public.events e, origin
  where e.geo is not null
    and ST_DWithin(e.geo, origin.g, radius_m)
    and e.start_at < when_end
    and (e.end_at is null or e.end_at > when_start)
  order by
    ST_Distance(e.geo, origin.g) asc,
    e.announced_at desc
  limit max_results;
$$;

grant execute on function public.nearby_events(
  double precision, double precision, integer, timestamptz, timestamptz, integer
) to anon, authenticated;
```

### Commit B — `_shared/events.ts` + tests
- Imports: `SupabaseClient` from `npm:@supabase/supabase-js@2.39.7`, `Event` +
  `EventSource` + `EventConfidence` + `Location` from W2.
- Exports: `nearbyEvents`, `upsertEvents`, `rowToEvent`, `eventToRow`,
  `EventsQueryError`, `TimeWindow`.
- `TimeWindow`:
  ```ts
  export interface TimeWindow { startISO?: string; endISO?: string }
  ```
  Defaults computed inline: `start = now`, `end = now + 24h`.
- `nearbyEvents(client, location, radiusMeters, timeWindow): Promise<Event[]>`:
  - Compute defaults; `supabase.rpc('nearby_events', {...})`.
  - On `error`, throw `EventsQueryError('nearbyEvents', error.code, error.message)`.
  - Map rows via `rowToEvent`. Return typed array.
- `upsertEvents(client, events): Promise<{ upserted: number; errors: number }>`:
  - Empty input → `{upserted: 0, errors: 0}`.
  - Map each via `eventToRow`.
  - `supabase.from('events').upsert(rows, { onConflict: 'canonical_key', ignoreDuplicates: false })`.
  - On `error`, log + return `{upserted: 0, errors: events.length}` — never throw
    (cron-write semantics per D5).
- `rowToEvent(row)`: snake_case → camelCase per W2 `Event`. `lat`/`lng` columns →
  `location: { lat, lng }` (when both present). Confidence string passes through
  if valid; else `'likely'`.
- `eventToRow(event)`: inverse mapping. `event.location` → WKT
  `SRID=4326;POINT(${lng} ${lat})` for `geo` column. ISOs pass through (Postgres
  accepts ISO 8601). `tags`/`sources`/`sourceUrls` default `[]`.

Tests (`_shared/events.test.ts`), 7 cases:

1. **`nearbyEvents` happy path**: stub client returns 2 rows → returns 2 typed
   `Event`s; verify `lat/lng` → `location`; verify `tags` array passes through.
2. **`nearbyEvents` default time window**: omit `startISO` + `endISO`; assert the
   client was called with `when_start` ≈ now and `when_end` ≈ now+24h.
3. **`nearbyEvents` zero results**: stub returns `[]` → returns `[]`.
4. **`nearbyEvents` RPC error throws `EventsQueryError`**: stub `error` →
   assertion.
5. **`upsertEvents` empty input** → `{upserted: 0, errors: 0}`; no client call.
6. **`upsertEvents` happy path**: 3 events → `.upsert` called with 3 rows,
   correctly mapped (verify `geo` WKT, `canonical_key`, `tags`).
7. **`upsertEvents` Supabase error**: stub returns `error` →
   `{upserted: 0, errors: 3}`, no throw.

### Commit C — supabase/README update
Add row in shared-modules table for `events.ts`. Short paragraph noting the
`nearby_events` SQL function lives in migration `00000000000008`.

## Files touched

| Path | Action |
|------|--------|
| `supabase/migrations/00000000000008_nearby_events_function.sql` | create |
| `supabase/functions/_shared/events.ts` | create |
| `supabase/functions/_shared/events.test.ts` | create |
| `supabase/README.md` | edit (shared-modules row + one paragraph) |

No changes to `events-feed/index.ts`, `find-spots/index.ts`, `ingest-events/index.ts` —
W7 ships the helper; W5/W8/W10 plug it in.

## Constitution Check

| # | Principle | Status |
|---|-----------|--------|
| I | **Vertical slice.** | ✓ One concern — events query layer. The migration is the SQL the helper uses; it doesn't make sense to ship one without the other. |
| II | **Convention before invention.** | ✓ Module at `_shared/events.ts`; error type mirrors `PlacesError`/`ClaudeError`. Migration uses precedent: existing `events` table indexes are GiST + B-tree just like every other PostGIS-aware project. |
| III | **AC are the contract.** | ✓ Every Coverage Map fragment maps to a Requirement; the spec's D2 clarification (helper takes a client) makes the AC's "without duplicating SQL" assertion testable (grep verifies). |
| IV | **Fail loud at boundaries.** | ✓ `nearbyEvents` throws on non-recoverable error. `upsertEvents` returns per-batch counts (cron-write — partial success is the norm). Both are typed. |
| V | **No speculative scope.** | ✓ Two functions, one migration. No event-bus, no cache layer, no triggers. |
| VI | **No duplication of working code.** | ✓ Single mapping pair (`rowToEvent` / `eventToRow`). Single SQL home (`public.nearby_events`). |
| VII | **Errors are typed.** | ✓ `EventsQueryError extends Error` with `operation`, `code`, `details`. |
| VIII | **No commented-out code.** | ✓ Net-new. |
| IX | **Tests where they catch real bugs.** | ✓ 7 cases each tests a real failure mode (mapping, time-window default, RPC error, partial upsert failure). |
| X | **Isolate classes of change.** | ✓ Three commits: migration, helper+tests, docs. |
| XI | **No speculative version bumps.** | n/a. |

## Risks
- **SQL function migration introduces a new file.** Tested locally would require
  `supabase db reset`; we don't actually run that in CI today. The migration is
  pure SQL with no destructive ops on existing data, so apply-time risk is low.
  Verify the function compiles by syntax check (`supabase db lint` or paste into a
  Postgres console).
- **`ST_DWithin` index use depends on the `geo` column having values.** Events
  with `geo IS NULL` are excluded. Acceptable — venue-less events shouldn't surface
  in "nearby" queries. Filter is explicit in the function (`where e.geo is not null`).
- **`onConflict: 'canonical_key'` requires the unique constraint exists.** It does
  (`migration 00000000000002:14` — `canonical_key text not null unique`).

## Next phase
Implement (no separate `tasks.md` — execution map above is the task list).
