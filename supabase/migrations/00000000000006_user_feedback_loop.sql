-- User-decision feedback loop. Every meaningful interaction with the heuristic
-- gets logged here, then rolled up into per-user weights and aggregate signal
-- metrics that tune the heuristic over time.
--
-- The deterministic heuristic in shared/Scoring.kt stays the same — it remains
-- explainable + auditable. What this enables:
--   1. Per-user personalization (small re-weighting of signals at query time)
--   2. Aggregate signal metrics for quarterly heuristic tuning
--   3. Spot-level "did people actually like this" reinforcement
--
-- See /Users/austin/Developer/pulse/docs/feedback-loop.md

create type interaction_kind as enum (
  -- Implicit signals (the user did something the app can observe)
  'spot_impression',     -- spot appeared in their ranked list
  'spot_tap',            -- they tapped to see details
  'spot_save',           -- they saved/bookmarked
  'spot_directions',     -- they hit the directions button
  'spot_share',          -- they shared the spot
  'plan_view',           -- they viewed a generated day plan
  'plan_slot_view',      -- they viewed a specific slot
  'plan_save',           -- they saved a plan to their schedule
  -- Explicit signals (the user told the app something)
  'spot_visit_confirmed', -- they confirmed they actually went
  'spot_rating',          -- 1-5 star or thumbs up/down on a spot
  'spot_thumbs_up',       -- positive feedback
  'spot_thumbs_down',     -- negative feedback
  'plan_slot_override',   -- they replaced the planner's pick for a slot
  'plan_target_change',   -- they switched optimization target
  -- Friction signals (the user re-queried similar things shortly after)
  're_query_same_purpose'  -- same purpose within 2 hours → previous result was inadequate
);

create table public.user_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,

  kind interaction_kind not null,
  at timestamptz not null default now(),

  -- What the interaction was about. Polymorphic — depends on kind.
  spot_place_id text,                   -- when kind is spot_*
  event_id uuid references public.events on delete set null,
  day_plan_id uuid references public.day_plans on delete set null,

  -- Query context: what the user was asking for when this surfaced.
  query_purpose text,                   -- e.g. "best cocktails"
  query_location geography(point, 4326),
  query_at timestamptz,

  -- For impressions: where in the ranked list this spot appeared.
  rank_position integer,                -- 1-indexed
  score_at_impression numeric(5, 2),
  score_breakdown jsonb,                -- snapshot of the 5-signal breakdown at the time

  -- For explicit ratings.
  rating_value integer,                 -- 1-5 or -1/+1 depending on rating UI

  -- For overrides: which spot replaced which.
  override_from_place_id text,
  override_to_place_id text,

  -- Free-text feedback when the UI captured it.
  notes text,

  -- For audit / debugging.
  heuristic_version text,               -- which version of the heuristic produced the ranking
  client_app text,                      -- "ios" | "android"
  client_version text
);

create index user_interactions_user_at on public.user_interactions (user_id, at desc);
create index user_interactions_spot on public.user_interactions (spot_place_id) where spot_place_id is not null;
create index user_interactions_kind on public.user_interactions (kind, at desc);

alter table public.user_interactions enable row level security;
create policy "own interactions" on public.user_interactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per-user learned preferences. Updated nightly by a job that reads
-- user_interactions and produces small weight adjustments to apply at query
-- time. Bounded to [-0.3, +0.3] so personalization can't override the base
-- heuristic — it just nudges.
create table public.user_preferences (
  user_id uuid primary key references auth.users on delete cascade,

  -- Per-signal weight multipliers, range [-0.3, +0.3]. Applied as
  -- `signal_score * (1 + multiplier)` at query time.
  weight_consensus numeric(4, 3) not null default 0,
  weight_recency numeric(4, 3) not null default 0,
  weight_use_case_fit numeric(4, 3) not null default 0,
  weight_distance numeric(4, 3) not null default 0,
  weight_real_time_relevance numeric(4, 3) not null default 0,

  -- Per-category multipliers, range [-0.5, +0.5]. JSON because the category
  -- vocabulary grows over time.
  category_weights jsonb not null default '{}'::jsonb,
  -- {"dive_bar": 0.2, "cocktail_bar": 0.1, "remote_work_cafe": 0.4, ...}

  -- Per-neighborhood multipliers, range [-0.5, +0.5].
  neighborhood_weights jsonb not null default '{}'::jsonb,
  -- {"east_village": 0.3, "murray_hill": -0.5, ...}

  -- Cohort assignment: which behavioral cluster this user falls into.
  -- Used for collaborative-filtering-style "users like you" boosts.
  cohort_id text,

  -- Audit
  last_recomputed_at timestamptz not null default now(),
  recompute_version text                -- which version of the weight-learning job produced these
);

