# Pulse — Investor pitch

**Tagline: Live like a local.**

The founder-facing brief. Not a polished deck — the source-of-truth narrative for what we're building, why it's defensible, and what funding unlocks.

## The 30-second version

**Every existing "what should I do tonight" app returns the same stale list.** Yelp's top-rated, Time Out's editor picks, Google's "popular nearby." They all rank what was good last year, not what's hot tonight. They feel like brochures for visitors. They are not the friend who tells you "skip Joe's tonight, the dive bar two blocks over has a guest bartender and the crowd is incredible."

**Pulse is that friend.** A city-intelligent app that knows what's pulsing right now. A 5-signal heuristic ingests business + civic + cultural posts in real time, layered with editorial consensus and use-case fit. When the mayor announces a relocated watch party 6 hours before tip-off, we surface it. When a new cocktail bar drops a guest-bartender night on Instagram this morning, it ranks above 10-year-old establishments. When a dive bar's social went silent in November, it drops.

**Moat: deterministic enumeration + semantic profiling of every business in a city via public records + their own website.** NYC Open Data + NYS Dept of State gives us ~250K NYC businesses for free. Per-business enrichment (~$0.03 each) scrapes each business's own website and LLM-extracts a structured profile — specific business type, products, services, vibe in their own words, per-purpose fit scores. The user searching "Korean BBQ with cocktails" hits the Korean BBQ that ADVERTISES soju cocktails, not the one that registers as "restaurant" with NY DOS. Tiered polling monitors the active ones hourly without blowing budget. **Each new city plugs in its own equivalent open data (DataSF, LA Open Data, City of Chicago, etc.) — the architecture is city-agnostic by design.** No competitor has this kind of structural city knowledge.

**Two tabs that ride the moat:**
- **Pulse** — what's happening right now. Live feed of hot spots + active events, with Feed/Map view modes and an always-on search bar. The default surface most users will live in.
- **Plan** — your day, tonight, this week. Each day is a time-blocked plan that respects geography, energy budget, and the user's stated optimization target (novelty, meet-people, enjoyment, recovery).

## Why now

Four things made this possible only recently:

1. **LLM cost collapse.** Per-business enrichment + per-query relevance ranking that would have cost $1/query in 2022 now costs $0.001. Variable cost goes from prohibitive to invisible.
2. **NYC Open Data maturity.** DCWP "Legally Operating Businesses" has 250K+ active rows. DOHMH Restaurant Inspections, SLA Liquor Licenses, etc. — all public APIs, all current, all geocoded.
3. **Semantic classification got reliable.** LLMs can now read a business's homepage + about page + menu and produce a sharper category than the business's own Yelp listing — "korean_bbq_with_dj_nights" instead of "restaurant." This is what makes "find every X near me" actually work for arbitrary X.
4. **Real-time ingestion infra commoditized.** Supabase Edge + pg_cron handles the cron tier. Third-party social scraping APIs (Apify, ScrapingBee) handle Instagram at $0.001/scrape. The full stack costs <$500/mo at MVP scale.

## The 5-signal heuristic (the product)

| Signal | What it captures | Sources |
|---|---|---|
| **Consensus** | Editorial agreement | Infatuation, Time Out, Eater, Gothamist, NYT, Resy editorial |
| **Recency / trending** | Current scene + venue alive-ness | Reddit/TikTok buzz, venue posting activity (sub-signal) |
| **Use-case fit** | Does it fit the *purpose* (cocktails, work, drag, brunch)? | LLM-derived attributes confirmed via reviews + venue posts |
| **Distance / practical fit** | Reachable now, open at the right time | Google Places hours + Distance Matrix |
| **Real-time event relevance** | Pop-ups, relocations, breaking-news events | Mayor's office, NYC Parks, news feeds, venue IG, per-query live search |

A worked cocktail example is in `find-spots/SKILL.md`. Punchline: a newly-opened bar with no Time Out mention but heavy current buzz + a real announced event tonight beats a Plaza hotel bar with two list mentions and a dead Instagram.

## The four-tier real-time ingestion model

The moat. See `docs/realtime-ingestion.md` for the full version.

1. **Always-on curated polling** — finite list of high-signal entities (mayor, NYC Parks, news, top venues, party promoters, subreddits). ~500 entities at full Curated tier.
2. **On-signal widening** — when Tier 1 flags a hot signal, fan-out per-event web + API search across 20+ secondary sources.
3. **User-submitted** — community fill-in for the long tail. Auto-promote on 2+ corroboration.
4. **Per-query live search** — every user query also does a live web search. Catches whatever the cron missed in the last 15 minutes.

Plus the **business universe pipeline** — deterministic enumeration of ~250K NYC businesses via NYC Open Data, enriched with socials, tiered-polled.

## Cost model + scaling plan

The honest version. Funding moves us up the tier.

