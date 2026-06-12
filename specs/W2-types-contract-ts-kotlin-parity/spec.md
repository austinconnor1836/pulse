# W2 — TS ↔ Kotlin types + scoring contract

**Branch:** `w2-types-contract-ts-kotlin-parity` · **Area:** shared · **DependsOn:** —
**Status:** specify

## Problem
The Edge Functions and the mobile clients must agree on wire types and on the deterministic
5-signal scoring math. Kotlin (`shared/src/.../Types.kt` + `Scoring.kt`) is the source of truth
today, but the Deno functions need a TypeScript mirror. The `find-spots` and `plan-day` stubs
already `import … from '../../../shared/types.ts'` — **a file that does not exist** — so those
imports are currently broken. This item creates the TS types + scoring mirror and proves parity.

## Exploration findings
- `find-spots/index.ts:26` and `plan-day/index.ts:24` both import `'../../../shared/types.ts'`,
  which resolves to **repo-root `shared/types.ts`** (the KMP module dir), NOT
  `supabase/functions/shared/types.ts`. That file is **absent** today.
- `supabase/functions/_shared/scoring.ts` **already exists** (the TS scoring helper find-spots
  imports from `../_shared/scoring.ts`). W2 must make it mirror `Scoring.kt` exactly (verify, fix
  drift) — not create it from scratch.
- Kotlin types use `@Serializable` + `@SerialName("lightweight")` for enum wire values — the TS
  mirror must use those exact string literals.

## ⚠️ Backbone correction
The backbone AC for W2 said create `supabase/functions/shared/types.ts`. Exploration shows the
existing imports point at **repo-root `shared/types.ts`**. The spec below targets the path the
code actually imports (decision D1 below). The backbone AC will be reconciled to match.

## Acceptance Criteria Coverage Map
| # | AC fragment (verbatim) | Type | Disposition |
|---|------------------------|------|-------------|
| 1 | "`shared/types.ts` exists and is the canonical TypeScript mirror of `Types.kt` (FindSpotsRequest/Response, ScoredSpot, ScoreBreakdown, Event, OptimizationTarget, PlanDayResponse, LogInteractionRequest, et al)" | Backend | **Demonstrated** — file exists; the two broken imports resolve; `deno check` on find-spots/plan-day passes |
| 2 | "the find-spots stub already imports `../../../shared/types.ts` — that import must resolve" | Backend | **Demonstrated** — `deno check supabase/functions/find-spots/index.ts` succeeds |
| 3 | "`_shared/scoring.ts` mirrors `Scoring.kt` deterministically: identical 5-signal math … for the same inputs" | Backend | **Demonstrated** — parity fixture (below) |
| 4 | "A parity check … demonstrates one shared input produces the same ScoreBreakdown in Kotlin and TS" | Convention | **Demonstrated** — a committed fixture + a tiny runner (Deno test + Kotlin test, or a documented golden JSON) showing equal breakdowns |
| 5 | "A heuristicVersion constant exists in both and matches" | Convention | **Demonstrated** — `heuristicVersion` in `types.ts`/`scoring.ts` equals the Kotlin constant |

## Decisions to confirm (the one real fork)
- **D1 — where the canonical TS types file lives.**
  - **(A, recommended) Repo-root `shared/types.ts`** — matches the existing imports verbatim
    (zero import churn), colocates the TS mirror beside the Kotlin source-of-truth under
    `shared/`. Signals "the `shared/` module owns the contract in both languages."
  - (B) Move to `supabase/functions/_shared/types.ts` and rewrite the two imports — groups all
    Deno-shared code under `_shared/`, but diverges from the source-of-truth colocation and
    touches the function files.
  → Proceeding with **(A)** unless overridden.

## Requirements
- **R1 (→1,2):** Create `shared/types.ts` mirroring every type in `Types.kt`, with enum string
  literals matching `@SerialName`. `deno check` on find-spots + plan-day passes.
- **R2 (→3):** Audit `_shared/scoring.ts` against `Scoring.kt`; fix any drift so the 5-signal math
  (consensus, recency, useCaseFit, distance, realTimeRelevance incl. decay) is identical.
- **R3 (→4):** Commit a parity fixture (one canonical input) + a check proving equal
  `ScoreBreakdown` from Kotlin and TS.
- **R4 (→5):** Add a matching `heuristicVersion` constant in both languages.

## Resolved Questions
- *Does `_shared/scoring.ts` exist?* → Yes; this item verifies parity, not greenfield creation.
- *Where do TS types import from?* → repo-root `shared/types.ts` (D1-A).

## Open product/UX questions
- None — D1 is an internal structure choice with a clear recommendation.

## Out of scope
- The KMP XCFramework packaging for iOS (that's W15). W2 only establishes the type/scoring
  contract; W15 ships it as a binary framework.
