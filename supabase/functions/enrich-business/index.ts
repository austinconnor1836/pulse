// Edge Function: enrich-business
//
// Two-pass enrichment per business:
//
// Pass A (cheap): find website + socials.
//   1. Google Places Find Place by Name + Address → place_id + website
//   2. Fetch the business website's homepage → extract linked socials
//   3. Fallback: Google search "[name] [neighborhood] instagram" → LLM extraction
//   4. Upsert business_socials with enrichment_confidence + sources
//
// Pass B (richer): scrape website content → semantic classification.
//   5. Re-fetch homepage + try /about, /menu, /events (max 5 pages per domain,
//      respecting robots.txt, polite User-Agent, 10s timeout)
//   6. Extract cleaned text from each
//   7. Single Claude call with the BusinessProfile schema → fills derived_*
//      fields, derived attributes, and per-purpose fit_* scores
//   8. Snapshot prior profile into business_profile_history before upsert
//   9. Upsert business_profile + bump extraction_version if prompt changed
//
// Per-business cost target (Pass A + Pass B):
//   - Places Find Place:   ~$0.017
//   - Homepage scrape:     ~$0 (own bandwidth)
//   - Claude socials extract (Haiku):    ~$0.001
//   - 3-page scrape + Claude profile (Haiku, ~8K in / 2K out): ~$0.012
//   - Total: ~$0.030 per business
//
//   For 250K NYC businesses: ~$7.5K one-time, ~$1K/quarter to re-enrich the
//   most-active 20%. Counts as Phase 3 (Aggressive) spend per the cost tiers
//   in docs/realtime-ingestion.md.
//
// Run as a batched background job: process N=20 businesses per invocation
// to stay within Edge Function CPU budget. Hourly off-peak cron.

// deno-lint-ignore-file no-unused-vars
import { corsHeaders } from '../_shared/cors.ts';

interface EnrichRequest {
  batchSize?: number;
  forceReenrichOlderThan?: string;
  passes?: ('socials' | 'profile')[];   // default ['socials', 'profile']
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const secret = req.headers.get('x-ingest-secret');
    if (!secret || secret !== Deno.env.get('INGEST_SECRET')) {
      return json({ error: 'forbidden' }, 403);
    }
    const body: EnrichRequest = await req.json().catch(() => ({}));
    const batchSize = body.batchSize ?? 20;
    const passes = body.passes ?? ['socials', 'profile'];

    // TODO: implement
    //
    // const businesses = await selectEnrichableBatch(batchSize, passes)
    // const results = await Promise.all(businesses.map(async (b) => {
    //   if (passes.includes('socials') && !b.has_socials) {
    //     await enrichSocials(b)
    //   }
    //   if (passes.includes('profile') && b.website_url) {
    //     await enrichProfile(b)
    //   }
    // }))
    //
    // // ---- enrichProfile shape ----
    // async function enrichProfile(b) {
    //   const allowed = await checkRobotsAndRateLimit(b.website_url)
    //   if (!allowed) return markBlocked(b)
    //
    //   const pages = await scrapeRelevantPages(b.website_url)
    //   // pages = { homepage, about, menu, events } — each { url, text_snippet, status }
    //
    //   const profile = await claudeExtractProfile(pages, {
    //     systemPrompt: PROFILE_EXTRACTION_PROMPT_V01,
    //     schema: BUSINESS_PROFILE_SCHEMA,
    //   })
    //
    //   await snapshotHistoryIfChanged(b.id, profile)
    //   await upsertBusinessProfile(b.id, profile)
    // }

