# W19 — Free things to do today/tomorrow (Omaha) — simplest-free (static JSON)

**Branch:** `w19-free-things-omaha` · **Area:** harvester + shared + ios · **DependsOn:** none (self-contained; deliberately does NOT use the Supabase events stack) · **Relates-to:** supersedes the free-events use of W8/W10 for now
**Status:** implement (data layer done; client wiring in progress)

> **Architecture revised 2026-08-13** per directive "make it free + as simple as possible for now." The earlier draft built this on Supabase Edge Functions + Postgres/PostGIS + Claude extraction. That is now **superseded** by a **static-JSON** design. Rationale below.

## Problem
The product's sharpest use case — *"check my city → what's **free** to do **today & tomorrow**"* — must be **$0 to run** and **as simple as possible**. Pulse's broader design routes events through Supabase (Postgres/PostGIS + Edge Functions) with Claude extraction + Google Places matching — the two things that actually cost money (Claude per-token, Places per-call) and the most operational complexity. None of that is needed for structured free-events.

## Architecture (simplest free)
A **static-JSON pipeline** — no live backend:
1. **Harvester** (`harvester/harvest.mjs`, plain Node) pulls **structured** free-events sources (deterministic parsing → zero API cost): Eventbrite date-scoped free pages (`__SERVER_DATA__` blob) + Localist civic/university calendars. Writes `harvester/output/{city}.json` (today + tomorrow free events + curated evergreen spots).
2. **GitHub Actions cron** (`.github/workflows/harvest.yml`, free) runs it twice daily and commits the JSON.
3. **Client** fetches that JSON from `raw.githubusercontent.com` (free CDN) — no server, no DB, no cold starts, no Supabase pause-on-inactivity.

**Cost: $0. Moving parts: a script + a JSON file + a fetch.** The Supabase events stack (W7/W8/W10) + Claude (W4) + Places (W3) stay available for the heavier find-spots/plan-day features later; W19 simply doesn't touch them.

