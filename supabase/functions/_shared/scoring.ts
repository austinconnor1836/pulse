// Deterministic scoring helpers. Pure functions — no I/O, no LLM calls.
// Implements the find-spots 4-signal heuristic in code form. Source-of-truth spec:
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md

import type { ScoreBreakdown } from '../../../shared/types.ts';

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
  return b.consensus + b.recency + b.useCaseFit + b.distance;
}

// Used by plan-day: re-weights use-case-fit per the optimization target.
// Spec lives in plan-day SKILL.md "Optimization targets" table.
export function applyOptimizationWeights(
  b: ScoreBreakdown,
  target: 'balanced' | 'novelty' | 'meet-people' | 'enjoyment' | 'recovery'
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
