# supabase

Edge Functions, migrations, and shared modules for pulse's backend.

For project-level config + secrets see the root [README.md](../README.md) §
**Config & secrets** (added by W1).

## Layout

- `functions/` — Deno Edge Functions (one dir per route + `_shared/` helpers).
- `migrations/` — SQL migrations; sourced by `supabase db push` / `supabase db reset`.
- `config.toml` — Supabase CLI config (local ports, auth, per-function `verify_jwt`).
- `.env.example` — every required secret name + the local/prod flow (W1).

## Shared modules (`functions/_shared/`)

| Module | Owner slice | Purpose |
|---|---|---|
| `env.ts` | W1 | Typed config + `requireEnv`/`optionalEnv` + `ConfigError`. |
| `cors.ts` | scaffold | CORS headers all functions reuse. |
| `scoring.ts` | W2 | 5-signal scoring math, mirror of `Scoring.kt`. |
| `places.ts` | W3 | Google Places client — text search + distance matrix. |
| `claude.ts` | W4 | Claude judge client — purpose→attributes, use-case fit, why-copy, event extraction. |
| `claude.prompts.ts` | W4 | System prompts (codification of find-spots / ingest-events SKILL.md). |
| `events.ts` | W7 | Events query layer — PostGIS KNN reads + canonical-key upserts. Shared by find-spots, events-feed, ingest-events. |

## Events query layer

`_shared/events.ts` (W7) is the single owner of the events read/write SQL. PostGIS KNN +
time-window filtering live in the `public.nearby_events` SQL function (migration
`00000000000008_nearby_events_function.sql`); the TS helper is a thin wrapper plus the
W2-`Event`-shape ↔ row mapping. Helpers take a `SupabaseClient` parameter, so the caller
picks the credential level: find-spots/events-feed pass their user-JWT-forwarded anon
client; ingest-events (cron) passes a service-role client.

```ts
import { nearbyEvents, upsertEvents } from '../_shared/events.ts';

const events = await nearbyEvents(supabase, { lat, lng }, /*radius_m*/ 800, {
  startISO: now,
  endISO: in1h,
});

const { upserted, errors } = await upsertEvents(serviceRoleClient, extractedEvents);
```

Reads throw `EventsQueryError` on RPC failure. Upserts return `{upserted, errors}` —
partial-batch failures don't throw, matching the cron pattern.

## Claude fixture/replay

`_shared/claude.ts` (W4) wraps the `@anthropic-ai/sdk` (loaded via `npm:`). Two optional
env vars let you develop without burning live quota:

```sh
# Replay cached assistant text (zero quota, zero network):
CLAUDE_FIXTURE_DIR=$(pwd)/supabase/functions/_shared/__fixtures__/claude \
  supabase functions serve --env-file supabase/.env

# Capture live responses (paired with a real key):
ANTHROPIC_API_KEY=… \
CLAUDE_RECORD_DIR=$(pwd)/supabase/functions/_shared/__fixtures__/claude \
  supabase functions serve --env-file supabase/.env
```

Cache key: `sha256(operation + sorted-keys JSON of {model, system, user, maxTokens})` →
first 16 hex chars → `<hash>.json` under the fixture dir. Files store the assistant's
text content verbatim (one block per JSON value, no envelope).

Tests in `claude.test.ts` use a different seam — they substitute the SDK call via
`__setCallTextForTest` rather than the fixture path, because the Anthropic SDK in Deno
does not route through `globalThis.fetch` so HTTP-level stubbing has no effect.

**Model selection (W4 D2):**
- `MODEL_QUALITY = 'claude-opus-4-7'` — `scoreUseCaseFit`, `whyCopy` (quality-sensitive, low call volume).
- `MODEL_CHEAP = 'claude-haiku-4-5'` — `purposeToAttributes`, `extractEvents` (high volume, structured extraction).

**Prompt caching:** every call sets `cache_control: {type: 'ephemeral'}` on the system
block. Caching pays off mainly for `scoreUseCaseFit` (system + purpose stable across N
candidates), and across repeated find-spots calls with the same purpose. Verify hits via
`response.usage.cache_read_input_tokens`. The Opus 4.7 / Haiku 4.5 minimum cacheable
prefix is 4096 tokens — short prompts silently won't cache.

## Places fixture/replay

`_shared/places.ts` (W3) is the typed Google Places client. Two optional env vars let you
develop and test without burning live quota:

```sh
# Replay cached responses (zero quota, zero network):
PLACES_FIXTURE_DIR=$(pwd)/supabase/functions/_shared/__fixtures__/places \
  deno test --allow-env --allow-read supabase/functions/_shared/places.test.ts

# Capture live responses on first run (paired with the real key):
GOOGLE_PLACES_API_KEY=… \
PLACES_RECORD_DIR=$(pwd)/supabase/functions/_shared/__fixtures__/places \
  deno run --allow-env --allow-net --allow-write your-driver.ts
```

Cache key: `sha256(operation + JSON.stringify(request, sortedKeys))` → first 16 hex chars
→ `<hash>.json` under the fixture dir. Commit the fixture files when you want a
deterministic replay for CI or a teammate.

The `places.test.ts` suite stubs `globalThis.fetch` directly and does not need the fixture
seam — it covers shape, pagination, batching, and the 429-backoff path with zero disk I/O.

## Running locally

```sh
supabase start                          # boots Postgres + Auth + Studio
supabase functions serve --env-file .env # serves all functions from .env
```

See root README for the per-platform client config (iOS Config.local.xcconfig, Android
local.properties).