## Exploration findings (still-relevant client facts — do NOT rebuild)
- Events + the only existing **cost badge** live in the **Pulse feed tab** (`PulseView.swift:179-186` renders `event.cost` in a capsule), not the Planner (which renders itinerary slots only). → the Free feature lands in the Pulse feed tab.
- **City is a hardcoded `Location` constant, no `City` type** — `ApiClient.kt:76-78` `Defaults.PENN_STATION`; iOS `Models.swift:19-21`; `PulseView.swift:306` map center. Add `Defaults.OMAHA` alongside.
- **`Event`** already has `cost: String?` + a documented `"free"` tag (`Types.kt:104,109`; `types.ts`; `Models.swift:90,95`). "Free" is derived from those — **no new field**.
- **`ApiClient`** is "a thin HTTP client over the Supabase Edge Functions" (`ApiClient.kt:15`). W19 adds a **separate, tiny static-JSON fetch** (no Supabase dependency) rather than routing through `eventsFeed`.
- **Types-parity rule (W2):** Kotlin `Types.kt` is source of truth; `types.ts` + `Models.swift` mirror it; a new wire model must appear in all three. The `FreeThings` payload shape is new → declare it in all three.
- **Android is a stub** (screens/VMs don't exist) → out of scope (W17). **iOS has no generated `.xcodeproj`** (xcodegen + KMP XCFramework = W15, unbuilt) → the client compiles/runs only once W15 exists.

## Acceptance Criteria
> A free GitHub Actions cron harvests Omaha's free events for today+tomorrow into a static `omaha.json` (no paid API, no server). The iOS Pulse feed tab, defaulting to Omaha, fetches that JSON and shows the free events with a **Today/Tomorrow** toggle and a **FREE** badge, plus the curated always-free spots — at $0 running cost.

## Acceptance Criteria Coverage Map
| # | AC fragment | Type | Disposition |
|---|-------------|------|-------------|
| 1a | "harvester pulls free Omaha events for today+tomorrow from structured sources at $0" | Backend | **Demonstrated (done)** — `node harvest.mjs omaha` produced 21 free events (9 today/12 tomorrow) + 4 evergreen into `harvester/output/omaha.json`; sources are Eventbrite free pages + UNO Localist (no paid API). |
| 1b | "on a free cron, committed as static JSON" | Convention | **Explained** — `.github/workflows/harvest.yml` runs twice daily on GitHub Actions (free) and commits `output/*.json`; the app reads `raw.githubusercontent.com`. |
| 2a | "iOS Pulse feed tab, defaulting to Omaha, fetches the JSON" | Client | **Demonstrated (video, gated on W15)** — `Defaults.OMAHA`; a small `FreeThingsClient` GETs the static URL; `/verify-ac-ios`. |
| 2b | "shows free events with Today/Tomorrow toggle + FREE badge + evergreen spots" | Client | **Demonstrated (video, gated on W15)** — feed tab renders the payload; Today/Tomorrow segmented control; green FREE badge (reuse `EventRow` cost capsule); evergreen section. |

## Decisions (settled)
- **D1 — Static JSON, no live backend.** Simplest + unambiguously $0; removes the Supabase runtime/Docker gate.
- **D2 — Structured sources only, no LLM/Places.** Eventbrite `__SERVER_DATA__` + Localist are already structured → deterministic parse, $0. Long-tail LLM extraction is out of scope.
- **D3 — "Free" is derived** from `cost=="free"` / `"free"` tag — no new `Event` field.
- **D4 — Lands in the Pulse feed tab** (events + cost badge already live there), not the Planner.
- **D5 — Omaha as a `Defaults.OMAHA` `Location` constant** (not a new `City` type yet).
- **D6 — iOS-only client; Android (W17) deferred.**
- **D7 — Client fetches the static URL directly** via a tiny `FreeThingsClient`, decoupled from the Supabase `ApiClient`.

## Requirements
- **R1 (→1a,1b) — DONE:** `harvester/harvest.mjs` + `harvester/cities/omaha.json` + `harvester/output/omaha.json`; Eventbrite + Localist structured parsers; today/tomorrow window in city tz; dedupe; evergreen list.
- **R2 (→1b) — DONE:** `.github/workflows/harvest.yml` cron (twice daily) commits the JSON.
- **R3 (→2a,2b):** `FreeThings` payload types declared in `Types.kt` (source of truth) + `types.ts` + `Models.swift` (parity).
- **R4 (→2a,D7):** `FreeThingsClient` (KMP) GETs a configurable static JSON URL and decodes to `FreeThings`. No Supabase dependency.
- **R5 (→2a,D5):** `Defaults.OMAHA = Location("Omaha", 41.2565, -95.9345)` in `ApiClient.kt` + `Models.swift`; `PulseView` map center uses the active location.
- **R6 (→2b,D3,D4):** `PulseView.swift` renders the free-things payload — a **Today/Tomorrow** segmented control, a green **FREE** badge on each row (reuse the `EventRow` cost capsule), and an "Always free" evergreen section.
- **R7 (→verification):** `/verify-ac-ios` video for 2a/2b once W15 (build toolchain) exists.

## Status & external gates
- **Data layer (R1, R2): complete and verified** — `omaha.json` generated; workflow written.
- **Gate A — hosting/cron:** the free cron + `raw.githubusercontent.com` serving needs `pulse` on GitHub. **`pulse` has no git remote** → one-time repo push required before the cron runs and the client URL resolves.
- **Gate B — client build (R3–R7):** the native iOS client can't compile/run here — **no generated `.xcodeproj`; KMP XCFramework (W15) unbuilt.** Client code is written but video-verification (2a/2b) is blocked on W15.

## Out of scope (owned elsewhere)
- Live web-search fallback, LLM extraction of unstructured long-tail, OSM/registry venue discovery → the broader strategy / W8/W10/W12.
- Android Free surfacing → W17. · A `City` type / in-app city picker → separate multi-city slice.
- Relevance/spam filtering polish (drop out-of-metro + webinar noise) → fast follow on the harvester.

## Known limitation (discovered at ship, 2026-08-13)
**Eventbrite returns empty to GitHub Actions' datacenter IPs.** The cron runs and commits successfully, but its Eventbrite harvest came back with **0 events** (vs 7 from a residential IP) — Eventbrite appears to vary/block datacenter traffic (same class of issue as the DSA Cloudflare gate). So the *automated* data is currently unreliable for the Eventbrite source specifically. **Fast-follow options:** (a) lean on IP-agnostic structured sources — Localist, public ICS/iCal, civic Socrata/LibCal APIs — which don't IP-block, and treat Eventbrite as best-effort; (b) accumulate/merge across harvests (keep in-window events until their date passes) so a transient empty run doesn't wipe the list; (c) run the harvester from a residential IP on a schedule instead of Actions. The static-JSON architecture itself is unaffected — only the Eventbrite *fetch* is IP-sensitive.
