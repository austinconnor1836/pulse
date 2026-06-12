# W4 — Claude judge client

**Branch:** `w4-claude-judge-client` · **Area:** supabase · **DependsOn:** W1 (merged), W2 (merged)
**Status:** specify

## Problem
Four downstream slices need to call Claude — find-spots (W5) for purpose→attributes +
use-case-fit scoring + why-copy generation, ingest-events (W10) for event extraction from
RSS/HTML feeds, enrich-business (W11) for socials + profile extraction. Today the call
sites are TODO comments (`find-spots/index.ts:42`, `ingest-events/index.ts:50`,
`enrich-business/index.ts:77, 99-101`); no shared client exists. This item ships the typed
module so the next slices can plug in.

## Exploration findings (what already exists — do NOT rebuild)
- **`_shared/env.ts:30` exposes `config.anthropicApiKey`** (W1). Naming reconciled in W1:
  AC's `CLAUDE_API_KEY` is implemented as `ANTHROPIC_API_KEY` per SDK convention.
- **`Event` interface lives at `shared/types.ts`** (W2). `extractEvents` returns `Event[]`
  from that contract verbatim.
- **`ScoreBreakdown` interface** also at `shared/types.ts` (W2). `whyCopy` receives this
  shape (already-scored breakdown) plus a candidate.
- **`PlacesCandidate` interface** at `_shared/places.ts` (W3). `scoreUseCaseFit` and
  `whyCopy` take this shape as the input venue.
- **W3 established the shared-client pattern** for `_shared/*.ts` modules:
  - Typed exports + a named error class (mirror `PlacesError` / `ConfigError`)
  - Reads API key via `config.*` from W1
  - `fetchJson` style retry+fixture seam
  - Optional `<MODULE>_FIXTURE_DIR` / `<MODULE>_RECORD_DIR` env vars for zero-quota dev
  - Sibling Deno test file with mocked `globalThis.fetch`
  W4 mirrors this pattern. Same backoff cadence, same fixture layout (under
  `_shared/__fixtures__/claude/`), same `try/finally` test hygiene.
- **enrich-business already documents per-call cost targets** (`enrich-business/index.ts:21-26`):
  Haiku at ~$0.001 (socials) and ~$0.012 (profile, 8K in / 2K out). Those drive model
  selection per-function: cheap Haiku for high-volume extraction, costlier Sonnet for
  the quality-sensitive use-case-fit scoring.
- **`find-spots/SKILL.md`** at `/Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/`
  is the canonical prompt source-of-truth (per AC #3 "prompts are the codification of the
  find-spots SKILL.md spec"). W4 reads from there and codifies the prompts in a single
  `prompts.ts` neighbor for reviewability.
- **claude-api skill exists at `~/.claude/skills/claude-api/`** — the backbone notes say
  "Consult the claude-api skill before implementing." Plan-phase invokes it for current
  model IDs + prompt-caching mechanics + SDK-vs-raw-HTTP guidance.

## Acceptance Criteria Coverage Map

| # | AC fragment (verbatim) | Type | Disposition |
|---|------------------------|------|-------------|
| 1a | "`_shared/claude.ts` exposes `purposeToAttributes(purpose)` → weighted use-case attributes" | Backend | **Demonstrated** — unit test asserts a fixture-mocked Claude response is parsed into a typed `{ attribute, weight }[]` array sorted by weight desc |
| 1b | "`scoreUseCaseFit(purpose, candidate)` → 0..1 fit" | Backend | **Demonstrated** — unit test asserts the response is clamped to `[0, 1]` and `number` typed; out-of-range / non-numeric fixture → 0 with a logged warning |
| 1c | "`whyCopy(purpose, candidate, breakdown)` → one-line rationale" | Backend | **Demonstrated** — unit test asserts the response is trimmed, single-line, ≤ 140 chars (truncated with ellipsis if Claude overshoots) |
| 1d | "`extractEvents(text)` → Event[] for ingestion" | Backend | **Demonstrated** — unit test asserts each parsed object validates against the `Event` shape (W2), invalid items are dropped with a warning, partial-failure does NOT throw |
| 2 | "Calls the Claude API with the current recommended model id and reads CLAUDE_API_KEY from the env helper (W1)" | Backend | **Demonstrated** — unit test: missing `ANTHROPIC_API_KEY` → `ConfigError` from W1's helper; the model-id constant lives in one place and is named (e.g. `MODEL_QUALITY`, `MODEL_CHEAP`) |
| 3a | "Prompts/system messages live in a single place and are the codification of the find-spots SKILL.md spec" | Convention | **Explained** — sibling file `_shared/claude.prompts.ts` exports every system prompt as a `const`. Cite the file in verify; cite the SKILL.md path in each prompt's header comment |
| 3b | "responses are parsed into typed shapes (W2) with validation + graceful fallback on malformed output" | Backend | **Demonstrated** — unit test for each function: malformed JSON / wrong shape → typed fallback (`[]`, `0`, empty string) + warning, never throws |
| 4 | "Token/cost guardrails documented (batch where possible)" | Context | **Explained** — module header + plan.md document: which functions use Haiku vs Sonnet and why, batch strategy for `scoreUseCaseFit` (score N candidates in a single multi-message call so the system prompt + purpose context cache-hits), per-call cost estimate |

## Decisions to confirm (settled by exploration; flagged for plan-phase confirmation)

- **D1 — SDK vs raw HTTPS.** Plan-phase invokes the **`claude-api` skill** for current
  guidance. Default leaning: **raw HTTPS POST to `api.anthropic.com/v1/messages`**, no
  `npm:@anthropic-ai/sdk` import. Reasons: (a) avoids Deno's npm-specifier compatibility
  warts in Edge Functions, (b) matches the W3 pattern (`fetch` + retry seam), (c) the
  Anthropic Messages API is stable and small (5 fields per request). Plan confirms after
  consulting the skill.
- **D2 — Model selection per function.**
  - **Sonnet (current `claude-sonnet-4-6`)** for `scoreUseCaseFit` + `whyCopy` —
    quality-sensitive, low call volume per find-spots request (batched).
  - **Haiku (current `claude-haiku-4-5-20251001`)** for `purposeToAttributes` (simple
    structured extraction) + `extractEvents` (high-volume from ingest cron).
  - Plan confirms current exact model IDs via the skill.
- **D3 — Prompt caching.** Use Anthropic's `cache_control: { type: 'ephemeral' }` on the
  system-prompt block for the per-purpose batch calls (cache lives ~5 min, batched across N
  candidates → ~Nx hit ratio). Plan documents which calls cache.
- **D4 — Batch shape for `scoreUseCaseFit`.** One Claude call per find-spots request scores
  ALL N candidates (≤60 from W3) in a single message, returning `{ candidateId: number }`.
  Caches the system prompt + purpose. Cost-per-find-spots stays bounded regardless of N.
- **D5 — Prompts file.** `_shared/claude.prompts.ts` — exports system + user prompt
  templates as const strings. Each prompt's header comment cites its SKILL.md provenance.
  Mirrors the precedent of `_shared/scoring.ts`'s "Source-of-truth spec" header.
- **D6 — Fixture/replay seam.** `CLAUDE_FIXTURE_DIR` / `CLAUDE_RECORD_DIR` mirroring W3.
  Hash key: `sha256(operation + sortedKeys JSON of {model, messages, system, ...})` first 16.
- **D7 — Graceful fallback shape.**
  - `purposeToAttributes` malformed → `[]`
  - `scoreUseCaseFit` malformed → `0`
  - `whyCopy` malformed → empty string
  - `extractEvents` malformed → drop the invalid item, keep the valid ones; return `[]`
    only on whole-response failure
  Every fallback path emits a `console.warn` with the operation + hash for forensics.

## Requirements

- **R1 (→1a-1d):** `_shared/claude.ts` exports four async functions with the exact
  signatures the AC names. Return types: `Array<{ attribute: string; weight: number }>`,
  `number`, `string`, `Event[]`.
- **R2 (→2, 3a):** Module reads `config.anthropicApiKey` (W1) for the `x-api-key` header;
  `class ClaudeError extends Error { operation, status, body }` mirrors `PlacesError`.
  Model IDs live in named constants (`MODEL_QUALITY`, `MODEL_CHEAP`) — value confirmed by
  the claude-api skill at plan-phase.
- **R3 (→3a):** `_shared/claude.prompts.ts` exports every system + user prompt as a const.
  Each carries a header comment citing the SKILL.md provenance.
- **R4 (→3b):** Each public function wraps the API call in a try/parse/validate. Malformed
  output triggers the typed fallback (D7) + a warning, never an unhandled throw.
- **R5 (→2, 4):** Same `[1s, 4s]` backoff on 429/5xx as W3's `fetchJson` (consider
  extracting if the pattern reads cleanly; otherwise re-implement — flag for plan-phase).
  Final failure throws `ClaudeError`.
