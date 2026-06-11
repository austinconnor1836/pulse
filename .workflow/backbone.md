# pulse — workflow backbone

Source of truth: [`backbone.json`](backbone.json). This index is generated for human review by
`/create-work-items`; the JSON is what `/sprint-pulse` reconciles and `/spec-driven-workflow`
drives. **Don't hand-edit the JSON's in-flight items** — re-run the skills.

- **Project:** pulse · **Main branch:** `main` · **Repos:** ios · android-app · shared · supabase
- **17 vertical slices · 5 parallelization waves**
- Backend Edge Functions are all stubbed (return empty); migrations + KMP scoring/types exist.
- **Prerequisite to parallelize:** `pulse` is not yet a git repo — `git init` + first commit is
  required before worktrees.

## Items

| id | title | area | dependsOn | wave |
|----|-------|------|-----------|------|
| W1 | Secrets & config plumbing | supabase + clients | — | 0 |
| W2 | TS↔Kotlin types + scoring contract | shared | — | 0 |
| W3 | Google Places client (text search + distance) | supabase | W1 | 1 |
| W4 | Claude judge client (purpose→attrs, fit, why) | supabase | W1 | 1 |
| W7 | Events query layer (PostGIS KNN) | supabase | W2 | 1 |
| W9 | log-interaction function (feedback write) | supabase | W1, W2 | 1 |
| W12 | import-business-registries cron | supabase | W1 | 1 |
| W14 | Auth: Supabase magic link (JWT swap) | shared/ios/android | W1 | 1 |
| W15 | KMP XCFramework wiring for iOS | shared/ios | W2 | 1 |
| W5 | find-spots Edge Function (hybrid pipeline) | supabase | W2, W3, W4, W7 | 2 |
| W8 | events-feed Edge Function (read + live fallback) | supabase | W4, W7 | 2 |
| W10 | ingest-events cron (poll → extract → upsert) | supabase | W4, W7 | 2 |
| W11 | enrich-business cron (finish) | supabase | W3, W4 | 2 |
| W6 | plan-day Edge Function (slots + constraints) | supabase | W5 | 3 |
| W13 | pg_cron schedule + ingest-secret wiring | supabase | W10, W11, W12 | 3 |
| W16 | iOS: wire Find Spots + Plan Day to live backend | ios | W5, W6, W14, W15 | 4 |
| W17 | Android: 2-tab rewrite + wire to backend | android-app | W5, W6, W14 | 4 |

## Parallelization waves

A wave's items have all dependencies satisfied by earlier waves, so every item in a wave can be
built **concurrently** in its own worktree.

- **Wave 0 (2):** W1, W2 — foundations, nothing blocks them. Do these first.
- **Wave 1 (7):** W3, W4, W7, W9, W12, W14, W15 — the widest parallel front. All `supabase` ones
  touch different `_shared/*` files, so no edit conflicts; W14/W15 are client-side and fully
  independent.
- **Wave 2 (4):** W5, W8, W10, W11 — core backend features over the wave-1 clients.
- **Wave 3 (2):** W6 (over find-spots), W13 (over the three crons).
- **Wave 4 (2):** W16, W17 — client wiring once the functions + auth exist.

## Next action

1. `git init` + first commit (one-time; required for worktrees).
2. Drive wave-0 first: `/spec-driven-workflow W1` and `/spec-driven-workflow W2` (each in its own
   worktree). They unblock the 7-item wave-1 front.
3. Use `/sprint-pulse` on resume to re-check what's available; `/check-deps` to rebase stacked
   items when a dependency merges.
