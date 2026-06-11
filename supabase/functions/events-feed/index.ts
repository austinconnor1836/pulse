// Edge Function: events-feed
//
// Returns time-bound events near a location. Two paths in one response:
//   A. Cron-ingested events from the `events` table (read).
//   B. Per-query live search (LLM + web search), gated by request.includeLiveSearch.
//      Results from (B) are merged + deduped against (A) by canonical_key before return.
//
// Cache: results cached 15 min per (location, hour, purpose-set) tuple. Cache-bust
// on any new event with announced_at within the cache window.

// deno-lint-ignore-file no-unused-vars
import { corsHeaders } from '../_shared/cors.ts';

interface EventsFeedRequest {
  location: { lat: number; lng: number; label?: string };
  whenStartISO?: string;
  whenEndISO?: string;
  purposes?: string[];
  maxResults?: number;
  includeLiveSearch?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const body: EventsFeedRequest = await req.json();
    if (!body?.location) {
      return json({ error: 'location is required' }, 400);
    }

    // TODO: implement
    //   1. const cached  = await queryIndex(body)                     // Postgres KNN by geo
    //   2. const live    = body.includeLiveSearch ? await liveSearch(body) : []
    //   3. const merged  = dedupeByCanonicalKey([...cached, ...live])
    //   4. const ranked  = sortByAnnouncedAtThenStartAt(merged).slice(0, body.maxResults ?? 25)
    //   5. return { events: ranked, freshness: { ... }, generatedAt: now }
    //
    // liveSearch() does:
    //   - WebSearch tool call: "[location] events tonight" + "[location] news today"
    //   - Claude extraction: pages → structured Event[] (JSON mode)
    //   - Upsert into events table (background) so future cron runs benefit
    return json(
      {
        events: [],
        generatedAt: new Date().toISOString(),
        freshness: {
          newestAnnouncedAtISO: null,
          oldestIngestedAtISO: null,
          sourcesPolled: [],
          cacheHitRatio: 0,
        },
      },
      200,
    );
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
