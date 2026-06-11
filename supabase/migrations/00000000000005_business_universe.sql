-- The business universe = deterministic enumeration of every commercial entity
-- in NYC, sourced from public registries (NYC Open Data + NYS Dept of State).
-- This is the moat: we don't guess what businesses exist, we know.
--
-- Pipeline:
--   1. Monthly bulk import from public registries → `business_universe`
--   2. Per-business enrichment: find website + socials → `business_socials`
--   3. Smart polling: tier by activity → `business_polling_state`
--   4. Hot signals bubble up into the `events` table

create table public.business_universe (
  id uuid primary key default gen_random_uuid(),

  -- Stable identifier from the source registry. Lets us reconcile across imports.
  source_registry text not null,        -- "nyc.dca.licenses", "nyc.dohmh.restaurants", "nys.dos.corporations"
  source_id text not null,              -- registry's own ID
  unique (source_registry, source_id),

  name text not null,
  dba text,                             -- "doing business as" — often the consumer-facing name
  industry text,                        -- NAICS or human label
  category text[],                      -- ["restaurant", "bar", "cafe"] — derived

  address_line text,
  city text,
  state text default 'NY',
  zip text,
  borough text,                         -- "Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"
  neighborhood text,                    -- when known
  geo geography(point, 4326),

  status text,                          -- "active", "inactive", "pending"
  registered_at date,                   -- when first registered
  last_seen_in_registry_at timestamptz, -- when we most recently saw this row in the source

  raw_payload jsonb,                    -- preserve source row for debugging

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_universe_geo_gist on public.business_universe using gist (geo);
create index business_universe_borough on public.business_universe (borough);
create index business_universe_category_gin on public.business_universe using gin (category);
create index business_universe_name_trgm on public.business_universe using gin (name gin_trgm_ops);

-- Per-business social media + website lookup. Built by enrichment Edge Function.
create table public.business_socials (
  business_id uuid primary key references public.business_universe on delete cascade,

  website_url text,
  instagram_handle text,
  x_handle text,
  tiktok_handle text,
  facebook_url text,
  yelp_url text,
  google_place_id text,                 -- joins to Google Places metadata

  enriched_at timestamptz not null default now(),
  enrichment_confidence numeric(3, 2),  -- 0–1 from the enrichment heuristic
  enrichment_sources text[]             -- ["google_search", "website_scrape", "yelp_match"]
);

-- Smart polling: assigns each business to a tier based on activity, drives the
-- per-business poll cadence used by the cron worker. Updated continuously.
create table public.business_polling_state (
  business_id uuid primary key references public.business_universe on delete cascade,

  -- Activity signals
  last_post_at timestamptz,
  posts_last_7d integer not null default 0,
  posts_last_30d integer not null default 0,
  engagement_velocity numeric(8, 2) default 0, -- likes+replies per post per hour, ema

  -- Poll cadence outcome (re-derived nightly by a job, not user-editable)
  tier integer not null default 4,      -- 1 = hourly, 2 = 6h, 3 = daily, 4 = weekly, 5 = monthly
  next_poll_at timestamptz,

  last_polled_at timestamptz,
  last_poll_ok boolean,
  poll_error_count integer not null default 0
);

create index business_polling_next on public.business_polling_state (next_poll_at)
  where tier <= 3;

-- Enrichment + import job log
create table public.business_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                   -- "bulk_import" | "enrichment" | "poll"
  source text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  rows_processed integer not null default 0,
  rows_new integer not null default 0,
  rows_updated integer not null default 0,
  notes text,
  raw_error text
);

create index business_ingest_runs_kind on public.business_ingest_runs (kind, started_at desc);

alter table public.business_universe enable row level security;
alter table public.business_socials enable row level security;
alter table public.business_polling_state enable row level security;
alter table public.business_ingest_runs enable row level security;

-- Public read on the business universe (it's all public-records data).
create policy "business universe readable by authenticated"
  on public.business_universe for select using (auth.role() = 'authenticated');
create policy "business socials readable by authenticated"
  on public.business_socials for select using (auth.role() = 'authenticated');
