// Edge Function: plan-day
// Orchestrates find-spots across the day's slots.
//
// Pipeline:
//   1. Decompose date into slots based on day-of-week + itinerary anchor
//   2. For each open (non-anchor) slot, call find-spots logic with:
//        - slot-specific purpose
//        - location constrained by adjacent slots
//        - use-case fit re-weighted per optimizeFor
//   3. Apply day-level constraints in code:
//        - geographic threading (penalize backtracking)
//        - energy budget (filter hard candidates if recovery)
//        - novelty (penalize neighborhoods seen in recentPlans)
//   4. Assemble PlanDayResponse with vibe + flow + spend rollup + tradeoffs
//
// Source-of-truth spec for the orchestration heuristic:
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/plan-day/SKILL.md

// deno-lint-ignore-file no-unused-vars
import { corsHeaders } from '../_shared/cors.ts';
import type {
  PlanDayRequest,
  PlanDayResponse,
} from '../../../shared/types.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: PlanDayRequest = await req.json();
    if (!body?.dateISO || !body?.anchorLocation) {
      return json({ error: 'dateISO and anchorLocation are required' }, 400);
    }

    // TODO: implement
    const stub: PlanDayResponse = {
      dateISO: body.dateISO,
      optimizeFor: body.optimizeFor ?? 'balanced',
      energy: body.energy ?? 'medium',
      vibe: 'Stub — not yet implemented.',
      slots: [],
      geographicFlow: '',
      totalTransitMinutes: 0,
      spendEstimate: {
        cafe: 0,
        food: 0,
        drinks: 0,
        cover: 0,
        transit: 0,
        total: 0,
        currency: 'USD',
      },
      tradeoffs: [],
      generatedAt: new Date().toISOString(),
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
