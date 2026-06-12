// Edge Function: log-interaction (W9)
//
// Called by mobile clients on every meaningful interaction with the heuristic.
// Writes to public.user_interactions (migration 00000000000006); the nightly
// rollup job (post-MVP) reads from there and updates user_preferences +
// heuristic_signal_metrics + spot_reinforcement.
//
// Designed to be FAST and FORGIVING — fire-and-forget (returns 202 before the
// DB write completes), and valid envelopes never get a 400 for a typo'd kind
// or out-of-range coords (they get dropped with 200 + a `dropped` reason).
//
// Source-of-truth spec: specs/W9-log-interaction/spec.md

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';
import { config } from '../_shared/env.ts';
import type {
  InteractionKind,
  Location,
  LogInteractionRequest,
  LogInteractionResponse,
  ScoreBreakdown,
} from '../../../shared/types.ts';

const KNOWN_KINDS: ReadonlySet<string> = new Set<InteractionKind>([
  'spot_impression', 'spot_tap', 'spot_save', 'spot_directions', 'spot_share',
  'plan_view', 'plan_slot_view', 'plan_save',
  'spot_visit_confirmed', 'spot_rating', 'spot_thumbs_up', 'spot_thumbs_down',
  'plan_slot_override', 'plan_target_change',
  're_query_same_purpose',
]);

function isValidLocation(loc: Location): boolean {
  if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return false;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return false;
  if (Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180) return false;
  return true;
}

// PostGIS WKT — PostgreSQL auto-casts text → geography(point, 4326).
function toWkt(loc: Location): string {
  return `SRID=4326;POINT(${loc.lng} ${loc.lat})`;
}

interface InteractionRow {
  user_id: string;
  kind: InteractionKind;
  spot_place_id?: string;
  event_id?: string;
  day_plan_id?: string;
  query_purpose?: string;
  query_location?: string;
  query_at?: string;
  rank_position?: number;
  score_at_impression?: number;
  score_breakdown?: ScoreBreakdown;
  rating_value?: number;
  override_from_place_id?: string;
  override_to_place_id?: string;
  notes?: string;
  heuristic_version?: string;
  client_app?: string;
  client_version?: string;
}

export function mapToRow(body: LogInteractionRequest, userId: string): InteractionRow {
  const row: InteractionRow = {
    user_id: userId,
    kind: body.kind,
  };
  if (body.spotPlaceId) row.spot_place_id = body.spotPlaceId;
  if (body.eventId) row.event_id = body.eventId;
  if (body.dayPlanId) row.day_plan_id = body.dayPlanId;
  if (body.queryPurpose) row.query_purpose = body.queryPurpose;
  if (body.queryLocation) row.query_location = toWkt(body.queryLocation);
  if (typeof body.rankPosition === 'number') row.rank_position = body.rankPosition;
  if (typeof body.scoreAtImpression === 'number') row.score_at_impression = body.scoreAtImpression;
  if (body.scoreBreakdown) row.score_breakdown = body.scoreBreakdown;
  if (typeof body.ratingValue === 'number') row.rating_value = body.ratingValue;
  if (body.overrideFromPlaceId) row.override_from_place_id = body.overrideFromPlaceId;
  if (body.overrideToPlaceId) row.override_to_place_id = body.overrideToPlaceId;
  if (body.notes) row.notes = body.notes;
  if (body.heuristicVersion) row.heuristic_version = body.heuristicVersion;
  if (body.clientApp) row.client_app = body.clientApp;
  if (body.clientVersion) row.client_version = body.clientVersion;
  return row;
}

// DI seam (same pattern as W4): tests substitute the client factory so they
// can assert what would have been inserted without hitting a live DB.
type MakeClient = (authHeader: string) => SupabaseClient;
function defaultMakeClient(authHeader: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}
let _makeClient: MakeClient = defaultMakeClient;

export function __setMakeClientForTest(fn: MakeClient | undefined): void {
  _makeClient = fn ?? defaultMakeClient;
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Exported so tests can drive the handler directly without going through
// Deno.serve. Returns the Response we'd send to the caller.
export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let body: LogInteractionRequest;
  try {
    body = await req.json() as LogInteractionRequest;
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  if (typeof body?.kind !== 'string') {
    return jsonResponse({ ok: false, error: 'missing_field', field: 'kind' }, 400);
  }

  if (!KNOWN_KINDS.has(body.kind)) {
    console.warn(`log-interaction: unknown_kind="${body.kind}"`);
    return jsonResponse(
      { ok: true, dropped: 'unknown_kind' } satisfies LogInteractionResponse,
      200,
    );
  }

  if (body.queryLocation && !isValidLocation(body.queryLocation)) {
    return jsonResponse(
      { ok: true, dropped: 'invalid_location' } satisfies LogInteractionResponse,
      200,
    );
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = _makeClient(authHeader);

  const insertPromise = (async () => {
    try {
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp?.user) {
        console.error('log-interaction: could not resolve user from JWT', userErr);
        return;
      }
      const row = mapToRow(body, userResp.user.id);
      const { error: insertErr } = await supabase.from('user_interactions').insert(row);
      if (insertErr) {
        console.error('log-interaction: insert failed', insertErr);
      }
    } catch (err) {
      console.error('log-interaction: background insert threw', err);
    }
  })();

  // Fire-and-forget. EdgeRuntime.waitUntil is provided by Supabase's runtime
  // in production. If absent (older local CLI), the promise still runs to
  // completion; only platform metrics differ.
  const rt = (globalThis as {
    EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') {
    rt.waitUntil(insertPromise);
  } else {
    // Tag as handled so Deno doesn't warn about an unhandled rejection.
    insertPromise.catch(() => {});
  }

  return jsonResponse({ ok: true } satisfies LogInteractionResponse, 202);
}

// Guard so tests can import handleRequest without starting the listener.
if (import.meta.main) {
  Deno.serve(handleRequest);
}
