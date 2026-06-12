# W7 — Events query layer (PostGIS KNN by geo + time)

**Branch:** `w7-events-query-layer` · **Area:** supabase · **DependsOn:** W2 (merged)
**Status:** specify

## Problem
Two downstream slices need the same events read: **find-spots** (W5)'s
`realTimeRelevance` signal asks "are there any active events for this purpose near this
venue right now?", and **events-feed** (W8) returns events near a user-chosen location +
time window. Both need PostGIS-indexed proximity + start-time filtering against
`public.events` (migration `00000000000002_events.sql`). If each slice writes its own SQL,
they'll drift. W7 ships the shared owner.

Plus **ingest-events** (W10, a cron) needs to *write* events, keyed by `canonical_key` so
the same event from multiple sources merges to one row. That write path is also in W7's
scope.

## Exploration findings (what already exists — do NOT rebuild)
- **`public.events` table** (`migration 00000000000002:9-39`) — primary key `id uuid`,
  unique `canonical_key text`, `geo geography(point, 4326)` GiST-indexed
  (`events_geo_gist`, line 41), `start_at` B-tree-indexed (line 42), `announced_at desc`
  indexed (line 43). RLS allows `select` for `authenticated`/`anon`; writes are
  service-role-only (no policy → default-deny).
- **`Event` interface** at `shared/types.ts:88-104` (W2). Camelcase fields; the DB columns
  are snake_case. W7 does the mapping.
- **`EventsFeedRequest` / `EventsFreshness`** already in W2 (`shared/types.ts:107-129`).
  W8 will assemble those at the caller layer; W7 stays focused on the raw query +
  upsert.
- **`events-feed/index.ts`** stub names `EventsFeedRequest` inline (ad-hoc local type).
  W8 will reconcile to the W2 type; W7 doesn't need to touch the file.
- **Supabase client npm import** already used by W9 (`npm:@supabase/supabase-js@2.39.7`).
  Same import here.
- **PostGIS query semantics:** `ST_DWithin(geo, point::geography, radius_m)` uses the
  GiST index. `ST_Distance(geo, point::geography)` sorts by meters; combine with
  `announced_at desc` as a tiebreaker for proximity+recency ordering.
- **No PostgREST-native PostGIS ordering.** PostgREST cannot express `order by ST_Distance(...)`
  directly. The canonical Supabase pattern is a SQL function called via `supabase.rpc(...)` —
  a small additive migration is the right home (D1).

## Acceptance Criteria Coverage Map

