// Run: `deno test --allow-env supabase/functions/log-interaction/index.test.ts`
// Substitutes the Supabase client via __setMakeClientForTest — same DI seam
// pattern as W4 (the Supabase JS client uses its own HTTP layer in Deno, so
// globalThis.fetch stubbing has no effect on its internal calls).

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.7';
import { __setMakeClientForTest, handleRequest } from './index.ts';

interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

interface StubResult {
  inserts: CapturedInsert[];
  authHeaders: string[];
}

function withStubClient(opts: { userId: string | null }): StubResult & { restore: () => void } {
  const result: StubResult = { inserts: [], authHeaders: [] };
  const stubClient = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          result.inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
    auth: {
      getUser() {
        if (opts.userId === null) {
          return Promise.resolve({ data: { user: null }, error: { message: 'not_authenticated' } });
        }
        return Promise.resolve({
          data: { user: { id: opts.userId } },
          error: null,
        });
      },
    },
  } as unknown as SupabaseClient;
  __setMakeClientForTest((authHeader) => {
    result.authHeaders.push(authHeader);
    return stubClient;
  });
  return {
    ...result,
    restore: () => __setMakeClientForTest(undefined),
  };
}

function postJson(body: unknown, opts: { auth?: string } = {}): Request {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (opts.auth) headers['Authorization'] = opts.auth;
  return new Request('https://example.test/log-interaction', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// Wait one microtask tick for the fire-and-forget insert to complete in tests.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const VALID_BODY = {
  kind: 'spot_tap',
  spotPlaceId: 'place_123',
  queryPurpose: 'cocktails',
  queryLocation: { lat: 40.7128, lng: -74.0060 },
  rankPosition: 3,
};

// ---------- happy path ----------

Deno.test('valid request returns 202 with {ok:true} and schedules the insert', async () => {
  const stub = withStubClient({ userId: 'user-abc' });
  try {
    const res = await handleRequest(postJson(VALID_BODY, { auth: 'Bearer token-xyz' }));
    assertEquals(res.status, 202);
    const payload = await res.json();
    assertEquals(payload, { ok: true });
    await tick();
    assertEquals(stub.inserts.length, 1);
    assertEquals(stub.inserts[0].table, 'user_interactions');
    assertEquals(stub.inserts[0].row.user_id, 'user-abc');
    assertEquals(stub.inserts[0].row.kind, 'spot_tap');
    assertEquals(stub.inserts[0].row.spot_place_id, 'place_123');
    assertEquals(stub.inserts[0].row.query_purpose, 'cocktails');
    assertEquals(stub.inserts[0].row.rank_position, 3);
    assertEquals(stub.authHeaders[0], 'Bearer token-xyz');
  } finally {
    stub.restore();
  }
});

Deno.test('queryLocation maps to PostGIS WKT', async () => {
  const stub = withStubClient({ userId: 'user-abc' });
  try {
    await handleRequest(postJson(VALID_BODY, { auth: 'Bearer t' }));
    await tick();
    assertEquals(stub.inserts[0].row.query_location, 'SRID=4326;POINT(-74.006 40.7128)');
  } finally {
    stub.restore();
  }
});

// ---------- 400 paths ----------

Deno.test('invalid JSON body returns 400 invalid_json without scheduling insert', async () => {
  const stub = withStubClient({ userId: 'user-abc' });
  try {
    const res = await handleRequest(postJson('this is not valid json{', { auth: 'Bearer t' }));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { ok: false, error: 'invalid_json' });
    await tick();
    assertEquals(stub.inserts.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test('missing kind returns 400 missing_field without scheduling insert', async () => {
  const stub = withStubClient({ userId: 'user-abc' });
  try {
    const res = await handleRequest(postJson({ spotPlaceId: 'p' }, { auth: 'Bearer t' }));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { ok: false, error: 'missing_field', field: 'kind' });
    await tick();
    assertEquals(stub.inserts.length, 0);
  } finally {
    stub.restore();
  }
});

// ---------- 200 dropped paths ----------

Deno.test('unknown kind returns 200 dropped:unknown_kind without scheduling insert', async () => {
  const stub = withStubClient({ userId: 'user-abc' });
  try {
    const res = await handleRequest(postJson(
      { kind: 'spot_quantum_teleport', spotPlaceId: 'p' },
      { auth: 'Bearer t' },
    ));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true, dropped: 'unknown_kind' });
    await tick();
    assertEquals(stub.inserts.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test('out-of-range queryLocation returns 200 dropped:invalid_location', async () => {
  const stub = withStubClient({ userId: 'user-abc' });
  try {
    const res = await handleRequest(postJson(
      { kind: 'spot_tap', queryLocation: { lat: 1000, lng: 0 } },
      { auth: 'Bearer t' },
    ));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true, dropped: 'invalid_location' });
    await tick();
    assertEquals(stub.inserts.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test('NaN coords return 200 dropped:invalid_location', async () => {
  const stub = withStubClient({ userId: 'user-abc' });
  try {
    const res = await handleRequest(postJson(
      { kind: 'spot_tap', queryLocation: { lat: Number.NaN, lng: 0 } },
      { auth: 'Bearer t' },
    ));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true, dropped: 'invalid_location' });
  } finally {
    stub.restore();
  }
});

// ---------- background insert resilience ----------

Deno.test('client returns 202 even when JWT resolution fails (errors stay server-side)', async () => {
  const stub = withStubClient({ userId: null });
  try {
    const res = await handleRequest(postJson(VALID_BODY, { auth: 'Bearer bad-token' }));
    assertEquals(res.status, 202);
    assertEquals(await res.json(), { ok: true });
    await tick();
    // No insert because getUser() returned null; but the client got a successful response.
    assertEquals(stub.inserts.length, 0);
  } finally {
    stub.restore();
  }
});

// ---------- CORS preflight ----------

Deno.test('OPTIONS preflight returns 200 with CORS headers', async () => {
  const req = new Request('https://example.test/log-interaction', { method: 'OPTIONS' });
  const res = await handleRequest(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});
