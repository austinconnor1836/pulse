# Real-time ingestion — the honest version

> Goal: "this app ingests every business, public and private entity, and knows the moment they post."
>
> Reality: technically infeasible at full literal scope without 8-figure infra. What IS feasible: a layered model that maximally approximates the goal and is honest about its limits.

## What "real-time" actually means here

| Source class | Truly real-time? | Why / why not |
|---|---|---|
| RSS / Atom feeds | ✅ Yes — push every ~60s if you want | Cheap, polite, designed for this. NYC.gov, news outlets, most blogs. |
| Reddit JSON API | ✅ Yes — public endpoint, ~30s polite poll | r/nyc, r/asknyc. Free. |
| Eventbrite / DICE / RA APIs | ✅ Yes — webhooks where available, otherwise poll | Event-creation push from the source. |
| Curated venue websites | 🟡 Hourly | Light HTML scrape on a schedule. Polite. |
| Instagram (public posts) | 🟡 Hourly–daily | No real public API. Paid third-party scraping ($50–500/mo per account-set) OR limited Graph API. Brittle. |
| X (Twitter) | 🟡 Paid only | Free tier killed in 2023. Basic = $100/mo, Pro = $5K/mo for real volume. |
| TikTok | ❌ Effectively no | No real-time public API. |
| Threads | ❌ Not yet | Meta hasn't opened it. |
| LinkedIn | ❌ Effectively no | API closed for this use case. |
| Per-business websites | 🟡 Long tail | Millions of NYC businesses; can't scrape them all. |

So **literally every entity in real time** can't happen. The next-best architecture is:

## The four-tier model

### Business profile enrichment (the semantic layer)

Once `business_universe` enumerates ~250K NYC businesses and `business_socials` enriches them with website + IG/X handles, the **profile enrichment** layer scrapes each business's own website and extracts a structured profile via LLM:

- **Specific business type** ("korean_bbq_restaurant" not "restaurant", "vintage_record_store" not "retail")
- **Products + services** they advertise ("soju cocktails", "vinyl records", "private events")
- **Vibe descriptors** in their own words ("neighborhood dive", "elevated tasting menu", "no-frills")
- **Amenities** (WiFi, outdoor seating, dance floor, wheelchair-accessible, etc.)
- **Per-purpose fit scores** (0–1) for the canonical search purposes — pre-computed at enrichment time so search queries don't need a per-result LLM call

This layer turns the find-spots **use-case fit** signal from "verify attributes via review snippets at query time" into "read pre-computed fit_scores from the profile, fall back to live verification only for spots without profiles yet."

**Why it matters**: the business's *own self-description* is the truest source for what they actually do — sharper than registration categories (which are coarse), sharper than Yelp reviews (which describe customer experience after the fact), sharper than Google Places categories (which compress everything into ~20 buckets).

**Per-business cost**: ~$0.03 one-time (Places lookup + page scrape + Haiku extraction). For 250K NYC businesses: ~$7.5K one-time + ~$1K/quarter to re-enrich active 20%. Phase 3 (Aggressive) spend.

**Politeness**: respects robots.txt, polite User-Agent, 10s timeout, max 5 pages per domain per refresh, rate-limited 1 req per 10s per domain via `scrape_domain_state` table.

### Tier 1 — Always-on curated polling (the monitored set)

A finite list of high-signal entities polled on their own cadence. Lives in `public.monitored_entities`. Adding rows here is how you "widen the net."

Seed list (already in the migration): mayor's office, NYC Parks, MTA, NYPD News, Gothamist, Time Out, Eater, r/nyc, r/AskNYC, Knicks, plus a handful of party-defining venues (Elsewhere, House of Yes, 3 Dollar Bill).

Growth strategy: expand by ~50 entities per neighborhood as you onboard them. ~500 monitored entities is a manageable ceiling for solo-operator infra (~$300/mo all-in).

### Tier 2 — On-signal widening (the spotlight)

When Tier 1 flags a hot signal (mayor posts, news outlet headlines an event, multiple Reddit threads spike on the same topic), the ingestion pipeline fans out a **per-signal widening pass**:

- LLM extracts the named entities + venue + time window
- Per-signal live web search across Google + Google News + Bing + Reddit search
- Targeted X API search (paid tier, used sparingly to control cost)
- LLM dedup + merge into a single canonical event

This is how a one-off post ("watch party moved to Bryant Park") propagates through ~20 secondary sources into a confident Event row within ~10 minutes.

### Tier 3 — User-submitted (the long tail)

In-app submission: any signed-in user can submit an event. Lives in `public.user_submitted_events`. Starts at `confidence = 'rumored'`. Promoted to `events` when:

- 2+ independent users submit the same event (auto-promote), OR
- Tier 1 corroborates it (auto-promote), OR
- An admin promotes manually

Cheap, scales with users, and is the only way to capture truly local "BBQ in the park this afternoon" events.

### Tier 4 — Per-query live search (the safety net)

For every user query, the backend ALSO does a per-query web search before returning results. Catches whatever the cron and submissions missed. Cached 15–30 min per (location, time window, purpose) tuple.

This is what makes "I asked at 4pm about tonight" find a watch party that was announced at 3:47pm — even if Tier 1 hasn't polled the mayor's feed yet.

## Cost tiers

| Tier | Sources covered | Monthly cost | "Real-time" feel |
|---|---|---|---|
| **Lean** | RSS + Reddit + per-query live search; no IG/X scraping; user submissions only for the social tail | $50 | Catches civic + news + Reddit + user-reported. Misses Instagram-only announcements. |
| **Curated (recommended)** | Lean + light IG/X polling for ~100 monitored accounts (Apify or ScrapingBee), X API Basic tier | $300–500 | Catches most things. The mayor's IG post propagates within ~15 min. |
| **Aggressive** | Curated + X API Pro for real-time firehose on a watchlist, expanded IG scraping for ~500 accounts | $5K–10K | Approaches "moment by moment." Mayor's tweet propagates within seconds. |
| **Unlimited** | Pay every API at premium tier, run dedicated scrapers across millions of accounts | $50K+/mo | The aspirational "every entity in real time." Realistic only at scale. |

For a Phase 2 (TestFlight + friends) launch, **Lean** is right. For Phase 3 (public launch with paying users), upgrade to **Curated**. **Aggressive** only makes sense if the business is generating real revenue.

## How the heuristic uses it

The 5th signal in `find-spots` (real-time event relevance) reads from `public.events`. The events table is the unified output of all four tiers — Tier 1 cron, Tier 2 widening, Tier 3 user submissions, Tier 4 per-query live search.

Tier 4 results that survive `dedupeByCanonicalKey` against existing rows are upserted, so they benefit future queries too. The system gets smarter over time.

## Anti-spam + quality

Several safeguards prevent the long tail from becoming garbage:

1. **`monitored_entities.trust_weight`** boosts/dampens extracted events by source.
2. **`events.confidence`** = `'rumored'` for single-source, `'likely'` for 2+, `'confirmed'` for primary.
3. **User submissions decay fast** (24h) unless corroborated.
4. **Auto-supersede**: when a new event references a cancelled/moved one, the old event's `supersedes_id` chain keeps history without confusing the live feed.
5. **Per-source rate limiting** in `event_ingest_runs` — if a source returns garbage, we throttle.

## What the user submits decision

Before building, decide:

1. **Which cost tier?** (Lean / Curated / Aggressive)
2. **Which sources matter most?** The seed `monitored_entities` rows are NYC-defaults; if you ever ship to other cities, the seed becomes per-city.
3. **Build user submissions now or later?** It's the cheapest way to widen coverage but adds a small moderation surface area.