- **R6 (→D6):** `CLAUDE_FIXTURE_DIR` / `CLAUDE_RECORD_DIR` env vars enable zero-quota
  development. Hash key keeps fixtures stable.
- **R7 (→1a-1d, 3b):** Deno test sibling at `_shared/claude.test.ts` covering each
  function's happy path, malformed-output fallback, and one error-path (401/429), mocking
  `globalThis.fetch` per-test.

## Story-local rules (resolved decisions)
- Module lives at `supabase/functions/_shared/claude.ts` — convention.
- Header comment: 5-line purpose + spec link + "never logs API key or full prompts" note.
- Tests use `https://deno.land/std@0.224.0/assert/mod.ts` (same pin as W1/W2/W3).
- Prompts file is named `claude.prompts.ts` (sibling, dot-namespaced) — mirrors
  `scoring.parity.test.ts` (which uses the same `<module>.<kind>.ts` style).
- Errors typed as `class ClaudeError extends Error` with `operation`, `status`, `body`.

## Resolved Questions
- *Module location?* → `supabase/functions/_shared/claude.ts` (convention).
- *Prompts inline or sibling file?* → Sibling `claude.prompts.ts` (D5).
- *Fixture/replay envvar names?* → `CLAUDE_FIXTURE_DIR` / `CLAUDE_RECORD_DIR` (D6).
- *Graceful fallback on malformed responses?* → Typed empty/zero per-function (D7).

## Open product/UX questions
- None — this is a backend client. The prompts that this codifies were already specified in
  the find-spots / plan-day / ingest-events SKILL.md docs.

## Plan-phase confirmations (claude-api skill consult)
At plan-phase the `claude-api` skill confirms:
1. Current exact model IDs for Sonnet + Haiku (D2).
2. Recommended request shape for prompt caching (`cache_control` block placement) (D3).
3. SDK-vs-raw-HTTP recommendation for Deno (D1).

## Out of scope
- Streaming responses — find-spots returns non-streaming today; not yet a UX need.
- Tool use / function calling — neither find-spots nor ingest-events needs it.
- Vision (image input) — not in any caller's plan.
- Batch API — Anthropic's batch endpoint is for large async jobs; per-request batching
  inside `scoreUseCaseFit` (D4) covers cost. Listed as a follow-up for a future ingest
  cron if volume requires it.
- Per-call cost telemetry — Phase-3 concern per docs/realtime-ingestion.md.
