# W2 — Plan

**Branch:** `w2-types-contract-ts-kotlin-parity` · **Builds on:** `spec.md`

## Pre-plan reconciliation

Re-exploration before planning surfaced three sharper constraints not yet in `spec.md`:

1. **Real parity drift in `_shared/scoring.ts`** (R2 is non-cosmetic):
   - Header line 2 says "4-signal heuristic" — Kotlin is 5-signal (`Scoring.kt:5`).
   - `totalScore()` (scoring.ts:21) sums 4 signals; Kotlin (`Scoring.kt:27`) sums 5 including
     `realTimeRelevance`.
   - The `realTimeRelevance(...)` function is **missing entirely** from TS.
     `Scoring.kt:38-60` is the source-of-truth: base 3/1/0 by venue+purpose alignment, +2
     bump if announced within 24h (×0.5 weight), capped at 3.0, decays to 0 after `endISO`.
2. **24 type declarations to mirror** in `shared/types.ts` (see Types.kt:1-277): 1 location +
   3 find-spots types + 1 enum + score breakdown + scored spot + 3 event enums/types + 3
   feed types + 3 plan-day enums + 6 plan-day data classes + 1 interaction enum + 2
   interaction types.
3. **`heuristicVersion` does not exist yet in either language.** `docs/architecture.md` §
   lockstep names the constant ("Bump a `heuristicVersion` constant so cached results from
   older versions can be invalidated") but no code defines it. W2 introduces it.

## Approach
Four changes, ordered build-then-prove.

### Change 1 — Create `shared/types.ts` (R1)
Repo-root path matches the existing imports verbatim (D1-A; settled by spec). Mirror every
Kotlin type with:

- **Enums → string-literal union types** (TS) matching `@SerialName` values verbatim. Example:
  `export type OptimizationTarget = 'balanced' | 'novelty' | 'meet-people' | 'enjoyment' | 'recovery';`
- **`@Serializable data class` → TS `interface`** with the same field names, optional fields
  as `field?: T`, defaulted lists as `field?: T[]`. Field-name casing stays camelCase
  (already Kotlin's convention).
- **`ScoreBreakdown.realTimeRelevance: Double = 0.0`** → `realTimeRelevance?: number;`
  (matches the default-value semantics).
- **`heuristicVersion: string`** constant exported here (R4 — see Change 4).

The 24 declarations get one file with the same grouping headers as Types.kt (`// ---------- Common ----------`, etc.) to keep the visual mapping 1:1.

### Change 2 — Fix `_shared/scoring.ts` to mirror Scoring.kt (R2)
Three edits:

1. Update header: "4-signal" → "5-signal".
2. Update `totalScore()` to include `b.realTimeRelevance ?? 0` (handles the optional default).
3. Add `realTimeRelevance(...)` mirroring `Scoring.kt:38-60` exactly:
   - Same params: `eventStartISO`, `eventEndISO`, `announcedAtISO`, `nowISO`,
     `isAtThisVenue`, `isPurposeAligned`.
   - Same logic: if `now > end` → 0; `hoursSinceAnnounced = (now - announced) / 3600`;
     `breakingBump = hours ≤ 24 ? 2 : 0`; base by venue+purpose: 3 / 1 / 0;
     return `Math.min(3, base + breakingBump * 0.5)`.
   - ISO parsing via `new Date(iso).getTime() / 1000` (JS analogue of
     `Instant.parse(iso).epochSeconds`).

`applyOptimizationWeights` already mirrors `Scoring.kt:68-83` exactly — no change needed
there; this is a parity verification, not a rewrite.

### Change 3 — Parity fixture + tests (R3)
One canonical input + expected `ScoreBreakdown` lives at `shared/parity-fixture.json`.
Consumed by:

- **`supabase/functions/_shared/scoring.parity.test.ts`** (Deno test) — loads the JSON,
  computes from TS, asserts equality with the expected `ScoreBreakdown` and `totalScore`.
- **`shared/src/commonTest/kotlin/com/austinconnor/pulse/shared/ScoringParityTest.kt`** (new
  KMP commonTest source set) — same JSON, computes from Kotlin via `Scoring.kt`, asserts.

The commonTest set needs minimal Gradle wiring: add the `commonTest` source set with the
`kotlin.test` dependency in `shared/build.gradle.kts`. The fixture is the smallest input that
exercises all 5 signals (one venue, one event scenario, known walk minutes).

Fixture shape (single source-of-truth file):

```json
{
  "heuristicVersion": "5sig-2026.06",
  "inputs": {
    "walkMinutes": 12,
    "consensus": 1.5,
    "recency": 1.2,
    "useCaseFit": 1.0,
    "event": {
      "startISO": "2026-06-12T20:00:00Z",
      "endISO":   "2026-06-12T23:00:00Z",
      "announcedAtISO": "2026-06-12T08:00:00Z",
      "nowISO": "2026-06-12T19:30:00Z",
      "isAtThisVenue": true,
      "isPurposeAligned": true
    }
  },
  "expected": {
    "distance": 1,
    "realTimeRelevance": 3.0,
    "breakdownTotal": 7.7
  }
}
```

(The numbers are illustrative — exact values get checked in once both languages run against
the same JSON and we confirm agreement.)

### Change 4 — `heuristicVersion` constant (R4)
Add the constant in three places, all equal:

- `shared/types.ts`: `export const heuristicVersion = '5sig-2026.06';`
- `shared/src/commonMain/kotlin/com/austinconnor/pulse/shared/Types.kt`:
  `const val heuristicVersion: String = "5sig-2026.06"` (file-level).
- `shared/parity-fixture.json`: matches (so the parity tests can also assert the constant
  agreement at runtime).

Naming: `5sig-2026.06` — explicit about the signal count + month-precision rev. Bump format
on each parity-affecting change.

## Files touched

| Path | Action |
|------|--------|
| `shared/types.ts` | create (the big one — mirror all 24 declarations) |
| `supabase/functions/_shared/scoring.ts` | edit (header, totalScore, add realTimeRelevance) |
| `supabase/functions/_shared/scoring.parity.test.ts` | create |
| `shared/parity-fixture.json` | create |
| `shared/src/commonMain/kotlin/com/austinconnor/pulse/shared/Types.kt` | edit (add heuristicVersion constant) |
| `shared/build.gradle.kts` | edit (add commonTest source set + kotlin.test dep) |
| `shared/src/commonTest/kotlin/com/austinconnor/pulse/shared/ScoringParityTest.kt` | create |

No changes to `find-spots/index.ts`, `plan-day/index.ts`, `Scoring.kt`'s function bodies, or
any client code — confirmed by spec exploration.

## Constitution Check

| # | Principle | Status |
|---|-----------|--------|
| I | **Vertical slice.** | ✓ One concern: TS↔Kotlin contract parity. |
| II | **Convention before invention.** | ✓ Types live at repo-root `shared/types.ts` per the existing import path (precedent: `find-spots/index.ts:26`, `plan-day/index.ts:24`). Enum encoding via `@SerialName` ↔ string-literal union is the standard kotlinx.serialization ↔ TS pairing. |
| III | **AC are the contract.** | ✓ Backbone AC #2 said target `supabase/functions/shared/types.ts`; spec D1-A reconciles to repo-root path because the *real* AC ("the find-spots stub already imports `../../../shared/types.ts` — that import must resolve") is the binding constraint. Reconciliation cited in commit. |
| IV | **Fail loud at boundaries.** | ✓ TS interfaces don't validate at runtime (compile-time only) — that's the layer's contract; no false security added. |
| V | **No speculative scope.** | ✓ `commonTest` source set added because AC #4 demands a Kotlin-side parity assertion; not adding it would leave the AC half-done. No other test infra added. |
| VI | **No duplication of working code.** | ✓ `applyOptimizationWeights` (scoring.ts:26-49) is already faithful — leaving it alone, not rewriting "for parallelism's sake". |
| VII | **Errors are typed.** | n/a — pure data + math; no error paths in scope. |
| VIII | **No commented-out code.** | ✓ Header comment update replaces the wrong "4-signal" line; no dead code. |
| IX | **Tests where they catch real bugs.** | ✓ The parity drift this very planning exercise surfaced is exactly the bug class the parity fixture prevents. Worth the commonTest wiring. |
| X | **Isolate classes of change.** | ✓ Three commits: (a) types.ts + heuristicVersion in Kotlin, (b) scoring.ts parity fix + Deno parity test, (c) Kotlin commonTest set + fixture + Kotlin parity test. No mixing in unrelated cleanup. |
| XI | **No speculative version bumps.** | n/a — `heuristicVersion` is being introduced, not bumped. |

## Risks
- **Boundary semantics of `realTimeRelevance`.** Kotlin uses `Instant.parse` + `epochSeconds.toDouble()`; JS `new Date(iso).getTime() / 1000` is functionally equivalent but float-precision can drift at the nanosecond edge. Mitigation: the parity fixture's ISO timestamps are second-precision; assertion tolerance: exact equality on the 5 inputs we use.
- **`commonTest` Gradle source set is new infra.** If the wiring fails on CI, W2 ships parity-test-on-one-side which weakens AC #4. Mitigation: verify locally before committing; the wiring is standard KMP boilerplate.
- **Type-mirroring volume.** 24 declarations is a lot to mirror by hand — any drift introduces silent wire-shape bugs. Mitigation: file is grouped 1:1 with Types.kt section headers; reviewer can scan side-by-side.

## Next phase
Tasks. Then pre-implement confirm.
