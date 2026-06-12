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
