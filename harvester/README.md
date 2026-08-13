# harvester — free things to do (W19)

The **entire backend** for Pulse's "free things to do today/tomorrow" feature, and it costs **$0 to run**.

- A single Node script (`harvest.mjs`) — no database, no Claude, no Google Places, no server.
- Pulls **structured** free-events sources (deterministic parsing → zero per-run API cost):
  - **Eventbrite** date-scoped free pages (`/d/{state}--{city}/free--events--today|tomorrow|this-weekend/`), parsed from the page's `window.__SERVER_DATA__` blob.
  - **Localist** civic/university calendars (`/api/2/events`) — Omaha uses UNO's.
- Writes `output/{city}.json` (today + tomorrow free events + evergreen always-free spots).
- A **GitHub Actions cron** (`.github/workflows/harvest.yml`, free) runs it twice daily and commits the JSON. The app fetches it from `raw.githubusercontent.com` — a free CDN, no running server.

## Run locally
```bash
node harvest.mjs omaha
cat output/omaha.json
```

## Add a city
Drop a `cities/{id}.json` (see `cities/omaha.json`): `state`, `tz`, `center` lat/lng, `localistBases`, and a curated `evergreen` list. The cron picks it up automatically.

## Why this shape
"Free things to do" is decentralized and mostly free-to-source if you stick to structured feeds. Serving a pre-harvested static JSON (refreshed on a cron) is the simplest architecture that is genuinely $0 and needs no backend runtime — see `../specs/W19-free-things-omaha/spec.md` and `/Users/austin/Developer/free-things/STRATEGY.md` for the full sourcing strategy.

## Not here (deliberately)
Live web-search fallback, LLM extraction of unstructured long-tail, OSM/registry venue discovery, and multi-source dedup live in the broader strategy but are out of scope for this simplest-free slice.
