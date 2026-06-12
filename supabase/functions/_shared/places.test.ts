// Run: `deno test --allow-env supabase/functions/_shared/places.test.ts`
// Every test stubs globalThis.fetch — no live network.

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ConfigError } from './env.ts';
import {
  distanceMatrix,
  type PlacesCandidate,
  PlacesError,
  textSearch,
} from './places.ts';

function withMockedFetch(
  handler: (call: number, req: Request) => Promise<Response>,
): { restore: () => void; calls: () => number } {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    count++;
    const req = new Request(
      typeof input === 'string' || input instanceof URL ? input.toString() : input,
      init,
    );
    return handler(count, req);
  };
  return { restore: () => { globalThis.fetch = original; }, calls: () => count };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setKey(): void {
  Deno.env.set('GOOGLE_PLACES_API_KEY', 'test-key-123');
}

function clearKey(): void {
  Deno.env.delete('GOOGLE_PLACES_API_KEY');
}

const ORIGIN = { lat: 40.7128, lng: -74.0060 };

// ---------- textSearch shape ----------

Deno.test('textSearch returns PlacesCandidate with all 6 AC-named fields', async () => {
  setKey();
  const todayIdx = (new Date().getDay() + 6) % 7;
  const weekdays = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];
  const mock = withMockedFetch(async () =>
    jsonResponse({
      places: [
        {
          id: 'PLACE_A',
          displayName: { text: 'Test Bar' },
          formattedAddress: '123 Test St, NY',
          location: { latitude: 40.71, longitude: -74.00 },
          rating: 4.5,
          regularOpeningHours: { weekdayDescriptions: weekdays },
        },
      ],
    })
  );
  try {
    const result = await textSearch('cocktails near me', ORIGIN);
    assertEquals(result.length, 1);
    assertEquals(result[0].id, 'PLACE_A');
    assertEquals(result[0].name, 'Test Bar');
    assertEquals(result[0].address, '123 Test St, NY');
    assertEquals(result[0].location, { lat: 40.71, lng: -74.00 });
    assertEquals(result[0].rating, 4.5);
    assertEquals(result[0].hoursToday, weekdays[todayIdx]);
  } finally {
    mock.restore();
    clearKey();
  }
});

Deno.test('textSearch leaves rating/hoursToday undefined when Google omits them', async () => {
  setKey();
  const mock = withMockedFetch(async () =>
    jsonResponse({
      places: [
        {
          id: 'PLACE_B',
          displayName: { text: 'Sparse Cafe' },
          formattedAddress: '456 Sparse Rd',
          location: { latitude: 40.72, longitude: -74.01 },
        },
      ],
    })
  );
  try {
    const result = await textSearch('coffee', ORIGIN);
    assertEquals(result[0].rating, undefined);
    assertEquals(result[0].hoursToday, undefined);
    assertEquals(result[0].name, 'Sparse Cafe');
  } finally {
    mock.restore();
    clearKey();
  }
});

Deno.test('textSearch throws ConfigError when GOOGLE_PLACES_API_KEY is unset', async () => {
  clearKey();
  await assertRejects(() => textSearch('anything', ORIGIN), ConfigError);
});

// ---------- textSearch pagination ----------

function pageOfPlaces(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${i}`,
    displayName: { text: `${prefix} ${i}` },
    formattedAddress: 'addr',
    location: { latitude: 40 + i / 1000, longitude: -74 + i / 1000 },
  }));
}

Deno.test('textSearch paginates via nextPageToken and caps at 60', async () => {
  setKey();
  const responses = [
    { places: pageOfPlaces('p1', 20), nextPageToken: 'tok-2' },
    { places: pageOfPlaces('p2', 20), nextPageToken: 'tok-3' },
    { places: pageOfPlaces('p3', 20) },
  ];
  const mock = withMockedFetch(async (call) => jsonResponse(responses[call - 1]));
  try {
    const result = await textSearch('bars', ORIGIN);
    assertEquals(result.length, 60);
    assertEquals(result[0].id, 'p1_0');
    assertEquals(result[59].id, 'p3_19');
    assertEquals(mock.calls(), 3);
  } finally {
    mock.restore();
    clearKey();
  }
});

// ---------- fetchJson retry ----------

Deno.test('textSearch retries once on 429 and returns the successful body', async () => {
  setKey();
  const mock = withMockedFetch(async (call) =>
    call === 1
      ? new Response('rate-limited', { status: 429 })
      : jsonResponse({ places: pageOfPlaces('ok', 3) })
  );
  try {
    const result = await textSearch('bars', ORIGIN, { backoffMs: [1, 1] });
    assertEquals(result.length, 3);
    assertEquals(mock.calls(), 2);
  } finally {
    mock.restore();
    clearKey();
  }
});

Deno.test('textSearch throws PlacesError after exhausting retries', async () => {
  setKey();
  const mock = withMockedFetch(async () =>
    new Response('still rate-limited', { status: 429 })
  );
  try {
    await assertRejects(
      () => textSearch('bars', ORIGIN, { backoffMs: [1] }),
      PlacesError,
      'Places textSearch failed (429)',
    );
    // 1 initial + 1 retry = 2 calls
    assertEquals(mock.calls(), 2);
  } finally {
    mock.restore();
    clearKey();
  }
});

// ---------- distanceMatrix ----------

function distanceRow(elements: Array<{ status: string; durationSec?: number }>): unknown {
  return {
    rows: [
      {
        elements: elements.map((e) => ({
          status: e.status,
          duration: e.durationSec !== undefined ? { value: e.durationSec, text: '' } : undefined,
        })),
      },
    ],
  };
}

function makeCandidates(n: number): PlacesCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `C_${i}`,
    name: `Cand ${i}`,
    address: 'addr',
    location: { lat: 40 + i / 10000, lng: -74 + i / 10000 },
  }));
}

Deno.test('distanceMatrix batches at 25 and merges results across calls', async () => {
  setKey();
  const cands = makeCandidates(27);
  const mock = withMockedFetch(async (call) => {
    // Call 1: 25 destinations all OK at 600s. Call 2: 2 destinations OK at 300s.
    const n = call === 1 ? 25 : 2;
    return jsonResponse(
      distanceRow(Array.from({ length: n }, () => ({ status: 'OK', durationSec: 600 }))),
    );
  });
  try {
    const result = await distanceMatrix(ORIGIN, cands);
    assertEquals(result.size, 27);
    assertEquals(mock.calls(), 2);
    assertEquals(result.get('C_0'), 10);
    assertEquals(result.get('C_26'), 10);
  } finally {
    mock.restore();
    clearKey();
  }
});

Deno.test('distanceMatrix omits non-OK elements from the result Map', async () => {
  setKey();
  const cands = makeCandidates(3);
  const mock = withMockedFetch(async () =>
    jsonResponse(
      distanceRow([
        { status: 'OK', durationSec: 600 },          // 10 min
        { status: 'ZERO_RESULTS' },                   // dropped
        { status: 'OK', durationSec: 300 },          // 5 min
      ]),
    )
  );
  try {
    const result = await distanceMatrix(ORIGIN, cands);
    assertEquals(result.size, 2);
    assertEquals(result.get('C_0'), 10);
    assertEquals(result.has('C_1'), false);
    assertEquals(result.get('C_2'), 5);
    assertEquals(mock.calls(), 1);
  } finally {
    mock.restore();
    clearKey();
  }
});
