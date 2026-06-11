# Architecture

Deeper than the README. Read this before changing the data flow.

## Stack at a glance

```
        ┌─────────────────────┐   ┌─────────────────────┐
        │   iOS — SwiftUI     │   │  Android — Compose  │
        │   (ios/)            │   │  (android-app/)     │
        └──────────┬──────────┘   └──────────┬──────────┘
                   │                          │
                   │ (KMP XCFramework         │ (KMP :shared
                   │  — pending wire-up;      │  consumed
                   │  hand-mirrored now)      │  directly)
                   │                          │
                   ▼                          ▼
              ┌──────────────────────────────────┐
              │   shared/ — KMP shared module    │
              │   types · scoring · ApiClient    │
              └──────────────┬───────────────────┘
                             │ HTTPS POST
                             ▼
              ┌──────────────────────────────────┐
              │   Supabase Edge Functions (Deno) │
              │   find-spots · plan-day ·        │
              │   events-feed · ingest-events ·  │
              │   enrich-business ·              │
              │   import-business-registries     │
              └──────────────┬───────────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
  ┌─────────┐         ┌──────────────┐        ┌─────────────┐
  │ Claude  │         │  Postgres    │        │ Google      │
  │ API     │         │  + pg_cron   │        │ Places      │
  └─────────┘         │  + pg_net    │        │ + Distance  │
                      │  + PostGIS   │        └─────────────┘
                      └──────────────┘
```

## Data flow per feature

### Find Spots

```
User picks purpose + location
  ↓
mobile screen (FindSpotsView / FindSpotsScreen)
  ↓ POST /functions/v1/find-spots
Supabase Edge Function (find-spots/index.ts)
  ├─→ Google Places Text Search     ↰
  ├─→ Distance Matrix                ├ candidates + walk minutes
  ├─→ events table (PostGIS KNN)     ┤ matching live events near each candidate
  ├─→ Claude API                     ┘ purpose → attributes, per-candidate use-case fit, "why" copy
  │
  │  Deterministic scoring (shared/.../Scoring.kt):
  │    consensus + recency + useCaseFit + distance + realTimeRelevance
  │
  ↓
ScoredSpot[] returned to mobile, rendered as tiered list with score breakdown
```

### Plan Day

```
User picks date, optimizeFor, energy
  ↓
mobile screen (PlanDayView / PlanDayScreen)
  ↓ POST /functions/v1/plan-day
Supabase Edge Function (plan-day/index.ts)
  ├─→ slot decomposition (date + weekday → slot list)
  ├─→ for each open slot:
  │     internal call: same find-spots logic
  │     use-case fit re-weighted by optimizeFor
  ├─→ day-level constraints (code):
  │     geographic threading (no backtracking)
  │     energy filter
  │     novelty penalty (vs recentPlans)
  │     live-event override (flag tradeoffs)
  ↓
PlanDayResponse rendered as time-blocked schedule with tradeoffs callout
```

### Events Feed

```
Hour-by-hour real-time signal, two simultaneous paths:

(A) Cron-ingested (background)
    pg_cron schedule
      ↓ POST /functions/v1/ingest-events (x-ingest-secret)
    ingest-events
      ↓ Polls each source per monitored_entities table
      ↓ Claude extraction → structured Event[]
      ↓ Upsert into events table by canonical_key
      ↓ Log to event_ingest_runs

(B) Per-query live search (foreground)
    User asks "what's happening tonight"
      ↓ POST /functions/v1/events-feed
    events-feed
      ├─→ Read events table (PostGIS query by geo + time)
      ├─→ WebSearch + Claude extraction (fallback for last 15-min gap)
      ├─→ Merge + dedup by canonical_key
      ├─→ Upsert any new events from live search back to events table
      ↓
    EventsFeedResponse — events + freshness metadata
```

### Business Universe (the moat)

