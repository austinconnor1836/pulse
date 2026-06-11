# User-decision feedback loop

> "User decisions should be used to further train the heuristic/model." — founder

The deterministic 5-signal heuristic stays explainable. It doesn't get replaced by a black-box ML model. But every user decision (implicit or explicit) feeds three feedback channels that *tune* it: per-user personalization, per-spot reinforcement, and aggregate signal metrics for human-curated quarterly weight tuning.

## Three feedback channels

### 1. Per-user personalization (real-time)

**Goal**: a user who consistently picks high-recency over high-consensus gets recency-weighted results from then on, without anyone hand-coding their preferences.

**Mechanism**: `user_preferences` table holds per-signal multipliers in `[-0.3, +0.3]` and per-category / per-neighborhood multipliers in `[-0.5, +0.5]`. Applied as `signal_score * (1 + multiplier)` at query time. Bounded so personalization can't override the base heuristic — only nudge.

**Computed nightly** by a job that reads the last 90 days of `user_interactions`:
- If user repeatedly taps spots ranked low on Consensus but high on Recency → boost their Recency weight by 0.05 per cycle, decay back toward 0 if pattern stops.
- If user repeatedly saves dive bars and never saves hotel bars → boost their `dive_bar` category weight, dampen `hotel_bar`.
- If user overrides the planner's anchor in East Village 60% of the time → boost EV neighborhood weight.

**Bound checks**: never let any single signal go above 0.3 or below -0.3, never let any category multiplier exceed ±0.5. Personalization shouldn't break ranking sanity.

### 2. Per-spot reinforcement (cross-user)

**Goal**: when 10K users say "this cocktail bar is actually amazing for cocktail nights," that boosts the spot's use-case-fit signal for everyone searching cocktails.

**Mechanism**: `spot_reinforcement` table keeps `(spot_place_id, purpose_category)` rows with aggregate counts (impressions, taps, saves, visits, thumbs, overrides_to, overrides_from). Derived `reinforcement_score` ∈ `[-1, +1]`. Applied as small bonus to use-case-fit at query time when that spot is being ranked for that purpose.

**Spam-resistance**:
- Counts only signals from users who've been on the app >7 days (lazy users overweighted otherwise)
- Each user counted at most once per (spot, purpose, week)
- Negative signals (thumbs-down, override-from) weighted 1.5x positive signals so bad spots fall faster than good spots rise
- Bounded so a single viral spot can't dominate (max +0.5 contribution to its base score)

### 3. Aggregate signal metrics (slow, human-curated)

**Goal**: when the heuristic itself is wrong — e.g., Consensus is overweighted for cocktails because users consistently override to lower-consensus options — humans see the metric and adjust the base weights in `Scoring.kt`.

**Mechanism**: `heuristic_signal_metrics` table, refreshed nightly, sliced by (city, category, neighborhood). Each signal gets a `predictive_value` = "fraction of impressions where the chosen spot was in the top-N by this signal alone." Plus `override_rate` and `re_query_rate` per slice.

**Quarterly review**: look at metrics, ask "which signal is least predictive in which slice?" Adjust base weights in `shared/Scoring.kt`. Bump `heuristicVersion`. Old cached results invalidate.

The base heuristic always stays explainable — these are human-in-the-loop adjustments, not ML training.

## What gets logged (the `user_interactions` table)

| Kind | Implicit / Explicit | When |
|---|---|---|
| `spot_impression` | implicit | Each spot appears in a ranked list (logged in batch per query) |
| `spot_tap` | implicit | User taps to see details |
| `spot_save` | implicit | Bookmarks |
| `spot_directions` | implicit | Tap directions button |
| `spot_share` | implicit | Share sheet opened |
| `plan_view` / `plan_slot_view` | implicit | Opens a day plan / slot |
| `plan_save` | implicit | Locks the plan |
| `spot_visit_confirmed` | explicit | "Did you go?" follow-up next day |
| `spot_rating` / `spot_thumbs_up` / `spot_thumbs_down` | explicit | UI feedback |
| `plan_slot_override` | explicit | User swaps the planner's pick |
| `plan_target_change` | explicit | User switches optimization target |
| `re_query_same_purpose` | friction | Same purpose within 2h → previous result inadequate |

Each row carries `score_at_impression` and `score_breakdown` snapshots so we can later answer: "when this spot was top-3 by Consensus but bottom-3 by Recency, did the user still tap it?" — the substrate for tuning.

## Client integration

Both apps call `ApiClient.logInteraction(...)` on every meaningful event:

```kotlin
// Android — in FindSpotsViewModel after receiving results
results.spots.forEachIndexed { rank, spot ->
    api.logInteraction(LogInteractionRequest(
        kind = InteractionKind.SPOT_IMPRESSION,
        spotPlaceId = spot.id,
        queryPurpose = lastQuery,
        rankPosition = rank + 1,
        scoreAtImpression = spot.score,
        scoreBreakdown = spot.breakdown,
        heuristicVersion = "v0.1",
        clientApp = "android",
    ))
}
```

```swift
// iOS — same shape
for (i, spot) in res.spots.enumerated() {
    try? await ApiClient.shared.logInteraction(LogInteractionRequest(
        kind: .spotImpression,
        spotPlaceId: spot.id,
        queryPurpose: lastQuery,
        rankPosition: i + 1,
        scoreAtImpression: spot.score,
        scoreBreakdown: spot.breakdown,
        heuristicVersion: "v0.1",
        clientApp: "ios"
    ))
}
```

All calls are fire-and-forget. Logging failures never surface to the user.

## Privacy + consent

- Anonymized aggregate metrics (`heuristic_signal_metrics`, `spot_reinforcement`) are fine without opt-in — they're statistical rollups.
- Per-user `user_interactions` rows are tied to `auth.uid()`. RLS scopes reads to the owning user only.
- Per-user `user_preferences` are tied to `auth.uid()`. Same RLS scope.
- App Store privacy nutrition label: "data used to personalize content; not linked to identity for advertising."
- A "reset my preferences" button in settings clears `user_preferences` for that user. A "delete my activity" button purges `user_interactions` for that user. (Both are good UX *and* GDPR/CCPA compliance.)

## How this becomes a moat over time

1. **Month 1**: ~zero personalization data. Heuristic uses base weights only. Same as competitors who just have static rankings.
2. **Month 6**: 1K users, ~500K interaction events. Per-spot reinforcement starts working — popular underrated spots surface. Aggregate metrics show weak signals to consider tuning.
3. **Year 1**: 10K users, ~10M events. Per-user personalization meaningful for return users. Cohort-based collaborative filtering ("users like you tend to prefer X") becomes viable.
4. **Year 2+**: 100K users. The combination of (deterministic explainable heuristic) + (per-user personalization) + (cross-user reinforcement) is genuinely hard to replicate. New competitors start with a cold catalog and zero learning signal. Even if they copy the 5-signal model exactly, they don't have the data.

This is the layered moat — the heuristic is the IP, the ingestion is the moat, the feedback loop is the compounding moat.

## What stays the same

- The base 5 signals + their math don't change without a quarterly review.
- `find-spots` SKILL.md is still the source of truth.
- The deterministic Kotlin scoring code is still authoritative — personalization is a small multiplier on top, not a replacement.

The product opinion never gets buried inside a black-box model.
