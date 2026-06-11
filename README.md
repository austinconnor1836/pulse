# pulse

Native iOS + Android app for finding the **best** things to do in NYC right now — not "all the things" — using a 5-signal heuristic that ingests real-time business + civic posts hour by hour.

Two features (use either or both):

1. **Find Spots** — "best cocktails near me," "remote work spot," "drag show tonight." Returns a ranked list with score breakdown so the user can see *why* each placed.
2. **Plan a Day** — full time-blocked day plan that orchestrates Find Spots across slots, threads geography + energy + novelty, and respects user itineraries.

## The 5-signal heuristic

Each candidate spot scored on:

1. **Cross-source consensus** — editorial agreement (Infatuation / Time Out / Eater / Gothamist / etc.)
2. **Recency / trending** — Reddit/TikTok buzz + venue activity sub-signal (how recently the venue itself posted)
3. **Use-case fit** — purpose-relevant attributes (outlets for work, craft program for cocktails, dance floor for parties)
4. **Distance / practical fit** — walk-time bucket, open at the stated time
5. **Real-time event relevance** — actively announced events tonight, breaking-news pop-ups, relocations

Source-of-truth spec: `/Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md`. Worked example for "best cocktails near me" is in there.

## Status

🌱 **Scaffolding done. Backend not yet wired.**

- ✅ iOS app (Swift + SwiftUI) — builds cleanly. Ready to TestFlight.
- ✅ Android app (Kotlin + Jetpack Compose) — opens in Android Studio.
- ✅ KMP shared module (types + scoring + Ktor API client) — `:shared`.
- ✅ Supabase backend (Edge Functions stubbed, migrations + RLS in place).
- ✅ 5-signal heuristic specced + scored in code (Kotlin + Swift mirror).
- ✅ Real-time ingestion architecture documented + cost-tiered.
- ✅ Business universe pipeline architected (NYC Open Data → enrichment → tiered polling).
- ⏳ Backend implementation (Edge Functions return empty payloads).
- ⏳ Ingestion cron actually running.
- ⏳ Auth (currently sends anon key; swap to user JWT before launch).

## Stack

| Layer | Choice | Why |
|---|---|---|
| iOS | **Swift + SwiftUI** via `xcodegen` | Native feel, modern declarative API. Xcode project regenerated from `ios/project.yml` (no `.xcodeproj` in git). |
| Android | **Kotlin + Jetpack Compose** + expo-router-style nav-compose | Native feel, declarative API; shares mental model with SwiftUI. |
| Shared logic | **Kotlin Multiplatform (KMP)** at `:shared` | Single Kotlin module for types, deterministic scoring, Ktor HTTP client. Consumed natively by Android; consumed via XCFramework on iOS (currently hand-mirrored; XCFramework wiring is the next step — see `ios/README.md`). |
| Backend | **Supabase** (Auth + Postgres + Edge Functions on Deno) | Auth + DB + serverless in one place. Edge Functions keep the Claude API key off-device. Free tier covers TestFlight phase. |
| LLM | **Claude API** inside Edge Functions | Hybrid ranking: purpose → use-case attributes, per-venue use-case fit score, "why" copy generation, live-search event extraction. |
| Venues | **Google Places API** | Authoritative venue data, reviews, hours. |
| Real-time | **Layered ingestion** (RSS + Reddit + paid social scraping + per-query live search) | See `docs/realtime-ingestion.md` for the honest cost tiers. |

## Layout

```
pulse/
├── README.md
├── ios/                                 # SwiftUI app
│   ├── project.yml                       # xcodegen spec
│   ├── Pulse/                    # Swift sources
│   ├── README.md                         # iOS-specific setup
│   └── SHIP_TO_TESTFLIGHT.md             # ship guide
├── android-app/                         # Compose app (Gradle module)
│   ├── build.gradle.kts
│   └── src/main/...                      # Kotlin + AndroidManifest
├── shared/                              # KMP shared module (Gradle module)
│   ├── build.gradle.kts
│   └── src/{commonMain,androidMain,iosMain}/kotlin/...
├── supabase/
│   ├── functions/                        # Edge Functions (Deno)
│   │   ├── find-spots/
│   │   ├── plan-day/
│   │   ├── events-feed/
│   │   ├── ingest-events/                # cron-triggered
│   │   ├── enrich-business/              # cron-triggered
│   │   └── import-business-registries/   # cron-triggered, monthly
│   └── migrations/                       # SQL — events, trips, monitored entities, business universe, schedules
├── docs/
│   ├── architecture.md                   # data flow + per-feature pipelines
│   ├── realtime-ingestion.md             # the honest four-tier ingestion + cost model
│   └── investor-pitch.md                 # the founder-facing pitch
├── settings.gradle.kts                   # Gradle root
├── build.gradle.kts
├── gradle.properties
└── gradle/libs.versions.toml             # Gradle version catalog
```

## Run it (right now)

### iOS — TestFlight preview

```sh
open ios/Pulse.xcodeproj
```

Follow `ios/SHIP_TO_TESTFLIGHT.md` step by step. App launches with two screens; backend isn't wired, so action buttons will surface a "Missing config" error (informative, not a crash). You can demo the UI now and wire the backend later.

### Android — Studio preview

```sh
open -a "Android Studio" .
```

Android Studio will run `gradle wrapper` on first open and import the project. Then run on an emulator or device.

### Backend — local stack (when ready)

```sh
cd supabase
supabase start
supabase functions serve
```

Then edit `mobile/.env` (in the iOS Config.xcconfig or Android local.properties) to point at `http://localhost:54321`.

## Related projects

- `/Users/austin/Developer/nyc-trip-jun-2026/` — where the heuristic was prototyped as Claude Code skills. Those `SKILL.md` files are the spec the app implements.
