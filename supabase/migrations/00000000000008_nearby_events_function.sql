-- W7: KNN events query — uses events_geo_gist + events_start_at indexes.
-- Returns events filtered by distance + time window, ordered by proximity
-- (closer first) then by announced_at (newer first) as a tiebreaker.
--
-- Called from _shared/events.ts via supabase.rpc('nearby_events', ...).
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