```
Monthly bulk import (pg_cron triggered)
  ↓ POST /functions/v1/import-business-registries
  ├─→ NYC Open Data (DCWP, DOHMH, SLA, DCA …)
  ├─→ NYS Dept of State Corporations
  ↓ Upsert into business_universe by (source_registry, source_id)
  ↓ Queue new rows for enrichment

Continuous enrichment (cron, batches of 20)
  ↓ POST /functions/v1/enrich-business
  ├─→ Google Places match (by name + address)
  ├─→ Homepage scrape for socials
  ├─→ LLM fallback search for missing handles
  ↓ Upsert into business_socials

Continuous polling (cron, tier-dependent cadence)
  ↓ For each row in business_polling_state where tier <= 3 and next_poll_at <= now()
  ├─→ Poll the social channels in business_socials
  ├─→ Claude extraction of any new posts → Event[] candidates
  ↓ Upsert into events table
  ↓ Update polling_state with last_post_at, posts_last_7d, recompute tier
```

## Why hybrid (Claude + Places + ingestion)?

Each layer alone is worse.

**Places alone**: real venues + reviews + hours, but doesn't know that "remote work" means "outlets + WiFi + low noise" or that "best cocktails" means "craft program + current scene." Returns generic "popular" lists. Doesn't see live events.

**Claude alone**: knows the attribute taxonomy + can synthesize but can't enumerate candidates from a list of 250K businesses, doesn't have current hours, can hallucinate addresses. Can't poll Instagram on a schedule.

**Ingestion alone**: knows what's happening *right now* but doesn't know which places match a stated purpose or have editorial backing.

**Hybrid**: Places enumerates candidates + metadata; ingestion provides real-time event signal; Claude judges *meaning* (purpose → attributes, fit scoring, "why" copy); code does the deterministic math.

## Auth

- Phase 2 (TestFlight + friends): Supabase email magic link.
- Phase 3 (public): + Sign in with Apple (App Store requirement) + Google.

User-facing functions have `verify_jwt = true`. Cron functions have `verify_jwt = false` + `x-ingest-secret` header guard.

## State + persistence

Mobile state is local (React-style — Compose + SwiftUI both run reactive). No Redux/Zustand.

Persisted server-side via Supabase Postgres:
- `trips`, `day_plans`, `saved_spots` — user-owned, RLS scoped to auth.uid()
- `events`, `monitored_entities`, `business_universe`, `business_socials`, `business_polling_state` — public-readable to authenticated users, write-restricted to service role
- `event_ingest_runs`, `business_ingest_runs` — observability tables, service-role write

## How this relates to the trip-planning project

The original ranking heuristic was written as Claude Code skills:
- `/Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md` — 5-signal spec with cocktail worked example
- `/Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/plan-day/SKILL.md` — orchestration spec

Those `SKILL.md` files are **the spec**. This app codifies them in TypeScript (Edge Functions) + Kotlin (`shared/Scoring.kt`) + Swift (mirrored in `Models.swift`). When the heuristic changes:

1. Update the relevant `SKILL.md`.
2. Update the corresponding code (typically `_shared/scoring.ts` or `Scoring.kt` for the math, the function `index.ts` for the pipeline, or the system prompt for LLM judgment).
3. Bump a `heuristicVersion` constant so cached results from older versions can be invalidated.

The spec and the implementation must stay in lockstep. The spec is human-readable; the app is the production system.

## Open questions to resolve before Phase 3 (scaling)

1. **Caching strategy** — Redis (Upstash) or just Postgres-backed with TTL? Per-query cost is low but latency benefits significantly from caching.
2. **Offline mode** — does the app work without network? If yes, cache last N spot results + saved day plans in SQLite (Room on Android, SwiftData on iOS).
3. **Multi-city** — name is `pulse` but the heuristic is city-agnostic. Decide before App Store submission if other cities are in Phase 3 scope.
4. **Monetization** — free with API costs eaten? Subscription? One-time? Freemium with rate limit + paid tier? See `docs/investor-pitch.md`.
5. **Social media scraping spend** — at what user count does Curated tier ($300–500/mo) cease to be enough? Build the dashboard.
