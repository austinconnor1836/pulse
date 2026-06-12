# W4 — Plan

**Branch:** `w4-claude-judge-client` · **Builds on:** `spec.md`

## claude-api skill consult (spec D1–D3 resolved)

Per the `claude-api` skill:

1. **D1 reversed — use the official SDK, not raw HTTP.** `import Anthropic from "npm:@anthropic-ai/sdk"`. The skill's rule: default to the official SDK whenever one exists for the project's language; Deno Edge Functions support npm specifiers cleanly. The W3 raw-fetch pattern doesn't carry over — the SDK gives us typed responses, prompt-caching primitives, automatic retries, and request-id tracking. **The shared retry/fixture seam is W4-specific:** the SDK already retries 429/5xx, so we wrap calls with a fixture/replay layer only — no manual backoff loop.
2. **D2 confirmed — model IDs:**
   - `MODEL_QUALITY = 'claude-opus-4-7'` for `scoreUseCaseFit` + `whyCopy` (quality-sensitive; low call volume).
   - `MODEL_CHEAP = 'claude-haiku-4-5'` for `purposeToAttributes` + `extractEvents` (high-volume; structured extraction). Matches `enrich-business/index.ts:21-26`'s documented Haiku usage at ~$0.001-0.012/call. Use the bare alias — never append date suffixes.
3. **D3 refined — prompt caching placement.**
   - Top-level `cache_control: {type: 'ephemeral'}` on each `messages.create()` call — auto-places on the last cacheable block.
   - Order content as: **stable system prompt → stable purpose/context → volatile per-candidate input**. The auto-cache breakpoint then sits at the end of the stable prefix.
   - Minimum cacheable prefix: 4096 tokens for Opus 4.7 / Haiku 4.5, 2048 for Sonnet 4.6. Our system prompts are unlikely to clear that bar alone; caching pays off mainly for `scoreUseCaseFit`'s batched calls (system + purpose + N candidates) where the system + purpose prefix is reused across many requests with the same purpose.
   - Verify via `response.usage.cache_read_input_tokens`. Test asserts cache stats are exposed.

## Module structure

```ts
// _shared/claude.ts
export interface UseCaseAttribute { attribute: string; weight: number }
export class ClaudeError extends Error { operation, status, body, requestId }
export async function purposeToAttributes(purpose): Promise<UseCaseAttribute[]>
export async function scoreUseCaseFit(purpose, candidates): Promise<Map<string, number>>
export async function whyCopy(purpose, candidate, breakdown): Promise<string>
export async function extractEvents(text): Promise<Event[]>

// _shared/claude.prompts.ts
export const PURPOSE_TO_ATTRIBUTES_SYSTEM = ...
export const SCORE_USE_CASE_FIT_SYSTEM = ...
export const WHY_COPY_SYSTEM = ...
export const EXTRACT_EVENTS_SYSTEM = ...

// Internal:
function client()                                              // SDK instance, lazy
async function callJson<T>(operation, args): Promise<T>        // fixture + parse + fallback
function tryParseJson(text, fallback)                          // graceful parse
```

