-- Real-time events index. Populated by the ingest-events cron + per-query live search.
-- Hot read path: events-feed Edge Function returns the freshest matching events
-- for a given location + time window. Source-of-truth: the find-spots SKILL.md
-- "Real-time event signal" section.

create extension if not exists postgis;
create extension if not exists pg_trgm;

create table public.events (
  id uuid primary key default gen_random_uuid(),

  -- Dedup key: same canonical event ingested from multiple sources merges to one row.
  -- Format: lowercase slug of (title + venue + start-date) hashed.
  canonical_key text not null unique,

  title text not null,
  description text,

  start_at timestamptz not null,
  end_at timestamptz,
  announced_at timestamptz not null default now(),
  ingested_at timestamptz not null default now(),

  venue_name text,
  venue_place_id text,                   -- Google Places place_id, when matched
  geo geography(point, 4326),            -- venue lat/lng

  tags text[] not null default '{}',     -- ["watch-party", "knicks", "free"]
  sources text[] not null default '{}',  -- enum strings: "news", "civic", "reddit", …
  source_urls text[] not null default '{}',

  confidence text not null default 'likely', -- "confirmed" | "likely" | "rumored"
  cost text,

  supersedes_id uuid references public.events on delete set null,

  -- Cache freshness for the freshness signal in EventsFeedResponse.
  raw_payload jsonb
);

create index events_geo_gist on public.events using gist (geo);
create index events_start_at on public.events (start_at);
create index events_announced_at on public.events (announced_at desc);
create index events_tags_gin on public.events using gin (tags);
create index events_title_trgm on public.events using gin (title gin_trgm_ops);

-- Public read access (events are public info); writes are service-role only.
alter table public.events enable row level security;

create policy "events readable by anyone authenticated"
  on public.events for select using (auth.role() in ('authenticated', 'anon'));

-- Ingest log so we can see what each cron run did, and back off polite sources.
create table public.event_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,                  -- "news.gothamist", "reddit.nyc", "civic.nyc.gov", …
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  events_seen integer not null default 0,
  events_new integer not null default 0,
  events_updated integer not null default 0,
  notes text,
  raw_error text
);

create index event_ingest_runs_source_started on public.event_ingest_runs (source, started_at desc);

alter table public.event_ingest_runs enable row level security;
create policy "ingest runs readable by authenticated"
  on public.event_ingest_runs for select using (auth.role() = 'authenticated');