| Phase | Tier | Sources covered | Monthly | What it feels like |
|---|---|---|---|---|
| **MVP (now, pre-funding)** | **Lean** | RSS + Reddit + per-query live search + user submissions. No paid social APIs. | **~$50** | Catches civic + news + Reddit + user reports. Misses IG-only announcements. Demoable to investors. |
| **Phase 2 (seed)** | **Curated** | Lean + light IG/X polling for ~100 high-trust accounts + paid 3rd-party scraping for venue list | **~$300–500** | Mayor's IG post propagates in ~15 min. Real users now find value. |
| **Phase 3 (Series A)** | **Aggressive** | Curated + business universe enrichment for ~250K NYC businesses + X API Pro firehose + IG scraping at scale | **~$5K–10K** | "Every business in real time." Real-time competitive moat. Multi-city expansion begins. |
| **Phase 4 (growth)** | **Unlimited** | Premium-tier every API, dedicated scrapers, exclusive data deals | **~$50K+** | Aspirational ceiling. Only at meaningful revenue. |

We are at Phase 1 with a clear architectural path to Phases 2 and 3. Migrations + Edge Function stubs for the Aggressive-tier business universe pipeline are *already in the repo* — we built the architecture even though we won't switch it on until funded.

## What funding unlocks (specifically)

| Round | Use | Tier transition |
|---|---|---|
| **Pre-seed ($200K)** | 6 months runway, ship Phase 2 (Curated), 5K users in NYC | Lean → Curated |
| **Seed ($1.5M)** | 18 months runway, ship Phase 3 (Aggressive + business universe live), 100K NYC users, hire 2 eng + 1 design | Curated → Aggressive |
| **Series A ($8M)** | Multi-city expansion (LA, SF, Chicago, Miami, Austin), 1M users, hire commercial | Aggressive across N cities |

## Why an app (and not a website)

- **Push notifications** for breaking real-time signals matched to user prefs ("Mamdani just announced a Bryant Park watch party 0.4 mi from you"). Web can't do this well.
- **Location-aware** by default — phone knows where you are.
- **Daily-use habit loop** — a website doesn't live on the home screen.
- **App Store distribution** is meaningfully cheaper user acquisition than open web for a daily-use product.

## What's defensible

1. **The deterministic business universe.** Public registries + enrichment + polling state is a multi-year build for a competitor to replicate, even with the same budget.
2. **The trust-weighted source taxonomy.** Knowing that NYC Mayor's official IG > Time Out > random Reddit comment, encoded across hundreds of sources, is a knowledge asset that compounds.
3. **The heuristic spec itself** — the 5-signal model with sub-signals (venue activity, breaking-news bump, decay curves) is the product opinion. Open-source-able without losing edge because the moat is the ingestion, not the math.
4. **Multi-platform from day 1.** KMP shared module means iOS + Android stay in lockstep. Most competitors are iOS-first; we're both at the same cost.

## What's NOT defensible

- The UI. Anyone can rebuild two screens.
- The LLM model. We use Claude; competitors can use anything.
- The Edge Function infra. Supabase is commodity.

Defensibility lives in the ingestion + trust system + heuristic refinement, not in code.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Apple/Google reject the app over scraping | We only use first-party public registries + paid 3rd-party scrapers (ToS-compliant). No direct scraping from the app. |
| Instagram/X kill their public surface area | Our model is layered — we already plan around no real-time IG. Per-query live search backstops the tail. |
| Cost blows up at scale | Per-business polling tiers scale linearly with active users, not entity count. We can dial down aggressiveness in low-revenue areas. |
| Claude pricing changes | The deterministic parts (scoring, distance, consensus tallying) run in code, not LLM. Only judgment + extraction call LLMs. ~70% of compute is non-LLM. |
| User-submitted spam | Trust-weighted promotion + cross-corroboration requirements + decay. See `docs/realtime-ingestion.md`. |

## What to demo

Right now, TestFlight build shows the UI: two screens, score breakdown layout, optimization-target chips. Tapping the action button surfaces a "Missing config" error (informative). Pre-investor-meeting, wire the backend to return canned data so the buttons return a worked cocktail example like the one in the find-spots spec. That's a 1-day implementation lift; the architecture supports it cleanly.

Show, in this order:
1. **Find Spots: "best cocktails near me"** → ranked list with score breakdown. Open Double Chicken Please → see "guest bartender tomorrow" badge.
2. **Find Spots: "remote work spot"** → different attributes confirmed, different ranking.
3. **Plan a Day with `meet-people` target** → time-blocked plan, geographic flow, trade-offs flagged.
4. **The realtime-ingestion.md doc** → "this is the moat. Here's the path from $50/mo to $5K/mo as users grow."
5. **The business universe migration + cost model** → "we can deterministically enumerate every NYC business. No competitor has the data."