`callJson` is the single seam: it handles fixture/replay (just like W3's `fetchJson`), invokes `client.messages.create({...})`, extracts the first text block, parses JSON, and returns the typed result or the typed fallback (D7) on malformed output. Per-function code stays declarative.

## Approach
Three commits, ordered.

### Change 1 — Prompts (`_shared/claude.prompts.ts`)
Single file with four exported system-prompt constants. Each carries a header comment citing its SKILL.md provenance:

```ts
// PURPOSE_TO_ATTRIBUTES_SYSTEM — see find-spots/SKILL.md § "Purpose → attributes"
export const PURPOSE_TO_ATTRIBUTES_SYSTEM = `...`;
```

Prompts return strict JSON (per D7 + AC #3b graceful-fallback contract). For W4 ship, the prompts are intentionally minimal — they encode the contract (output shape, scoring scale, single-line constraint) but lean on Claude's instruction-following rather than few-shot examples. Tuning happens once we have real find-spots traffic.

### Change 2 — Core module (`_shared/claude.ts`)
- Imports: `Anthropic from 'npm:@anthropic-ai/sdk'`, `config from './env.ts'`, prompts from `./claude.prompts.ts`, types from `../../../shared/types.ts`.
- `UseCaseAttribute` interface; `ClaudeError` class with `operation`, `status`, `body`, `requestId` (`requestId` lifted from SDK's `response._request_id` for forensics).
- Model constants: `MODEL_QUALITY = 'claude-opus-4-7' as const`, `MODEL_CHEAP = 'claude-haiku-4-5' as const`.
- `client()`: returns a singleton `new Anthropic({ apiKey: config.anthropicApiKey })`. Lazy so importing the module without a key doesn't throw.
- `callJson<T>(operation, args, fallback): Promise<T>`:
  1. If `CLAUDE_FIXTURE_DIR` set + hash file present → return cached parsed JSON.
  2. Else `await client().messages.create({...})`, passing the SDK's `max_retries` (default 2) so 429/5xx is handled by the SDK.
  3. Extract first `text` content block; if none, return `fallback` + `console.warn`.
  4. `JSON.parse` the text; on success, optionally write to `CLAUDE_RECORD_DIR`; return.
  5. On parse failure, return `fallback` + `console.warn` with `operation + hash`.
  6. SDK exceptions (after retries) → throw `ClaudeError(operation, status, body, requestId)`. We do NOT wrap the SDK's retry — it already handles 429 + 5xx with backoff.
- `purposeToAttributes(purpose)`:
  - Top-level `cache_control: {type: 'ephemeral'}` on the request.
  - System: `PURPOSE_TO_ATTRIBUTES_SYSTEM`. User: the purpose text.
  - Model: `MODEL_CHEAP`. `max_tokens: 512`.
  - Fallback: `[]`.
- `scoreUseCaseFit(purpose, candidates)`:
  - Top-level `cache_control: {type: 'ephemeral'}`.
  - System: `SCORE_USE_CASE_FIT_SYSTEM`. User: purpose first, then the candidate list serialized as `[{id, name, attributes?}]` JSON — this ordering keeps the system + purpose prefix stable across requests with the same purpose so caching can fire.
  - Model: `MODEL_QUALITY`. `max_tokens: 1024`.
  - Returns `Map<candidateId, number>` clamped to `[0, 1]`. Missing candidates → fallback `0` per ID.
  - **Batch by design (D4):** one call scores N candidates ≤ 60.
- `whyCopy(purpose, candidate, breakdown)`:
  - Top-level `cache_control: {type: 'ephemeral'}`.
  - System: `WHY_COPY_SYSTEM`. User: structured payload with purpose + candidate + breakdown.
  - Model: `MODEL_QUALITY`. `max_tokens: 128`.
  - Returns the first non-empty line, trimmed, truncated to 140 chars with `…`.
  - Fallback: empty string.
- `extractEvents(text)`:
  - Top-level `cache_control: {type: 'ephemeral'}`.
  - System: `EXTRACT_EVENTS_SYSTEM`. User: the raw text.
  - Model: `MODEL_CHEAP`. `max_tokens: 4096`.
  - Validates each parsed item against the `Event` shape (W2 types). Invalid items are dropped with a warning; valid ones returned. Whole-response failure → `[]`.

### Change 3 — Tests (`_shared/claude.test.ts`)
Same `withMockedFetch` pattern as W3, but mock the `fetch` that the SDK uses internally. Eight cases:

1. **`purposeToAttributes` happy path** — mock response with `[{attribute, weight}]` JSON → returns typed array sorted by weight desc.
2. **`purposeToAttributes` malformed → `[]`** — mock returns garbage → typed empty array + warning.
3. **`scoreUseCaseFit` clamps to [0, 1]** — mock returns `{id: 1.5}` and `{id: -0.3}` → Map values `1` and `0`.
4. **`scoreUseCaseFit` malformed → fallback `0` per candidate** — mock returns garbage → Map of `id → 0` for every input candidate.
5. **`whyCopy` truncates to 140 chars with ellipsis** — mock returns a 200-char string → returns first 140 chars + `…`.
6. **`whyCopy` malformed → empty string** — mock returns `undefined` text block → `''`.
7. **`extractEvents` drops malformed items, keeps valid ones** — mock returns 3 items: valid Event, missing required field, valid Event → returns 2 events.
8. **Missing `ANTHROPIC_API_KEY` → `ConfigError`** — clear env, call any function → throws `ConfigError` from W1's helper.

Backoff retries are the SDK's responsibility; we don't re-test that.

## Files touched

| Path | Action |
|------|--------|
| `supabase/functions/_shared/claude.prompts.ts` | create |
| `supabase/functions/_shared/claude.ts` | create |
| `supabase/functions/_shared/claude.test.ts` | create |
| `supabase/functions/_shared/__fixtures__/claude/.keep` | create |
| `supabase/README.md` | edit (add "Claude fixture/replay" section mirroring Places) |

No changes to `find-spots/index.ts`, `enrich-business/index.ts`, `ingest-events/index.ts` — W4 ships the helper; W5/W10/W11 plug it in.

## Constitution Check

| # | Principle | Status |
|---|-----------|--------|
| I | **Vertical slice.** | ✓ Single concern — Claude client + prompts + test + docs. |
| II | **Convention before invention.** | ✓ Module at `_shared/claude.ts` mirrors W3 layout. Error type mirrors `PlacesError`/`ConfigError`. Test version pin matches W1/W2/W3. SDK choice per claude-api skill directive. |
| III | **AC are the contract.** | ✓ Every Coverage Map fragment maps to a Change. |
| IV | **Fail loud at boundaries.** | ✓ Missing env → `ConfigError`. API non-OK after SDK retries → `ClaudeError`. Malformed responses → typed fallback + `console.warn` (not silent — and not a throw, per AC #3b). |
| V | **No speculative scope.** | ✓ Four functions, four prompts. No streaming, tool use, batch API, or telemetry — explicitly out of scope. |
| VI | **No duplication of working code.** | ✓ Single `callJson` seam. We do NOT reimplement W3's retry — the SDK retries; we only add the fixture layer. |
| VII | **Errors are typed.** | ✓ `ClaudeError extends Error` carries operation/status/body/requestId. |
| VIII | **No commented-out code.** | ✓ Net-new. |
| IX | **Tests where they catch real bugs.** | ✓ Eight cases each test a real failure mode (malformed JSON parse, clamping, truncation, missing env). |
| X | **Isolate classes of change.** | ✓ Three commits: prompts, core, tests/docs. |
| XI | **No speculative version bumps.** | n/a. |

## Risks
- **SDK + Deno npm import surface area.** `npm:@anthropic-ai/sdk` works in Supabase Edge Functions today, but the SDK is large. If Deno's npm resolver chokes on a transitive dep, fallback is raw HTTPS POST to `api.anthropic.com/v1/messages` (the spec's D1-default before the skill consult).
- **Caching minimum prefix.** Our system prompts may not clear 4096 tokens on Opus 4.7. If `cache_read_input_tokens` stays zero in production, that's expected for the small-prompt path and is not a bug. The test asserts the field is *exposed*, not that it's positive.
- **Prompt drift from SKILL.md.** Prompts are the codification of the find-spots SKILL.md spec; as that spec evolves, this file is the bump point. AC #3a's "single place" guarantee makes drift easy to catch.

## Next phase
Tasks. Then pre-implement confirm.
