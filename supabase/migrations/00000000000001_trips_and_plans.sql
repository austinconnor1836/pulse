-- Trips + day plans + saved spots. Minimal schema for Phase 2 (TestFlight).

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  lodging_label text,
  lodging_lat double precision,
  lodging_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.day_plans (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips on delete cascade,
  date date not null,
  optimize_for text not null,
  energy text not null,
  payload jsonb not null,         -- full PlanDayResponse
  created_at timestamptz not null default now(),
  unique (trip_id, date)
);

create table public.saved_spots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  trip_id uuid references public.trips on delete set null,
  place_id text not null,          -- Google Places place_id
  name text not null,
  payload jsonb not null,          -- full ScoredSpot
  created_at timestamptz not null default now(),
  unique (user_id, place_id)
);

alter table public.trips enable row level security;
alter table public.day_plans enable row level security;
alter table public.saved_spots enable row level security;

create policy "own trips" on public.trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own day_plans" on public.day_plans
  for all using (
    auth.uid() = (select user_id from public.trips where id = day_plans.trip_id)
  ) with check (
    auth.uid() = (select user_id from public.trips where id = day_plans.trip_id)
  );

create policy "own saved_spots" on public.saved_spots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
