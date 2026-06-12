// Run: `deno test --allow-env supabase/functions/_shared/events.test.ts`

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.7';
import {
  EventsQueryError,
  eventToRow,
  nearbyEvents,
  rowToEvent,
  upsertEvents,
} from './events.ts';
import type { Event } from '../../../shared/types.ts';

interface RpcCall { name: string; args: Record<string, unknown> }
interface UpsertCall { table: string; rows: unknown[]; opts?: Record<string, unknown> }

interface StubResult {
  rpcCalls: RpcCall[];
  upsertCalls: UpsertCall[];
}

function makeStub(opts: {
  rpcData?: unknown[];
  rpcError?: { code?: string; message?: string };
  upsertError?: { code?: string; message?: string };
}): { client: SupabaseClient; calls: StubResult } {
  const calls: StubResult = { rpcCalls: [], upsertCalls: [] };
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.rpcCalls.push({ name, args });
      return Promise.resolve({
        data: opts.rpcError ? null : (opts.rpcData ?? []),
        error: opts.rpcError ?? null,
      });
    },
    from(table: string) {
      return {
        upsert(rows: unknown[], upsertOpts?: Record<string, unknown>) {
          calls.upsertCalls.push({ table, rows, opts: upsertOpts });
          return Promise.resolve({
            data: null,
            error: opts.upsertError ?? null,
          });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ORIGIN = { lat: 40.7128, lng: -74.0060 };

const NEARBY_ROW = {
  id: 'ev-1',
  canonical_key: 'gothamist-2026-06-15-msg-watch-party',
  title: 'Knicks Watch Party at MSG',
  description: 'Free outdoor watch party',
  start_at: '2026-06-15T19:00:00Z',
  end_at: '2026-06-15T23:00:00Z',
  announced_at: '2026-06-12T10:00:00Z',
  ingested_at: '2026-06-12T10:05:00Z',
  venue_name: 'Madison Square Garden',
  venue_place_id: 'place_msg',
  lat: 40.7505,
  lng: -73.9934,
  tags: ['watch-party', 'free', 'outdoor'],
  sources: ['news'],
  source_urls: ['https://gothamist.com/...'],
  confidence: 'confirmed',
  cost: 'free',
  supersedes_id: null,
};

// ---------- nearbyEvents ----------

Deno.test('nearbyEvents calls RPC with mapped params and returns typed Event[]', async () => {
  const { client, calls } = makeStub({ rpcData: [NEARBY_ROW] });
  const result = await nearbyEvents(client, ORIGIN, 5000, {
    startISO: '2026-06-12T00:00:00Z',
    endISO: '2026-06-16T00:00:00Z',
  });

  assertEquals(calls.rpcCalls.length, 1);
  assertEquals(calls.rpcCalls[0].name, 'nearby_events');
  assertEquals(calls.rpcCalls[0].args, {
    origin_lat: 40.7128,
    origin_lng: -74.0060,
    radius_m: 5000,
    when_start: '2026-06-12T00:00:00Z',
    when_end: '2026-06-16T00:00:00Z',
    max_results: 50,
  });

  assertEquals(result.length, 1);
  assertEquals(result[0].id, 'ev-1');
  assertEquals(result[0].title, 'Knicks Watch Party at MSG');
  assertEquals(result[0].location, { lat: 40.7505, lng: -73.9934 });
  assertEquals(result[0].tags, ['watch-party', 'free', 'outdoor']);
  assertEquals(result[0].sources, ['news']);
  assertEquals(result[0].confidence, 'confirmed');
  assertEquals(result[0].venueName, 'Madison Square Garden');
});

Deno.test('nearbyEvents uses default time window when both bounds omitted', async () => {
  const { client, calls } = makeStub({ rpcData: [] });
  await nearbyEvents(client, ORIGIN, 1000);
  assertEquals(calls.rpcCalls.length, 1);
  const args = calls.rpcCalls[0].args as { when_start: string; when_end: string };
  const start = new Date(args.when_start).getTime();
  const end = new Date(args.when_end).getTime();
  const nowMs = Date.now();
  // when_start ≈ now (within 1s)
  if (Math.abs(start - nowMs) > 1000) {
    throw new Error(`when_start=${args.when_start} not ≈ now`);
  }
  // when_end ≈ now + 24h (within 1s)
  if (Math.abs(end - (nowMs + 24 * 60 * 60 * 1000)) > 1000) {
    throw new Error(`when_end=${args.when_end} not ≈ now+24h`);
  }
});

Deno.test('nearbyEvents returns [] on zero results', async () => {
  const { client } = makeStub({ rpcData: [] });
  const result = await nearbyEvents(client, ORIGIN, 1000);
  assertEquals(result, []);
});

Deno.test('nearbyEvents throws EventsQueryError on RPC error', async () => {
  const { client } = makeStub({
    rpcError: { code: 'PGRST116', message: 'permission denied' },
  });
  await assertRejects(
    () => nearbyEvents(client, ORIGIN, 1000),
    EventsQueryError,
    'Events nearbyEvents failed (PGRST116)',
  );
});

Deno.test('rowToEvent drops unknown sources and invalid confidence', async () => {
  const event = rowToEvent({
    ...NEARBY_ROW,
    sources: ['news', 'mystery_source', 'reddit'],
    confidence: 'bogus',
  });
  assertEquals(event.sources, ['news', 'reddit']);
  // Invalid confidence is omitted entirely (not coerced to a default)
  assertEquals(event.confidence, undefined);
});

// ---------- upsertEvents ----------

const VALID_EVENT: Event = {
  id: 'gothamist-2026-06-15-msg',
  title: 'Knicks WP',
  startISO: '2026-06-15T19:00:00Z',
  announcedAtISO: '2026-06-12T10:00:00Z',
  venueName: 'MSG',
  location: { lat: 40.7505, lng: -73.9934 },
  tags: ['watch-party'],
  sources: ['news'],
  sourceUrls: ['https://gothamist.com/...'],
  confidence: 'confirmed',
};

Deno.test('upsertEvents returns zero counts and skips client call on empty input', async () => {
  const { client, calls } = makeStub({});
  const result = await upsertEvents(client, []);
  assertEquals(result, { upserted: 0, errors: 0 });
  assertEquals(calls.upsertCalls.length, 0);
});

Deno.test('upsertEvents maps events to rows and calls upsert with onConflict', async () => {
  const { client, calls } = makeStub({});
  const result = await upsertEvents(client, [VALID_EVENT, VALID_EVENT]);
  assertEquals(result, { upserted: 2, errors: 0 });
  assertEquals(calls.upsertCalls.length, 1);
  assertEquals(calls.upsertCalls[0].table, 'events');
  assertEquals(calls.upsertCalls[0].opts, {
    onConflict: 'canonical_key',
    ignoreDuplicates: false,
  });
  assertEquals(calls.upsertCalls[0].rows.length, 2);
  const firstRow = calls.upsertCalls[0].rows[0] as Record<string, unknown>;
  assertEquals(firstRow.canonical_key, 'gothamist-2026-06-15-msg');
  assertEquals(firstRow.title, 'Knicks WP');
  assertEquals(firstRow.geo, 'SRID=4326;POINT(-73.9934 40.7505)');
  assertEquals(firstRow.tags, ['watch-party']);
  assertEquals(firstRow.confidence, 'confirmed');
});

Deno.test('upsertEvents returns errors-count on Supabase failure (no throw)', async () => {
  const { client } = makeStub({
    upsertError: { code: '23505', message: 'unique violation' },
  });
  const result = await upsertEvents(client, [VALID_EVENT, VALID_EVENT, VALID_EVENT]);
  assertEquals(result, { upserted: 0, errors: 3 });
});

Deno.test('eventToRow defaults arrays + confidence when fields omitted', () => {
  const sparse: Event = {
    id: 'ev-sparse',
    title: 'Sparse',
    startISO: '2026-06-15T19:00:00Z',
    announcedAtISO: '2026-06-12T10:00:00Z',
  };
  const row = eventToRow(sparse);
  assertEquals(row.tags, []);
  assertEquals(row.sources, []);
  assertEquals(row.source_urls, []);
  assertEquals(row.confidence, 'likely');
  assertEquals('geo' in row, false);
  assertEquals('end_at' in row, false);
});
