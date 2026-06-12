// Run: `deno test --allow-env supabase/functions/_shared/claude.test.ts`
// The Anthropic SDK in Deno does not go through globalThis.fetch, so we use the
// __setCallTextForTest seam to inject mocked responses instead of stubbing HTTP.

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ConfigError } from './env.ts';
import {
  __setCallTextForTest,
  extractEvents,
  purposeToAttributes,
  scoreUseCaseFit,
  whyCopy,
} from './claude.ts';
import type { PlacesCandidate } from './places.ts';
import type { ScoreBreakdown } from '../../../shared/types.ts';

function withMockedCallText(
  handler: (operation: string, args: { user: string }) => Promise<string> | string,
): { restore: () => void; lastOp: () => string; lastUser: () => string } {
  let lastOperation = '';
  let lastUser = '';
  __setCallTextForTest(async (operation, args) => {
    lastOperation = operation;
    lastUser = args.user;
    return await handler(operation, args);
  });
  return {
    restore: () => __setCallTextForTest(undefined),
    lastOp: () => lastOperation,
    lastUser: () => lastUser,
  };
}

const CAND = (id: string, name: string): PlacesCandidate => ({
  id,
  name,
  address: `${name} address`,
  location: { lat: 40.71, lng: -74.00 },
});

const BREAKDOWN: ScoreBreakdown = {
  consensus: 1.5,
  recency: 1.2,
  useCaseFit: 0.8,
  distance: 1,
  realTimeRelevance: 0,
};

// ---------- purposeToAttributes ----------

Deno.test('purposeToAttributes returns typed sorted array on valid JSON', async () => {
  const mock = withMockedCallText(() => JSON.stringify([
    { attribute: 'craft cocktails', weight: 0.9 },
    { attribute: 'quiet', weight: 0.3 },
    { attribute: 'outlets', weight: 0.6 },
  ]));
  try {
    const result = await purposeToAttributes('a good place to drink cocktails');
    assertEquals(result.length, 3);
    assertEquals(result[0].attribute, 'craft cocktails');
    assertEquals(result[0].weight, 0.9);
    assertEquals(result[1].attribute, 'outlets');
    assertEquals(result[2].attribute, 'quiet');
    assertEquals(mock.lastOp(), 'purposeToAttributes');
  } finally {
    mock.restore();
  }
});

Deno.test('purposeToAttributes returns [] on malformed JSON', async () => {
  const mock = withMockedCallText(() => 'this is not json at all');
  try {
    const result = await purposeToAttributes('cocktails');
    assertEquals(result, []);
  } finally {
    mock.restore();
  }
});

Deno.test('purposeToAttributes drops invalid items, keeps valid ones', async () => {
  const mock = withMockedCallText(() => JSON.stringify([
    { attribute: 'valid', weight: 0.5 },
    { attribute: 'missing-weight' },
    { attribute: 42, weight: 0.3 },
    { weight: 0.2 },
    { attribute: 'also-valid', weight: 0.7 },
  ]));
  try {
    const result = await purposeToAttributes('purpose');
    assertEquals(result.length, 2);
    assertEquals(result[0].attribute, 'also-valid');
    assertEquals(result[1].attribute, 'valid');
  } finally {
    mock.restore();
  }
});

// ---------- scoreUseCaseFit ----------

Deno.test('scoreUseCaseFit clamps to [0, 1] and covers every candidate', async () => {
  const candidates = [CAND('A', 'Alpha'), CAND('B', 'Beta'), CAND('C', 'Gamma')];
  const mock = withMockedCallText(() => JSON.stringify({
    A: 1.5,    // clamps to 1
    B: -0.3,   // clamps to 0
    C: 0.7,
  }));
  try {
    const result = await scoreUseCaseFit('cocktails', candidates);
    assertEquals(result.size, 3);
    assertEquals(result.get('A'), 1);
    assertEquals(result.get('B'), 0);
    assertEquals(result.get('C'), 0.7);
  } finally {
    mock.restore();
  }
});

Deno.test('scoreUseCaseFit fills missing candidates with 0 fallback', async () => {
  const candidates = [CAND('A', 'Alpha'), CAND('B', 'Beta'), CAND('C', 'Gamma')];
  const mock = withMockedCallText(() => 'not json — Claude responded with prose by mistake');
  try {
    const result = await scoreUseCaseFit('cocktails', candidates);
    assertEquals(result.size, 3);
    assertEquals(result.get('A'), 0);
    assertEquals(result.get('B'), 0);
    assertEquals(result.get('C'), 0);
  } finally {
    mock.restore();
  }
});

