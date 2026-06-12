# W9 — Plan

**Branch:** `w9-log-interaction` · **Builds on:** `spec.md`

The spec is detailed enough that this plan is a short execution map. All design
decisions (D1–D6) are settled in the spec.

## Approach
Two commits, in order. Helper-extension first because every other file imports it.

### Commit A — Extend W1 env helper with anon key
- `_shared/env.ts`: add `supabaseAnonKey` getter for `SUPABASE_ANON_KEY` (required).
- `_shared/env.test.ts`: add one test asserting the new getter throws when unset.
- `supabase/.env.example`: add `SUPABASE_ANON_KEY=` under the "Required for MVP"
  header (which already documents the var class).

### Commit B — log-interaction implementation + tests
- `supabase/functions/log-interaction/index.ts`: replace the stub. Structure:
  ```ts
  import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
  import { config } from '../_shared/env.ts';
  import { corsHeaders } from '../_shared/cors.ts';
  import type {
    InteractionKind, LogInteractionRequest, LogInteractionResponse,
  } from '../../../shared/types.ts';

  const KNOWN_KINDS: ReadonlySet<InteractionKind> = new Set([
    'spot_impression', 'spot_tap', 'spot_save', 'spot_directions', 'spot_share',
    'plan_view', 'plan_slot_view', 'plan_save',
    'spot_visit_confirmed', 'spot_rating', 'spot_thumbs_up', 'spot_thumbs_down',
    'plan_slot_override', 'plan_target_change',
    're_query_same_purpose',
  ]);

  function isValidLocation(loc): boolean { /* finite, |lat|<=90, |lng|<=180 */ }
  function toWkt(loc): string { return `SRID=4326;POINT(${loc.lng} ${loc.lat})`; }
  function mapToRow(body, userId): Record<string, unknown> { /* W2 → snake_case cols */ }

  // DI seam (same pattern as W4):
  let _makeClient = (authHeader: string) => createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  export function __setMakeClientForTest(fn: typeof _makeClient | undefined): void { ... }

  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    let body: LogInteractionRequest;
    try { body = await req.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }
    if (typeof body?.kind !== 'string') {
      return json({ ok: false, error: 'missing_field', field: 'kind' }, 400);
    }
    if (!KNOWN_KINDS.has(body.kind as InteractionKind)) {
      console.warn(`log-interaction: unknown_kind ${body.kind}`);
      return json({ ok: true, dropped: 'unknown_kind' }, 200);
    }
    if (body.queryLocation && !isValidLocation(body.queryLocation)) {
      return json({ ok: true, dropped: 'invalid_location' }, 200);
    }

    const auth = req.headers.get('Authorization') ?? '';
    const supabase = _makeClient(auth);
    const insertPromise = (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      if (!userResp?.user) { console.error('log-interaction: no user from JWT'); return; }
      const row = mapToRow(body, userResp.user.id);
      const { error } = await supabase.from('user_interactions').insert(row);
      if (error) console.error('log-interaction: insert failed', error);
    })();

    // Fire-and-forget (D3). EdgeRuntime is available in Supabase Edge Functions; in
    // tests without it, we just await — the test seam returns immediately anyway.
    const rt = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt) rt.waitUntil(insertPromise);
    else void insertPromise; // local dev (`supabase functions serve` w/o the runtime)
    return json({ ok: true } satisfies LogInteractionResponse, 202);
  });
  ```
- `supabase/functions/log-interaction/index.test.ts`: 7 cases via the DI seam:
  1. **Valid happy path** → 202 + `{ok: true}` + insert called with mapped row.
  2. **Invalid JSON body** → 400 `{error: "invalid_json"}` + no insert.
  3. **Missing `kind`** → 400 `{error: "missing_field", field: "kind"}` + no insert.
  4. **Unknown `kind`** → 200 `{ok: true, dropped: "unknown_kind"}` + no insert.
  5. **Invalid `queryLocation`** (NaN, out-of-range) → 200 `{ok: true, dropped: "invalid_location"}` + no insert.
  6. **`queryLocation` mapped to WKT** → insert row contains
     `query_location: "SRID=4326;POINT(-74.00 40.71)"`.
  7. **OPTIONS preflight** → 200 with CORS headers.
- Tests import the handler by calling its internal request-processing function. Simplest:
  expose a `handleRequest(req): Promise<Response>` and have `Deno.serve` call it. Tests
  call `handleRequest` directly with mocked Supabase client.

## Files touched

| Path | Action |
|------|--------|
| `supabase/functions/_shared/env.ts` | edit (add `supabaseAnonKey` getter) |
| `supabase/functions/_shared/env.test.ts` | edit (add one test for the new getter) |
| `supabase/.env.example` | edit (add `SUPABASE_ANON_KEY=`) |
| `supabase/functions/log-interaction/index.ts` | rewrite (replace stub) |
| `supabase/functions/log-interaction/index.test.ts` | create |

## Constitution Check

| # | Principle | Status |
|---|-----------|--------|
| I | **Vertical slice.** | ✓ One concern — log-interaction wired end-to-end. The env-helper extension is a 3-line additive change required by the slice. |
| II | **Convention before invention.** | ✓ Supabase client via `npm:@supabase/supabase-js@2` (mirrors W4's npm import). DI seam pattern mirrors W4. Validation-order pattern mirrors stub's "fast + forgiving" philosophy. |
| III | **AC are the contract.** | ✓ Every Coverage Map fragment maps to a Requirement; D1's 400-vs-drop reconciliation cited explicitly. |
| IV | **Fail loud at boundaries.** | ✓ Malformed JSON / missing kind → 400 with typed error. Background insert errors → `console.error`. RLS rejection (wrong user) → DB error logged, client never sees it (correct for fire-and-forget). |
| V | **No speculative scope.** | ✓ No batch endpoint, no rollup job, no per-user weight reads. Only the single-event write. |
| VI | **No duplication of working code.** | ✓ Reuses `cors.ts` + `env.ts` + W2 types. WKT conversion is one helper. |
| VII | **Errors are typed.** | ✓ Response shape matches W2's `LogInteractionResponse`; error responses carry `error: string` + optional `field`. |
| VIII | **No commented-out code.** | ✓ Stub deleted, replaced wholesale. |
| IX | **Tests where they catch real bugs.** | ✓ 7 cases each test a real failure mode (parse, missing field, unknown enum, geo bounds, mapping). Background-insert dispatch is verified via a captured `insertPromise`. |
| X | **Isolate classes of change.** | ✓ Two commits: env extension first, then the slice itself. |
| XI | **No speculative version bumps.** | n/a. |

## Risks
- **`EdgeRuntime.waitUntil` availability.** Supabase Edge Functions provide it in
  production; local `supabase functions serve` may or may not (varies by CLI version).
  Fallback: `void insertPromise` — the request still returns 202 fast, the insert still
  runs to completion (Deno doesn't kill in-flight promises), it just isn't formally
  "tracked." Behavior identical to the user; only the platform's metrics differ.
- **Supabase JS client npm import surface area.** Same risk class as W4's SDK import.
  Mitigated by the same npm-specifier pattern that worked there.
- **The W2 `LogInteractionRequest.kind` is the W2-canonical name, but the Kotlin
  `@SerialName` values are snake_case** (e.g. `spot_impression`). TS union literal strings
  match these exactly (verified in `shared/types.ts:237-251`). No mismatch.

## Next phase
Implement (no separate `tasks.md` — the structure above is the task list). Auto gates,
then publish.
