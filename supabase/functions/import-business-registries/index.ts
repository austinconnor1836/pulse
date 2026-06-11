// Edge Function: import-business-registries
//
// Monthly job. Pulls bulk datasets from NYC Open Data + NYS Dept of State
// and upserts into business_universe. The data sources are deterministic
// public records — this is where "every business" enumeration happens.
//
// Datasets to pull:
//
//   NYC Open Data (Socrata API, no key required for read):
//   - DCWP "Legally Operating Businesses"        ~250K active licensed businesses
//   - DOHMH "Restaurant Inspection Results"       ~25K restaurants (current grade A/B/C)
//   - SLA "On Premises Liquor Licenses"           ~3K bars + nightclubs
//   - DCA "Sidewalk Cafe Licenses"
//   - DPR "NYC Parks Permits and Events"          venues for cultural/civic events
//   - Cultural Institutions Group
//
//   NYS Dept of State Division of Corporations (NYS DOS):
//   - Corporation and Business Entity Database   — all NY-registered entities
//   - Bulk download available via FTP / OData
//
// Strategy:
//   - Fetch each dataset's most recent diff (Socrata supports $where=last_modified>...)
//   - Upsert by (source_registry, source_id)
//   - Mark rows not seen this run with status='inactive' after a 60-day grace period
//   - Re-trigger enrichment for any new rows

// deno-lint-ignore-file no-unused-vars
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const secret = req.headers.get('x-ingest-secret');
    if (!secret || secret !== Deno.env.get('INGEST_SECRET')) {
      return json({ error: 'forbidden' }, 403);
    }

    // TODO: implement
    //   const SOURCES = [
    //     { registry: "nyc.dca.licenses",       url: "https://data.cityofnewyork.us/resource/w7w3-xahh.json" },
    //     { registry: "nyc.dohmh.restaurants",  url: "https://data.cityofnewyork.us/resource/43nn-pn8j.json" },
    //     { registry: "nyc.sla.liquor",         url: "https://data.cityofnewyork.us/resource/hrvs-jzmx.json" },
    //     // ...
    //   ]
    //   for (const source of SOURCES) {
    //     const lastImport = await mostRecentSuccessfulRun(source.registry)
    //     const rows = await fetchSocrata(source.url, { since: lastImport })
    //     const { inserted, updated } = await upsertBusinesses(source.registry, rows)
    //     await queueEnrichmentForNew(inserted)
    //   }

    return json({ ok: true }, 200);
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
