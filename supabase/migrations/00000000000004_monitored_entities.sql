-- Monitored entities = the curated set of "every entity we actively poll."
-- The Tier 1 of the layered ingestion model (see docs/realtime-ingestion.md).
-- Adding/removing rows here is what makes "every entity" tractable.

create type entity_kind as enum (
  'civic_official',     -- mayor, governor, council members, agency heads
  'civic_agency',       -- NYPD newsroom, NYC Parks, MTA, DSNY, DOT, FDNY
  'venue',              -- bars, restaurants, clubs, music venues
  'cultural_org',       -- museums, theaters, BAM, Lincoln Center
  'news_outlet',        -- Gothamist, Time Out, Eater, NY Times Metro, ABC7
  'journalist',         -- trusted reporters
  'community_org',      -- neighborhood orgs, BIDs, mutual aid
  'event_promoter',     -- party series (Papi Juice, Hot Rabbit, House of Yes)
  'sports_team',        -- Knicks, Rangers, Liberty, etc.
  'subreddit',          -- r/nyc, r/asknyc, r/AskNYC
  'other'
);

create type ingest_channel as enum (
  'rss',                -- RSS/Atom feed (cheapest, politest)
  'json_api',           -- public JSON endpoint (Reddit, NYC.gov)
  'event_api',          -- Eventbrite, DICE, RA paid/free APIs
  'website_html',       -- HTML scrape (light, polite)
  'instagram',          -- IG Graph API (limited) or third-party scraper
  'x_api',              -- X (Twitter) API — paid
  'tiktok',             -- TikTok — extremely limited
  'manual'              -- human curator types it in
);

create table public.monitored_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind entity_kind not null,

  -- Geographic relevance: which neighborhood/borough/city this entity is tied to.
  -- Used to boost relevance when a user queries from that area.
  neighborhood text,
  borough text,
  city text not null default 'New York',

  -- One row per channel — same entity can have RSS + Reddit + IG + X handles.
  channels jsonb not null default '{}'::jsonb,
  /* Shape:
     {
       "rss":           "https://www1.nyc.gov/office-of-the-mayor/news.page?rss=1",
       "json_api":      "https://www.reddit.com/r/nyc/new.json",
       "website_html":  "https://thequnyc.com/events",
       "instagram":     "@mayorofnyc",
       "x_api":         "NYCMayor",
       "tiktok":        "@nycmayor"
     }
  */

  -- Poll cadence per channel (minutes). Overrides defaults from the cron schedule
  -- when this entity needs a tighter or looser leash.
  poll_cadence_min jsonb not null default '{}'::jsonb,

  -- Trust signal. Bumps confidence on events extracted from this entity.
  -- 1.0 = primary (mayor's office, NYC Parks announcements).
  -- 0.7 = trusted secondary (Gothamist, Time Out staff).
  -- 0.4 = user-generated (Reddit, IG community).
  trust_weight numeric(3, 2) not null default 0.7,

  -- Active = currently polled. Set false to pause an entity without deleting.
  active boolean not null default true,

  -- When we last polled successfully, per channel. Updated by ingest-events.
  last_polled_at jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monitored_entities_active_kind on public.monitored_entities (kind) where active;
create index monitored_entities_neighborhood on public.monitored_entities (neighborhood);

alter table public.monitored_entities enable row level security;
create policy "entities readable by authenticated"
  on public.monitored_entities for select using (auth.role() = 'authenticated');

-- Seed: the minimum set worth polling for the NYC use case.
-- Expand this list (and only this list) to widen the "every entity" surface.
insert into public.monitored_entities (name, kind, channels, trust_weight) values
  ('NYC Mayor''s Office', 'civic_official',
    '{"rss":"https://www.nyc.gov/office-of-the-mayor/news.page?rss=1", "x_api":"NYCMayor", "instagram":"@nycmayor"}',
    1.0),
  ('NYC Parks', 'civic_agency',
    '{"rss":"https://www.nycgovparks.org/feeds/news.rss", "x_api":"NYCParks"}',
    1.0),
  ('MTA', 'civic_agency',
    '{"x_api":"MTA", "rss":"https://new.mta.info/rss"}',
    1.0),
  ('NYPD News', 'civic_agency',
    '{"x_api":"NYPDnews"}',
    1.0),
  ('Gothamist', 'news_outlet',
    '{"rss":"https://gothamist.com/feed", "x_api":"Gothamist"}',
    0.85),
  ('Time Out New York', 'news_outlet',
    '{"rss":"https://www.timeout.com/newyork/rss.xml", "x_api":"TimeOutNewYork"}',
    0.8),
  ('Eater NY', 'news_outlet',
    '{"rss":"https://ny.eater.com/rss/index.xml", "x_api":"EaterNY"}',
    0.85),
  ('r/nyc', 'subreddit',
    '{"json_api":"https://www.reddit.com/r/nyc/new.json"}',
    0.5),
  ('r/AskNYC', 'subreddit',
    '{"json_api":"https://www.reddit.com/r/AskNYC/new.json"}',
    0.4),
  ('NY Knicks', 'sports_team',
    '{"x_api":"nyknicks", "instagram":"@nyknicks"}',
    0.9),
  ('Elsewhere (Bushwick)', 'venue',
    '{"website_html":"https://www.elsewherebrooklyn.com/calendar", "instagram":"@elsewherespace"}',
    0.7),
  ('House of Yes', 'venue',
    '{"website_html":"https://www.houseofyes.org/calendar", "instagram":"@houseofyes"}',
    0.7),
  ('3 Dollar Bill', 'venue',
    '{"website_html":"https://3dollarbillbk.com/events", "instagram":"@3dollarbillbk"}',
    0.7)
on conflict do nothing;

-- User-submitted events: the community fill-in for the long tail.
create table public.user_submitted_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  venue_name text,
  geo geography(point, 4326),
  tags text[] not null default '{}',
  promoted_event_id uuid references public.events,  -- set when an admin/heuristic promotes to public events
  created_at timestamptz not null default now()
);

alter table public.user_submitted_events enable row level security;
create policy "own submissions" on public.user_submitted_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