Deno.test('scoreUseCaseFit returns empty Map for empty input without calling Claude', async () => {
  let called = false;
  const mock = withMockedCallText(() => { called = true; return '{}'; });
  try {
    const result = await scoreUseCaseFit('cocktails', []);
    assertEquals(result.size, 0);
    assertEquals(called, false);
  } finally {
    mock.restore();
  }
});

Deno.test('scoreUseCaseFit serializes purpose+candidates in stable order', async () => {
  const candidates = [CAND('B', 'Beta'), CAND('A', 'Alpha')];
  const mock = withMockedCallText(() => JSON.stringify({ A: 0.5, B: 0.5 }));
  try {
    await scoreUseCaseFit('cocktails', candidates);
    const userPayload = JSON.parse(mock.lastUser());
    assertEquals(userPayload.purpose, 'cocktails');
    assertEquals(userPayload.candidates.length, 2);
    assertEquals(userPayload.candidates[0].id, 'B');
    assertEquals(userPayload.candidates[1].id, 'A');
  } finally {
    mock.restore();
  }
});

// ---------- whyCopy ----------

Deno.test('whyCopy returns trimmed first line', async () => {
  const mock = withMockedCallText(() =>
    '  Walking distance, Eater 38 mention, craft program.  \nIgnored second line.'
  );
  try {
    const result = await whyCopy('cocktails', CAND('A', 'Alpha'), BREAKDOWN);
    assertEquals(result, 'Walking distance, Eater 38 mention, craft program.');
  } finally {
    mock.restore();
  }
});

Deno.test('whyCopy truncates over-140-char output with ellipsis', async () => {
  const long = 'A'.repeat(200);
  const mock = withMockedCallText(() => long);
  try {
    const result = await whyCopy('cocktails', CAND('A', 'Alpha'), BREAKDOWN);
    assertEquals(result.length, 140);
    assertEquals(result.endsWith('…'), true);
    assertEquals(result.slice(0, 139), 'A'.repeat(139));
  } finally {
    mock.restore();
  }
});

Deno.test('whyCopy returns empty string when response has no text', async () => {
  const mock = withMockedCallText(() => '');
  try {
    const result = await whyCopy('cocktails', CAND('A', 'Alpha'), BREAKDOWN);
    assertEquals(result, '');
  } finally {
    mock.restore();
  }
});

// ---------- extractEvents ----------

Deno.test('extractEvents drops invalid items, keeps valid Events', async () => {
  const valid = {
    id: 'ev-1',
    title: 'Knicks Watch Party',
    startISO: '2026-06-15T19:00:00-04:00',
    announcedAtISO: '2026-06-12T10:00:00-04:00',
  };
  const valid2 = {
    id: 'ev-2',
    title: 'Pop-up',
    startISO: '2026-06-13T20:00:00-04:00',
    announcedAtISO: '2026-06-12T09:00:00-04:00',
  };
  const invalid = { id: 'ev-bad', title: 'No start' };
  const mock = withMockedCallText(() => JSON.stringify([valid, invalid, valid2]));
  try {
    const result = await extractEvents('source text');
    assertEquals(result.length, 2);
    assertEquals(result[0].id, 'ev-1');
    assertEquals(result[1].id, 'ev-2');
  } finally {
    mock.restore();
  }
});

Deno.test('extractEvents returns [] on whole-response failure', async () => {
  const mock = withMockedCallText(() => 'completely not json');
  try {
    const result = await extractEvents('source text');
    assertEquals(result, []);
  } finally {
    mock.restore();
  }
});

// ---------- ConfigError ----------
// The fixture/replay path is bypassed by the test seam, so the only way to
// verify ConfigError behavior is to exercise the real defaultCallText with an
// unset env var. This test doesn't override callText.

Deno.test('purposeToAttributes throws ConfigError when ANTHROPIC_API_KEY is unset', async () => {
  __setCallTextForTest(undefined);
  Deno.env.delete('ANTHROPIC_API_KEY');
  await assertRejects(() => purposeToAttributes('anything'), ConfigError);
});
