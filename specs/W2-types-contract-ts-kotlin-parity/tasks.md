# W2 — Tasks

**Branch:** `w2-types-contract-ts-kotlin-parity` · **Builds on:** `spec.md`, `plan.md`

Three commits, in order. Build-then-prove.

---

## Commit A — TS types + Kotlin `heuristicVersion`

### T1. Create `shared/types.ts`
Mirror every Kotlin type from `Types.kt:1-277`. Group with the same section headers
(`// ---------- Common ----------`, `// ---------- find-spots ----------`, etc.) for 1:1 visual
diffing.

- Enums → string-literal union types matching `@SerialName` verbatim:
  - `FindSpotsMode` = `'lightweight' | 'deep'`
  - `EventSource` = `'news' | 'civic' | 'reddit' | 'eventbrite' | 'dice' | 'ra' | 'instagram' | 'x' | 'livesearch' | 'user'`
  - `EventConfidence` = `'confirmed' | 'likely' | 'rumored'`
  - `OptimizationTarget` = `'balanced' | 'novelty' | 'meet-people' | 'enjoyment' | 'recovery'`
  - `EnergyLevel` = `'hard' | 'medium' | 'recovery'`
  - `SlotKind` = `'morning' | 'workday' | 'lunch' | 'afternoon' | 'pre-anchor' | 'anchor' | 'late-night' | 'weekend-daytime'`
  - `InteractionKind` = all 15 `@SerialName` snake_case values
- `data class` → TS `interface` with same field names, `?` for optional, defaults preserved as comments where useful.
- Export `heuristicVersion = '5sig-2026.06'`.

### T2. Add `heuristicVersion` constant in `Types.kt`
File-level (outside any class), at the top after the package + imports:
```kotlin
const val heuristicVersion: String = "5sig-2026.06"
```

### T3. Confirm imports resolve
Run `deno check supabase/functions/find-spots/index.ts` and
`deno check supabase/functions/plan-day/index.ts` — both must succeed.

**Commit A message:** `W2: TS types mirror + heuristicVersion (lockstep contract)`

---

## Commit B — Scoring parity fix + Deno parity test

### T4. Update `_shared/scoring.ts` header
Replace the line "Implements the find-spots 4-signal heuristic" with "5-signal".

### T5. Add `realTimeRelevance(...)` to `scoring.ts`
Mirror `Scoring.kt:38-60` exactly:
```ts
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
  const base =
    isAtThisVenue && isPurposeAligned ? 3 :
    !isAtThisVenue && isPurposeAligned ? 1 : 0;
  return Math.min(3, base + breakingBump * 0.5);
}

function epochSeconds(iso: string): number {
  return new Date(iso).getTime() / 1000;
}
```

### T6. Fix `totalScore` to include `realTimeRelevance`
```ts
export function totalScore(b: ScoreBreakdown): number {
  return b.consensus + b.recency + b.useCaseFit + b.distance + (b.realTimeRelevance ?? 0);
}
```

### T7. Create `shared/parity-fixture.json`
One canonical input that exercises all 5 signals. Use second-precision ISO timestamps so JS
and Kotlin parse identically. Numbers: tune after T8 first run; commit only after both tests
agree.

```json
{
  "heuristicVersion": "5sig-2026.06",
  "inputs": {
    "walkMinutes": 12,
    "breakdownBase": { "consensus": 1.5, "recency": 1.2, "useCaseFit": 1.0 },
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
    "totalScore": 7.7
  }
}
```

### T8. Create `supabase/functions/_shared/scoring.parity.test.ts`
- Loads the fixture (`Deno.readTextFile` + `JSON.parse`).
- Computes `distance = distanceScore(walkMinutes)`, `rtr = realTimeRelevance(...)`,
  `total = totalScore({...base, distance, realTimeRelevance: rtr})`.
- Asserts each computed value equals the fixture's `expected.*`.
- Asserts `heuristicVersion` from `types.ts` equals fixture's `heuristicVersion`.

**Commit B message:** `W2: scoring.ts parity with Scoring.kt (add realTimeRelevance) + Deno fixture test`

---

## Commit C — Kotlin commonTest + parity assertion

### T9. Wire `commonTest` source set in `shared/build.gradle.kts`
Add to `kotlin { sourceSets { ... } }`:
```kotlin
val commonTest by getting {
    dependencies {
        implementation(kotlin("test"))
    }
}
```
And ensure the `kotlin-multiplatform` test task picks it up (standard KMP boilerplate).

### T10. Create `shared/src/commonTest/kotlin/com/austinconnor/pulse/shared/ScoringParityTest.kt`
- Reads the SAME `shared/parity-fixture.json` (commonTest reads it via the test resource set;
  if relative-path reading isn't trivial in KMP commonTest, **inline the fixture as a string
  constant** for now and add a TODO to share it).
- Computes the same three values via `Scoring.distanceScore`, `Scoring.realTimeRelevance`,
  `Scoring.totalScore`.
- Asserts equality with `expected` (using `kotlin.test.assertEquals` with a small epsilon for
  doubles).
- Asserts `heuristicVersion` constant equals the fixture's.

### T11. Run `gradle :shared:allTests` (or `:shared:jvmTest`)
Both sides agree. If a value disagrees, fix the **fixture** (not the code) — both
implementations are pinned to `Scoring.kt`'s logic; the fixture is the dependent.

**Commit C message:** `W2: Kotlin commonTest source set + ScoringParityTest`

---

## Verification (Phase 5 preview)

| AC fragment | Evidence |
|---|---|
| 1, 2 (types.ts exists; broken imports resolve) | Demonstrated — `deno check` output on find-spots + plan-day. |
| 3 (scoring parity) | Demonstrated — `deno test scoring.parity.test.ts` output. |
| 4 (parity check across both langs) | Demonstrated — both `deno test` and `gradle :shared:allTests` pass against the same fixture. |
| 5 (heuristicVersion matches) | Demonstrated — fixture-vs-constant assertion in both tests. |

## Tracker-mirror policy
No mirror. Backbone is the source of truth.

## Next gate
Pre-implement confirm — already approved ("it's all approved"). Proceeding to implement.
