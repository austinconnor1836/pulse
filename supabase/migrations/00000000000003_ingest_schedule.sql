-- pg_cron schedules for the events ingestion pipeline.
-- Requires pg_cron extension (enabled by default on Supabase). Each schedule
-- POSTs to the ingest-events Edge Function with an x-ingest-secret header.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: invoke the ingest-events function with a given sources list.
-- The function URL is read from a config row so we can change it without
-- editing the cron schedule.
create table if not exists public.app_config (
  key text primary key,
  value text not null
);

-- Seed: caller must update these after `supabase link`.
insert into public.app_config (key, value)
values
  ('ingest_events_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/ingest-events'),
  ('ingest_secret', 'CHANGE_ME')
on conflict (key) do nothing;

-- Schedule: civic + news hourly at :05
select cron.schedule(
  'ingest-civic-news',
  '5 * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_config where key = 'ingest_events_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', (select value from public.app_config where key = 'ingest_secret')
    ),
    body := jsonb_build_object('sources', array['civic', 'news'])
  );
  $$
);

-- Schedule: reddit every 30 minutes at :10 + :40
select cron.schedule(
  'ingest-reddit',
  '10,40 * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_config where key = 'ingest_events_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', (select value from public.app_config where key = 'ingest_secret')
    ),
    body := jsonb_build_object('sources', array['reddit'])
  );
  $$
);

-- Schedule: event APIs (Eventbrite, DICE, RA) every 4 hours at :15
select cron.schedule(
  'ingest-event-apis',
  '15 */4 * * *',
  $$
  select net.http_post(
    url := (select value from public.app_config where key = 'ingest_events_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', (select value from public.app_config where key = 'ingest_secret')
    ),
    body := jsonb_build_object('sources', array['eventbrite', 'dice', 'ra'])
  );
  $$
);

-- Schedule: venue social every 2 hours at :20
select cron.schedule(
  'ingest-venue-social',
  '20 */2 * * *',
  $$
  select net.http_post(
    url := (select value from public.app_config where key = 'ingest_events_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', (select value from public.app_config where key = 'ingest_secret')
    ),
    body := jsonb_build_object('sources', array['instagram', 'x'])
  );
  $$
);

-- Lock down app_config — readable by service role only.
alter table public.app_config enable row level security;
