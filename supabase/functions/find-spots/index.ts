// Edge Function: find-spots
// Ranks candidate venues for a stated purpose near a location.
//
// Hybrid pipeline:
//   1. Google Places Text Search   → candidate venues
//   2. Google Places Distance      → walk minutes
//   3. Claude API                  → translate purpose to attributes,
//                                    score use-case fit per candidate,
//                                    generate "why" copy
//   4. Score + rank in code (deterministic scoring lives in _shared/scoring.ts)
//
// Source-of-truth spec for the heuristic:
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md

// deno-lint-ignore-file no-unused-vars
import { corsHeaders } from '../_shared/cors.ts';
import {
  distanceScore,
  tierFor,
  totalScore,
} from '../_shared/scoring.ts';
import type {
  FindSpotsRequest,
  FindSpotsResponse,
  ScoredSpot,
} from '../../../shared/types.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: FindSpotsRequest = await req.json();
    if (!body?.purpose || !body?.location) {
      return json({ error: 'purpose and location are required' }, 400);
    }

    // TODO: implement
    //   1. const candidates = await googlePlacesTextSearch(body.purpose, body.location)
    //   2. const distances  = await distanceMatrix(body.location, candidates)
    //   3. const judgments  = await claudeJudge(body.purpose, candidates)
    //   4. const scored     = candidates.map(rankWithBreakdown).sort()
    //   5. return top maxResults (default 10) split into tiers
    const stub: FindSpotsResponse = {
      spots: [],
      generatedAt: new Date().toISOString(),
      mode: body.mode ?? 'lightweight',
    };
    return json(stub, 200);
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