| # | AC fragment (verbatim) | Type | Disposition |
|---|------------------------|------|-------------|
| 1a | "`_shared/events.ts` exposes `nearbyEvents(location, radius, timeWindow) → Event[]`" | Backend | **Demonstrated** — unit test: calling the function with a mocked Supabase client returns typed `Event[]` and passes the expected RPC name + parameters |
| 1b | "using the events table PostGIS index (migration 00000000000002)" | Convention | **Explained** — the new SQL function `public.nearby_events` (added by W7's tiny additive migration) wraps `ST_DWithin(geo, ...)` + `order by ST_Distance(geo, ...)`. Cite the migration + Postgres `EXPLAIN` shows index use. |
| 1c | "and `upsertEvents(events)` keyed by `canonical_key`" | Backend | **Demonstrated** — unit test: calling with N events invokes `.upsert(rows, {onConflict: 'canonical_key'})` on the Supabase client; rows are correctly mapped from W2's `Event` shape to the DB columns |
| 2a | "Returns events typed per the shared Event shape (W2)" | Backend | **Demonstrated** — return type is `Promise<Event[]>` from `shared/types.ts`; mapping function `rowToEvent` is unit-tested |
| 2b | "ordered by proximity + recency" | Convention | **Explained** — the SQL function's `order by` clause is `ST_Distance(...) asc, announced_at desc`. Cited in the migration; unit test verifies the column ordering by checking the RPC is the only path (no client-side re-sort) |
| 3 | "Used by both the find-spots real-time-relevance signal and events-feed without duplicating SQL" | Convention | **Explained** — both slices import `nearbyEvents` from `_shared/events.ts`; the SQL exists only inside the `public.nearby_events` function. Verify by `grep -r 'ST_DWithin\|ST_Distance' supabase/functions/` showing zero hits in caller code |

## Decisions to confirm (settled by exploration)

- **D1 — `public.nearby_events` SQL function in a new migration.** PostgREST can't express
  KNN ordering; the canonical Supabase pattern is a stable SQL function called via
  `supabase.rpc('nearby_events', {...})`. Migration file:
  `supabase/migrations/00000000000008_nearby_events_function.sql`. Granted `execute` to
  `anon` + `authenticated` so both client roles can call it.
- **D2 — Helper signatures accept a `SupabaseClient` parameter.** Caller supplies the
  right credential level: find-spots/events-feed pass their user-JWT-forwarded anon
  client (read), ingest-events (W10) passes a service-role client (write). Decoupling the
  helper from a hard-coded client makes testing trivial and avoids module-level state.
- **D3 — Type signatures:**
  ```ts
  interface TimeWindow { startISO?: string; endISO?: string }
  nearbyEvents(client, location, radiusMeters, timeWindow): Promise<Event[]>
  upsertEvents(client, events): Promise<{ upserted: number; errors: number }>
  ```
  Default `startISO = now`, `endISO = 24h from now` if either is omitted.
- **D4 — Row ↔ Event mapping in helper functions.** Two inverse helpers, exported for
  reuse + testability: `rowToEvent(row)` and `eventToRow(event)`. DB column ↔ W2 field
  mapping is straightforward (snake_case ↔ camelCase). PostGIS `geo` round-trip: read
  via `ST_X(geo::geometry)` / `ST_Y(geo::geometry)` exposed in the SQL function;
  write via WKT `SRID=4326;POINT(lng lat)` (same pattern W9 uses for `query_location`).
- **D5 — Error model.** `class EventsQueryError extends Error` with `operation`, `code`,
  `details`. Thrown by both functions on a non-recoverable Supabase error (network down,
  permission denied). Partial-success on `upsertEvents` (some rows fail) returns
  `{upserted, errors}` rather than throwing — matches enrich-business's "log per-item, keep
  going" pattern for bulk cron writes.
- **D6 — No fixture/replay seam.** Unlike W3/W4 (external APIs with quota), the DB is
  local-cheap. Tests stub the `SupabaseClient` directly (no env-var-controlled fixture).

## Requirements (each traces to a fragment)
- **R1 (→1b):** New migration `00000000000008_nearby_events_function.sql` defines
  `public.nearby_events(origin_lat, origin_lng, radius_m, when_start, when_end, max_results)`
  returning the events table rows + exposed `lat`/`lng` columns. Uses
  `ST_DWithin(geo, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, radius_m)` for the
  filter; orders by `ST_Distance(geo, point)::geography asc, announced_at desc`. Grants
  execute to `anon` + `authenticated`.
- **R2 (→1a, 1c, D2-D5):** `supabase/functions/_shared/events.ts` exports
  `nearbyEvents`, `upsertEvents`, `rowToEvent`, `eventToRow`, `EventsQueryError`,
  `TimeWindow`. Reads via `supabase.rpc('nearby_events', {...})`. Writes via
  `supabase.from('events').upsert(rows, { onConflict: 'canonical_key' })`.
- **R3 (→2a, 2b):** Mapping is deterministic. `EXPLAIN` evidence cited in plan.md
  (manual verification: `select * from nearby_events(...)` shows the GiST index in use).
- **R4 (→1a, 1c, 2a):** Deno unit tests covering happy path, no-results, default time
  window, RPC parameter mapping, upsert row mapping, partial-failure path.

## Story-local rules (resolved decisions)
- Module location: `supabase/functions/_shared/events.ts`.
- Migration location: `supabase/migrations/00000000000008_nearby_events_function.sql`.
- Helper signatures DO NOT take a Supabase URL/key — only a constructed client. Caller
  composes credentials.
- Tests stub `SupabaseClient` with the minimum API surface the helper uses (`.rpc(name, args)`
  and `.from(table).upsert(rows, opts)`).
- Error type pattern mirrors `PlacesError`/`ClaudeError`: `EventsQueryError extends Error`.

## Resolved Questions
- *PostgREST vs SQL function for the KNN query?* → SQL function (D1).
- *Helper constructs its own client, or takes one?* → Takes one (D2).
- *What time window default?* → `now` to `now + 24h` if either bound is omitted.
- *Partial upsert failure: throw or return counts?* → Return counts (D5).
- *Fixture/replay?* → Not needed for DB (D6).

## Open product/UX questions
- None. Backend-only shared helper behind a stable AC.

## Out of scope
- **events-feed implementation** (W8) — separate slice. W7 ships the helper W8 will use.
- **Per-query live web search** for events not yet in the DB. W8 + W10 own that.
- **Event extraction from text** — W4's `extractEvents` already does that; W10 calls it.
- **Event cache invalidation** (the 15-min cache events-feed will use) — belongs to W8.
- **Backfill / re-ingest workflows.** Listed for the post-MVP ops doc.
