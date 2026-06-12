// Parity test — TS side of the contract enforced by shared/parity-fixture.json.
// The same fixture is read by shared/.../ScoringParityTest.kt (Kotlin side).
// Run: deno test --allow-read supabase/functions/_shared/scoring.parity.test.ts

import { assertAlmostEquals, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { distanceScore, realTimeRelevance, totalScore } from './scoring.ts';
import { heuristicVersion } from '../../../shared/types.ts';

interface Fixture {
  heuristicVersion: string;
  inputs: {
    walkMinutes: number;
    breakdownBase: { consensus: number; recency: number; useCaseFit: number };
    event: {
      startISO: string;
      endISO: string;
      announcedAtISO: string;
      nowISO: string;
      isAtThisVenue: boolean;
      isPurposeAligned: boolean;
    };
  };
  expected: {
    distance: number;
    realTimeRelevance: number;
    totalScore: number;
  };
}

async function loadFixture(): Promise<Fixture> {
  // Resolve relative to this test file so it works regardless of cwd.
  const url = new URL('../../../shared/parity-fixture.json', import.meta.url);
  return JSON.parse(await Deno.readTextFile(url));
}

Deno.test('parity: heuristicVersion constant equals fixture', async () => {
  const fx = await loadFixture();
  assertEquals(heuristicVersion, fx.heuristicVersion);
});

Deno.test('parity: distanceScore matches fixture', async () => {
  const fx = await loadFixture();
  assertEquals(distanceScore(fx.inputs.walkMinutes), fx.expected.distance);
});

Deno.test('parity: realTimeRelevance matches fixture', async () => {
  const fx = await loadFixture();
  const e = fx.inputs.event;
  const rtr = realTimeRelevance(
    e.startISO,
    e.endISO,
    e.announcedAtISO,
    e.nowISO,
    e.isAtThisVenue,
    e.isPurposeAligned,
  );
  assertAlmostEquals(rtr, fx.expected.realTimeRelevance, 1e-9);
});

Deno.test('parity: totalScore (5-signal) matches fixture', async () => {
  const fx = await loadFixture();
  const e = fx.inputs.event;
  const distance = distanceScore(fx.inputs.walkMinutes);
  const rtr = realTimeRelevance(
    e.startISO,
    e.endISO,
    e.announcedAtISO,
    e.nowISO,
    e.isAtThisVenue,
    e.isPurposeAligned,
  );
  const total = totalScore({
    ...fx.inputs.breakdownBase,
    distance,
    realTimeRelevance: rtr,
  });
  assertAlmostEquals(total, fx.expected.totalScore, 1e-9);
});
