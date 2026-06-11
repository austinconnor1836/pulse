// Edge Function: log-interaction
//
// Called by mobile clients on every meaningful interaction with the heuristic.
// Writes to user_interactions; nightly rollup job updates user_preferences +
// heuristic_signal_metrics + spot_reinforcement.
//
// Designed to be FAST and FORGIVING — never error the calling UI for a missing
// optional field. Drop unknown kinds rather than 400.

// deno-lint-ignore-file no-unused-vars
import { corsHeaders } from '../_shared/cors.ts';

interface LogInteractionRequest {
  kind: string;                          // matches the interaction_kind enum
  spotPlaceId?: string;
  eventId?: string;
  dayPlanId?: string;
  queryPurpose?: string;
  queryLocation?: { lat: number; lng: number };
  rankPosition?: number;
  scoreAtImpression?: number;
  scoreBreakdown?: Record<string, number>;
  ratingValue?: number;
  overrideFromPlaceId?: string;
  overrideToPlaceId?: string;
  notes?: string;
  heuristicVersion?: string;
  clientApp?: 'ios' | 'android';
  clientVersion?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: LogInteractionRequest = await req.json();
    if (!body?.kind) {
      // Fire-and-forget client semantics: don't error on missing kind.
      return json({ ok: true, dropped: 'missing kind' }, 200);
    }

    // TODO: implement
    //   const user = await getUserFromJwt(req)
    //   await supabase.from('user_interactions').insert({ user_id: user.id, ...mapBodyToRow(body) })

    return json({ ok: true }, 200);
  } catch (err) {
    // Always 200 to clients — never let logging errors break the UX.
    return json({ ok: false, error: (err as Error).message }, 200);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
