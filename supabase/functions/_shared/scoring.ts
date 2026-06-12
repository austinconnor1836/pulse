// Deterministic scoring helpers. Pure functions — no I/O, no LLM calls.
// Implements the find-spots 5-signal heuristic in code form. Source-of-truth spec:
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md
//
// Mirrors shared/src/commonMain/kotlin/com/austinconnor/pulse/shared/Scoring.kt 1:1.
// Parity is enforced by shared/parity-fixture.json + scoring.parity.test.ts (TS)
// and ScoringParityTest.kt (Kotlin).

import type { OptimizationTarget, ScoreBreakdown } from '../../../shared/types.ts';

export function distanceScore(walkMinutes: number): number {
  if (walkMinutes <= 10) return 2;
  if (walkMinutes <= 18) return 1;
  if (walkMinutes <= 25) return 0;
  return -1; // hard filter: caller drops these
}

export function tierFor(walkMinutes: number): 1 | 2 | 3 {
  if (walkMinutes <= 5) return 1;
  if (walkMinutes <= 15) return 2;
  return 3;
}

export function totalScore(b: ScoreBreakdown): number {
  return b.consensus + b.recency + b.useCaseFit + b.distance + (b.realTimeRelevance ?? 0);
}

/**
 * Real-time event signal. Time-decays from +3 to 0 as the event passes.
 *
 * Logic mirrors find-spots SKILL.md "Real-time event signal":
 *   +3 if the event matches purpose AND is at this venue
 *   +1 if purpose-aligned at a nearby spillover venue
 *   +2 bump (×0.5 weight = +1) if announced within the last 24h
 *   capped at 3.0 so it can't dominate the other four combined
 *   decays to 0 after the event ends
 */
export function realTimeRelevance(
  eventStartISO: string,
  eventEndISO: string | null,
  announcedAtISO: string,
  nowISO: string,
  isAtThisVenue: boolean,
  isPurposeAligned: boolean,
): number {
  const now = epochSeconds(nowISO);
  const start = epochSeconds(eventStartISO);
  const end = eventEndISO ? epochSeconds(eventEndISO) : start;
  if (now > end) return 0;
  const announced = epochSeconds(announcedAtISO);
  const hoursSinceAnnounced = (now - announced) / 3600;
  const breakingBump = hoursSinceAnnounced <= 24 ? 2 : 0;
  const base = isAtThisVenue && isPurposeAligned
    ? 3
    : !isAtThisVenue && isPurposeAligned
    ? 1
    : 0;
  return Math.min(3, base + breakingBump * 0.5);
}

function epochSeconds(iso: string): number {
  return new Date(iso).getTime() / 1000;
}

// Used by plan-day: re-weights use-case-fit per the optimization target.
// Spec lives in plan-day SKILL.md "Optimization targets" table.
export function applyOptimizationWeights(
  b: ScoreBreakdown,
  target: OptimizationTarget,
): ScoreBreakdown {
  if (target === 'balanced') return b;
  const out = { ...b };
  switch (target) {
    case 'meet-people':
      out.useCaseFit = b.useCaseFit * 1.4;
      break;
    case 'novelty':
      out.recency = b.recency * 1.5;
      break;
    case 'enjoyment':
      out.consensus = b.consensus * 1.3;
      out.useCaseFit = b.useCaseFit * 1.2;
      break;
    case 'recovery':
      out.useCaseFit = b.useCaseFit * 1.3;
      out.distance = b.distance * 1.3;
      break;
  }
  return out;
}
