-- Business profile = LLM-derived semantic classification of what each business
-- ACTUALLY does, derived from scraping their public website (homepage + about +
-- menu where applicable). This is the layer that turns "Yelp category = restaurant"
-- into "Korean BBQ restaurant with soju cocktail bar, DJ Fri-Sat, dog-friendly
-- outdoor patio."
--
-- Pipeline runs after business_socials enrichment finds the website_url. Polite:
-- respects robots.txt, sets User-Agent, 10s timeout, max 5 pages per domain per
-- enrichment run. Refresh quarterly OR on signal (sustained drop in visits, post
-- velocity spike, social-bio change).
--
-- See /Users/austin/Developer/pulse/docs/realtime-ingestion.md
-- and find-spots SKILL.md "Use-case fit" signal.

create table public.business_profile (
  business_id uuid primary key references public.business_universe on delete cascade,

  -- Raw scraped artifacts (snippets only — don't store entire site, store enough
  -- for the LLM extraction to be reproducible and for spot-check QA).
  homepage_url text,
  homepage_text_snippet text,               -- first ~5K chars of cleaned text
  about_page_url text,
  about_text_snippet text,
  menu_url text,
  menu_text_snippet text,
  events_page_url text,
  events_text_snippet text,

  scraped_at timestamptz not null default now(),
  scrape_status text not null default 'pending', -- 'ok' | '404' | 'blocked_by_robots' | 'timeout' | 'auth_required' | 'js_only' | 'pending'
  scrape_error text,

  -- LLM-derived structured fields. All optional — only populated if scrape succeeded
  -- and the content was informative.
  derived_business_type text,               -- "korean_bbq_restaurant", "vintage_record_store", "cocktail_bar_with_dj"
  derived_subcategories text[],             -- ["restaurant", "bar", "music_venue"]
  derived_products text[],                  -- ["soju cocktails", "kimchi pancake", "vinyl records"]
  derived_services text[],                  -- ["dine-in", "delivery", "private events", "in-store DJ sets"]
  derived_keywords text[],                  -- searchable keywords for semantic match
  derived_vibe_descriptors text[],          -- ["lively", "date-friendly", "queer-leaning", "loud", "quiet"]
  derived_price_range text,                 -- '$' | '$$' | '$$$' | '$$$$'

  derived_hours_text text,                  -- human-readable hours string
  derived_payment_methods text[],
  derived_amenities text[],                 -- ["wifi", "outdoor seating", "outlets", "dog-friendly", "wheelchair-accessible"]

  -- Per-purpose pre-computed fit scores. These let find-spots return ranked
  -- results without re-running an LLM per query. Updated each time business_profile
  -- is re-enriched.
  fit_remote_work numeric(3, 2),            -- 0-1: "can I work from here for hours?"
  fit_dive_bar numeric(3, 2),               -- 0-1: "is this a dive bar with character?"
  fit_cocktail_bar numeric(3, 2),
  fit_brunch numeric(3, 2),
  fit_dance_floor numeric(3, 2),
  fit_quiet_date numeric(3, 2),
  fit_group_outing numeric(3, 2),
  -- Add columns as the purpose taxonomy expands. Keep as flat numeric columns
  -- (not JSONB) so they're indexable for fast per-purpose query filtering.

  -- Binary derived attributes that show up often
  has_outdoor_seating boolean,
  has_wifi boolean,
  has_dance_floor boolean,
  is_wheelchair_accessible boolean,
  serves_alcohol boolean,
  is_chain boolean,

  -- Audit + retraining hooks
  llm_model_used text,                      -- "claude-haiku-4-5-20251001" etc
  extraction_version text not null default 'v0.1', -- bump when extraction prompt changes
  human_verified_at timestamptz,            -- when a human spot-checked
  human_corrections jsonb,                  -- field-level corrections — training data

  updated_at timestamptz not null default now()
);

-- Geo + category indexes for fast filtered query — "find every vinyl record shop in EV"
create index business_profile_subcategories_gin on public.business_profile using gin (derived_subcategories);
create index business_profile_keywords_gin on public.business_profile using gin (derived_keywords);
create index business_profile_products_gin on public.business_profile using gin (derived_products);
create index business_profile_amenities_gin on public.business_profile using gin (derived_amenities);
create index business_profile_business_type on public.business_profile (derived_business_type);

-- Per-purpose fit indexes — used by find-spots ranking queries
create index business_profile_fit_remote_work on public.business_profile (fit_remote_work desc) where fit_remote_work > 0.3;
create index business_profile_fit_dive_bar on public.business_profile (fit_dive_bar desc) where fit_dive_bar > 0.3;
create index business_profile_fit_cocktail_bar on public.business_profile (fit_cocktail_bar desc) where fit_cocktail_bar > 0.3;

alter table public.business_profile enable row level security;
create policy "profile readable by authenticated"
  on public.business_profile for select using (auth.role() = 'authenticated');

-- Snippet preservation policy: when a re-scrape produces different content, we
-- want to keep history of what we used to derive previous classifications.
-- That's how we audit "did our extraction change because their business
-- pivoted, or because our prompt got better?"
create table public.business_profile_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_universe on delete cascade,

  snapshot_at timestamptz not null default now(),
  scrape_status text,
  homepage_text_snippet text,
  about_text_snippet text,
  menu_text_snippet text,

  derived_business_type text,
  derived_subcategories text[],
  derived_products text[],
  derived_services text[],

  fit_scores jsonb,                         -- full per-purpose fit snapshot
  extraction_version text,
  llm_model_used text
);

create index business_profile_history_business on public.business_profile_history (business_id, snapshot_at desc);

alter table public.business_profile_history enable row level security;
create policy "profile history readable by authenticated"
  on public.business_profile_history for select using (auth.role() = 'authenticated');

-- Domain politeness ledger. Tracks per-domain scrape rate so we don't hammer
-- any single host. Cron checks this before requesting; enforces 1 req per 10 sec
-- per domain by default.
create table public.scrape_domain_state (
  domain text primary key,
  last_scraped_at timestamptz,
  scrapes_last_hour integer not null default 0,
  robots_txt_text text,                     -- cached robots.txt
  robots_txt_fetched_at timestamptz,
  rate_limit_seconds integer not null default 10,
  permanently_blocked boolean not null default false,
  permanently_blocked_reason text
);

alter table public.scrape_domain_state enable row level security;