    return json({ ok: true, processed: 0, batchSize, passes }, 200);
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

// ---------- The extraction schema (referenced by the Claude call) ----------

// JSON Schema used to constrain Claude's output to the business_profile shape.
// Bump EXTRACTION_VERSION when this changes — it cascades to invalidating cached
// profile rows on the next refresh.
export const EXTRACTION_VERSION = 'v0.1';

export const BUSINESS_PROFILE_SCHEMA = {
  type: 'object',
  required: [
    'derived_business_type',
    'derived_subcategories',
    'derived_keywords',
    'derived_vibe_descriptors',
    'fit_scores',
  ],
  properties: {
    derived_business_type: {
      type: 'string',
      description:
        "Specific business type slug, e.g. 'korean_bbq_restaurant', 'vintage_record_store', 'cocktail_bar_with_dj'. Lowercase snake_case. Be specific — not just 'restaurant'.",
    },
    derived_subcategories: {
      type: 'array',
      items: { type: 'string' },
      description: "Broader categories this fits. E.g. ['restaurant', 'bar', 'music_venue'] for a Korean BBQ that also hosts DJs.",
    },
    derived_products: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific products/menu items they advertise on their site',
    },
    derived_services: {
      type: 'array',
      items: { type: 'string' },
      description: "Services offered: 'dine-in', 'delivery', 'private events', 'live music nights', etc.",
    },
    derived_keywords: {
      type: 'array',
      items: { type: 'string' },
      description: 'Searchable keywords. Include cuisines, neighborhoods, vibe terms — anything a user might search for.',
    },
    derived_vibe_descriptors: {
      type: 'array',
      items: { type: 'string' },
      description: "Vibe: 'lively', 'date-friendly', 'queer-leaning', 'loud', 'quiet', 'date', 'group-friendly', etc.",
    },
    derived_price_range: { type: 'string', enum: ['$', '$$', '$$$', '$$$$'] },
    derived_hours_text: { type: 'string' },
    derived_amenities: { type: 'array', items: { type: 'string' } },
    has_outdoor_seating: { type: 'boolean' },
    has_wifi: { type: 'boolean' },
    has_dance_floor: { type: 'boolean' },
    is_wheelchair_accessible: { type: 'boolean' },
    serves_alcohol: { type: 'boolean' },
    is_chain: { type: 'boolean' },
    fit_scores: {
      type: 'object',
      description:
        "Per-purpose fit scores, 0-1 each. Score conservatively — if the site doesn't give evidence, score low. These directly drive the use-case-fit signal in find-spots ranking.",
      required: [
        'remote_work', 'dive_bar', 'cocktail_bar', 'brunch',
        'dance_floor', 'quiet_date', 'group_outing',
      ],
      properties: {
        remote_work: { type: 'number', minimum: 0, maximum: 1 },
        dive_bar: { type: 'number', minimum: 0, maximum: 1 },
        cocktail_bar: { type: 'number', minimum: 0, maximum: 1 },
        brunch: { type: 'number', minimum: 0, maximum: 1 },
        dance_floor: { type: 'number', minimum: 0, maximum: 1 },
        quiet_date: { type: 'number', minimum: 0, maximum: 1 },
        group_outing: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

export const PROFILE_EXTRACTION_PROMPT_V01 = `You are classifying a business from its own public website. Goal: produce a structured profile that helps users find the right place when they search for what they want.

You receive: cleaned text snippets from the business's homepage, about page, menu page, and events page (any may be missing).

Output the BusinessProfile schema. Critical rules:

1. Be SPECIFIC. "korean_bbq_restaurant" not "restaurant". "vintage_record_store" not "retail".
2. Score fit_scores CONSERVATIVELY. If the site doesn't give clear evidence the place is good for X, score low. A coffee shop with no outlet mentions isn't 0.9 on remote_work — it's maybe 0.4.
3. derived_keywords should include things a user might actually search for. If the site mentions "natural wine" or "soju cocktails" — include those exact terms.
4. derived_vibe_descriptors come from the SITE'S OWN COPY — what tone does their About page strike? If they say "neighborhood dive" → ['dive', 'neighborhood', 'no-frills']. If they say "elevated tasting menu" → ['fine_dining', 'date_night'].
5. If a field is genuinely unknowable from the site, omit it or use null. DON'T hallucinate.
6. is_chain = true if they reference multiple locations on the site OR are a known chain.`;