alter table public.user_preferences enable row level security;
create policy "own preferences" on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Aggregate signal metrics — the rollup that humans look at quarterly to
-- decide whether to tune the base heuristic weights. Computed from
-- user_interactions; refreshed nightly.
create table public.heuristic_signal_metrics (
  id uuid primary key default gen_random_uuid(),

  -- Slice the metric by (city, category, time-window) so we can see e.g.
  -- "consensus is over-weighted for cocktails in EV — most users override
  -- to the lower-consensus spot."
  city text not null default 'New York',
  category text,
  neighborhood text,

  computed_at timestamptz not null default now(),

  -- Each signal: how well does it correlate with actual user choice?
  -- (impressions where chosen spot was top-N by signal, / total impressions)
  consensus_predictive_value numeric(4, 3),
  recency_predictive_value numeric(4, 3),
  use_case_fit_predictive_value numeric(4, 3),
  distance_predictive_value numeric(4, 3),
  real_time_relevance_predictive_value numeric(4, 3),

  -- Override rate: how often users replaced the heuristic's #1 pick
  -- with something else.
  override_rate numeric(4, 3),
  -- Re-query rate: how often users re-queried the same purpose within 2h.
  re_query_rate numeric(4, 3),

  -- Sample size — don't trust metrics with low N.
  impressions_count integer not null default 0,
  decisions_count integer not null default 0
);

create index heuristic_signal_metrics_slice on public.heuristic_signal_metrics
  (city, category, neighborhood, computed_at desc);

alter table public.heuristic_signal_metrics enable row level security;
create policy "metrics readable by authenticated"
  on public.heuristic_signal_metrics for select using (auth.role() = 'authenticated');

-- Per-spot reinforcement: aggregate "did people actually like this spot for
-- this purpose" signal. Boosts/dampens individual venues across all users.
create table public.spot_reinforcement (
  spot_place_id text not null,          -- Google Places place_id
  purpose_category text not null,        -- "cocktail_bar", "remote_work_cafe", etc.

  primary key (spot_place_id, purpose_category),

  impressions integer not null default 0,
  taps integer not null default 0,
  saves integer not null default 0,
  visits_confirmed integer not null default 0,
  thumbs_up integer not null default 0,
  thumbs_down integer not null default 0,
  overrides_to integer not null default 0,    -- times user picked THIS spot when overriding
  overrides_from integer not null default 0,  -- times user replaced THIS spot with something else

  -- Derived score: (saves + visits_confirmed*2 + thumbs_up + overrides_to)
  --              - (thumbs_down + overrides_from)
  --             / impressions
  -- Range roughly [-1, +1]. Applied as a small bonus to the use-case-fit
  -- signal at query time when this spot is being ranked for purpose_category.
  reinforcement_score numeric(5, 3) not null default 0,

  last_updated_at timestamptz not null default now()
);

create index spot_reinforcement_purpose on public.spot_reinforcement (purpose_category, reinforcement_score desc);

alter table public.spot_reinforcement enable row level security;
create policy "reinforcement readable by authenticated"
  on public.spot_reinforcement for select using (auth.role() = 'authenticated');
