// Edge Function: ingest-events
//
// Hourly cron job. Polls a list of sources, extracts structured Event objects
// via Claude, upserts into `public.events`. Each source has its own poll cadence.
// Designed to be triggered by pg_cron — see supabase/migrations/...schedules.sql.
//
// Sources, in poll-priority order:
//   1. civic        — nyc.gov press, mayor's office, NYC Parks calendar    (hourly)
//   2. news         — Gothamist, Time Out NY, Eater NY, NYT Metro, ABC7    (hourly)
//   3. reddit       — r/nyc, r/asknyc top + new                            (30 min)
//   4. event APIs   — Eventbrite, DICE, RA                                 (4 hr)
//   5. venue social — IG + X for monitored venue list                      (2 hr)
//
// Each poll:
//   - Fetch latest items since last successful run (from event_ingest_runs)
//   - Pass to Claude with EventExtraction schema → Event[]
//   - Match to Google Places place_id by name + venue (best-effort)
//   - Upsert by canonical_key (title-slug + venue-slug + start-date)
//   - Detect `supersedes` relationships ("moved from X to Y" wording)
//   - Log to event_ingest_runs

// deno-lint-ignore-file no-unused-vars
import { corsHeaders } from '../_shared/cors.ts';

interface IngestRequest {
  sources?: string[];   // override: which sources to poll this run
  dryRun?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify shared-secret header so only pg_cron can hit this. Public clients
    // should never trigger ingest directly.
    const secret = req.headers.get('x-ingest-secret');
    if (!secret || secret !== Deno.env.get('INGEST_SECRET')) {
      return json({ error: 'forbidden' }, 403);
    }

    const body: IngestRequest = await req.json().catch(() => ({}));

    // TODO: implement
    //   for each source in (body.sources ?? DEFAULT_SOURCES):
    //     const run = await beginRun(source)
    //     try:
    //       const items = await fetchSourceSinceLastRun(source)
    //       const events = await claudeExtractEvents(source, items)
    //       const { inserted, updated } = await upsertEvents(events)
    //       await finishRun(run, { ok: true, events_seen: items.length, events_new: inserted, events_updated: updated })
    //     catch (e):
    //       await finishRun(run, { ok: false, raw_error: e.message })

    return json({ ok: true, dryRun: body.dryRun ?? false }, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
