# ContextWeave Field Review: Kuvio Website Builder

**Date:** 2026-03-17
**ContextWeave Version:** 0.1.0 (package metadata; `cw_status()` did not expose version)

Review method: MCP transport was not exposed in this Codex session, so I executed the real registered ContextWeave tool handlers directly against this repo's persisted `.contextweave` index. This exercised the actual `cw_*` tool logic and output format.

## Project Profile

| Metric | Value |
|--------|-------|
| Project | Kuvio Website Builder |
| Stack | Next.js App Router, React, TypeScript/TSX, Supabase, Zustand, Tailwind |
| Lines of Code | 96,209 |
| Source Files | 545 |
| Symbols Indexed | 3,275 |
| Languages | tsx, typescript, markdown, javascript, json, yaml, bash |
| Index Time | Not exposed by `cw_status()`; existing root index was already present and reported 1 stale file |
| Architecture | Next.js app with client-side feature pages, `lib/dataLayer.ts` abstraction over Zustand mock state vs Supabase live data, API routes for server-side actions |
| Key Directories | `kuvio/src/app`, `kuvio/src/features`, `kuvio/src/lib`, `kuvio/src/components` |

## Task-Based Results

### Task A: Understand `updateSite` end to end

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 6,866 | 1,397 |
| Tool calls | 11 | 5 |
| Completeness | Complete | Complete |
| Time to correct answer | ~6.7s | <0.1s |

**What ContextWeave found:** The initial capsule immediately surfaced the real Supabase `updateSite` function, the Zustand store variant, the data-layer wrapper, and `cw_impact("updateSite")` produced a useful blast-radius map across site-edit and dashboard pages.
**What ContextWeave missed:** The indexed line span for `lib/supabase/queries.ts:updateSite` was stale and wrong. `cw_read(symbol: "lib/supabase/queries.ts:updateSite")` landed on `getSiteBySlug`, and even `cw_read(path + capsule lines)` landed on the wrong code until I recovered the actual definition with `cw_grep("updateSite")`. `cw_grep` exact ranking also put an interface signature and consumer code ahead of the real definition.
**Follow-up suggestions useful?** No. The capsule gave no useful `cw_read` follow-ups, and the exact-symbol read path was actively misleading.
**Winner:** Grep+Read

### Task B: Trace public inquiry submission from UI to API to DB/email

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 10,954 | 4,216 |
| Tool calls | 9 | 5 |
| Completeness | Complete | Complete |
| Time to correct answer | ~6.1s | <0.1s |

**What ContextWeave found:** `cw_flow("handleSubmit")` successfully bridged the UI handler to `submitPublicInquiry` and then across the HTTP boundary to the `POST` route. Targeted `cw_read()` calls recovered the full route logic once the right files were known.
**What ContextWeave missed:** The main capsule was awful. It led with `WorkspacePages.tsx`, `NewsprintLayout.tsx`, `siteCompleteness.ts`, and `components/ui/table.tsx` instead of the real flow files. `cw_flow` then collapsed into `createClient` and `createAdminClient` noise instead of following validation, rate limiting, DB insert, owner notification, and auto-response branches. The follow-up suggestions were also wrong.
**Follow-up suggestions useful?** No. The suggested next reads were unrelated, and the real recovery came from manual `cw_overview`/`cw_grep`.
**Winner:** Grep+Read

### Task C: Explain how the app switches between Zustand mock mode and Supabase live mode

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 18,053 | 6,303 |
| Tool calls | 9 | 5 |
| Completeness | Complete | Complete |
| Time to correct answer | ~5.8s | <0.1s |

**What ContextWeave found:** `cw_overview("useDataLayer useSiteDataLayer supabaseConfigured evictSitesCache")`, `cw_grep(...)`, and `cw_impact("useDataLayer")` eventually exposed the real architecture: `supabaseConfigured = isSupabaseEnabled()`, `useDataLayer` / `useSiteDataLayer` pick live vs store-backed mutations, `useSites` / `useSite` own the caches, and `AuthProvider` invalidates caches on auth changes.
**What ContextWeave missed:** The main capsule for the actual architectural question was decisively wrong. It spent 2,408/2,600 tokens on middleware, admin client helpers, RBAC tests, and a huge sweep of `queries.ts`, while barely touching `dataLayer.ts` or `supabase/hooks.ts`. Worse, it paired that bad retrieval with `Confidence: MEDIUM | Uncertainty: VERY_LOW`, which was not earned.
**Follow-up suggestions useful?** No. The useful path came from replacing the original query with exact architectural terms; the capsule itself did not route me there.
**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 35,873
- Total Grep+Read tokens across 3 tasks: 11,916
- Actual savings: -201.0% (ContextWeave used about 3.0x the tokens)

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `submitPublicInquiry` | Yes | Nothing; both capsule and `cw_grep` put the definition first |
| `useDataLayer` | Yes | Nothing in exact ranking; consumer imports followed behind the definition |
| `updateSite` | No | `cw_grep("updateSite")` put the `SitesState.updateSite` interface and multiple consumer usages ahead of the real definition; the capsule's top definition also carried stale line metadata |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `state management` | HIGH | 1597/2000 | No — it mostly returned `ErrorBoundary`, empty states, and store/interface noise instead of the actual state-management architecture |
| `How does the app switch between Zustand mock mode and Supabase live mode across the data layer? ...` | MEDIUM / VERY_LOW uncertainty | 2408/2600 | No — the answer centered on middleware/admin client plumbing and missed `dataLayer.ts` as the actual abstraction boundary |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `state management` | 8000 | 2721 | 34.0% |
| `public inquiry flow` | 8000 | 1643 | 20.5% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `updateSite` | No | No | It found the data-layer wrapper and cache helpers but missed the core `dbUpdateSite -> lib/supabase/queries.ts` call |
| `handleSubmit` | No | Yes | It bridged `handleSubmit -> submitPublicInquiry -> POST`, but then devolved into repeated `createClient` / `createAdminClient` branches and never traced validation, rate limiting, DB insert, or email work |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `data layer architecture` | 3 | Returned page metadata routes and docs instead of `dataLayer.ts` / `supabase/hooks.ts` |
| `cw_recall` | `data layer architecture` | 2 | Mostly replayed bad prior capsules and passive garbage like repeated `supabase` tokens |
| `cw_impact` | `useDataLayer` | 8 | Good consumer graph across feature pages and route entries; the strongest tool in this review |
| `cw_stats` | `session_id=review-2026-03-17-taskC` | 1 | Claimed 2,408 tokens and 100% first-pass for a session that actually consumed 18,053 tokens and required heavy follow-up recovery |

## Flaws Found

Ordered by severity. Each flaw includes what happened, why, and how to fix it.

### P0 (Critical — blocks adoption)
1. **Broad capsules miss the real code path and still ask for trust**: Task B and Task C both started with capsules that ignored the actual target files and centered on junk like `WorkspacePages.tsx`, `NewsprintLayout.tsx`, middleware, admin client helpers, and giant `queries.ts` sweeps. That breaks the product promise because the first call is supposed to replace grep, not require recovery after grep-like searching. Root cause is likely query-intent/ranking/packing in [`src/capsule/generator.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/generator.ts), [`src/capsule/scorer.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/scorer.ts), and confidence logic in [`src/capsule/confidence.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/confidence.ts). Fix by adding code-intent routing that downranks decorative UI/docs/tests for code-understanding queries and requires task-path coverage before returning medium/high confidence.
2. **Stale symbol spans can send the agent to the wrong code**: `updateSite` was retrieved as the top definition, but the capsule said `lib/supabase/queries.ts:520-569` and `cw_read(symbol: "lib/supabase/queries.ts:updateSite")` landed on `getSiteBySlug`. The real definition starts at line 591. Once a symbol points at the wrong lines, the tool is no longer safe to trust for coding work. Root cause is likely stale line metadata handling between indexing and read resolution in [`src/core/indexer.ts`](/Users/aejjusingh/Developer/ContextWeave/src/core/indexer.ts) and [`src/mcp/tools/read.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/read.ts). Fix by validating symbol spans against current file contents before returning them, surfacing stale-file paths explicitly, and auto-reindexing touched files instead of quietly serving stale ranges.
3. **`cw_flow` does not trace the execution path developers actually care about**: It can bridge `handleSubmit -> submitPublicInquiry -> POST`, but then it mostly emits duplicated `createClient` / `createAdminClient` branches and misses validation, rate limiting, inserts, and email delivery. For `updateSite`, it misses the key `dbUpdateSite` hop entirely. Root cause is likely edge prioritization and traversal logic in [`src/mcp/tools/flow.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/flow.ts): after a framework or import edge it keeps chasing constructor/import noise instead of in-body call edges. Fix by prioritizing concrete call-site edges inside the traced function body, deduplicating equivalent paths, and treating cache/helper imports as lower-value than actual business-logic calls.

### P1 (Important — degrades quality)
1. **Confidence calibration is inconsistent and sometimes dishonest**: `state management` came back `HIGH` while focusing on `ErrorBoundary`, empty states, and unrelated UI scaffolding. The data-layer architecture query came back `MEDIUM` with `VERY_LOW` uncertainty while missing `dataLayer.ts` as the core answer. Root cause is likely confidence being computed from internal retrieval metrics instead of task-path correctness in [`src/capsule/confidence.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/confidence.ts). Fix by tying confidence to answer coverage on required entities and penalizing off-topic file classes heavily.
2. **`cw_stats` undercounts real session cost badly enough to be misleading**: For Task C, `cw_stats(session_id="review-2026-03-17-taskC")` reported 2,408 tokens and 100% first-pass. The actual ContextWeave outputs for that task totaled 18,053 tokens and required 8 non-capsule follow-ups. Root cause is almost certainly that [`src/mcp/tools/stats.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/stats.ts) only counts `capsule_log` and ignores `cw_read`, `cw_grep`, `cw_flow`, `cw_overview`, and recovery work. Fix by tracking every tool's output tokens per session or renaming the metric to `capsule_tokens_only` and dropping first-pass claims derived from it.
3. **`cw_overview` is weak on architectural concepts**: `cw_overview("data layer architecture")` returned page metadata routes and docs instead of the live/mock data-layer boundary. That makes it a poor architectural orientation tool unless the query already names exact symbols. Root cause is likely lexical file-summary search in [`src/mcp/tools/overview.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/overview.ts) and summary content limits in [`src/core/file-summaries.ts`](/Users/aejjusingh/Developer/ContextWeave/src/core/file-summaries.ts). Fix by enriching summaries with hook names, environment gates, imported abstractions, and caller patterns, then ranking architecture queries against those features.
4. **Budget utilization is far below useful levels on hard queries**: The 8000-token stress tests used only 34.0% (`state management`) and 20.5% (`public inquiry flow`) of available budget. The model is leaving obvious recall headroom unused while still missing the answer. Root cause is likely conservative packing/backfill in [`src/capsule/packer.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/packer.ts) and fallback selection in [`src/capsule/content-fallback.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/content-fallback.ts). Fix by backfilling coherent same-story files until either the budget is meaningfully used or confidence materially rises.

### P2 (Moderate — papercut)
1. **`cw_status()` source-directory warning is wrong at repo-root scope**: It warned that `100%` of indexed files were from non-source directories even though 542 of 544 indexed files are under `kuvio/` and most real code is under `kuvio/src`. The heuristic only understands repo-relative prefixes like `src/`, `lib/`, `app/`, `packages/`, so monorepo/subproject roots get mislabeled. Root cause is the hard-coded prefix check in [`src/mcp/tools/status.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/status.ts). Fix by deriving source roots from the actual active roots/profile, not assuming the project root is the app root.
2. **`cw_recall` mostly amplifies previous bad retrieval instead of preserving durable knowledge**: The memory results for `data layer architecture` mostly replayed garbage like repeated `supabase` tokens and prior wrong capsules. Root cause is likely observation capture/promotion in [`src/memory/observations.ts`](/Users/aejjusingh/Developer/ContextWeave/src/memory/observations.ts) plus search ranking in [`src/memory/search.ts`](/Users/aejjusingh/Developer/ContextWeave/src/memory/search.ts). Fix by promoting only validated observations and weighting compact human-meaningful notes above passive auto-captured token dumps.
3. **Exact-string search for common names still behaves like text search, not symbol search**: `cw_grep("updateSite")` ranked an interface field and consumer sites above the actual definition. That makes common-name workflows brittle, especially when the capsule's definition span is stale. Root cause is in exact-match handling and result ranking in [`src/mcp/tools/search.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/search.ts). Fix by optionally grouping exact symbol definitions before usages when the query is identifier-shaped.

## What Worked Well

- `cw_impact` is genuinely useful. `cw_impact("updateSite")` and `cw_impact("useDataLayer")` quickly exposed caller/consumer surfaces across feature pages and route entries.
- Exact symbol lookup is decent when the symbol is distinctive. `submitPublicInquiry` and `useDataLayer` both landed on the right definition immediately.
- `cw_flow("handleSubmit")` crossing from a React handler into the `POST` route is a real capability. It is incomplete, but the boundary inference itself is valuable.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 5 |
| Broad recall (found all relevant files) | 2 |
| Budget utilization (% of budget used) | 2 |
| Confidence calibration (honest scores) | 2 |
| Flow tracing (traces real call chains) | 4 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 1 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

1. **Task C capsule missed the actual architecture**
- Query: `cw_capsule({ query: "How does the app switch between Zustand mock mode and Supabase live mode across the data layer? Include the deciding conditions, wrapper hooks, cache behavior, and where callers consume the abstraction.", token_budget: 2600, mode: "review" })`
- Key response: `Tokens: 2408/2600`, `Confidence: MEDIUM | Uncertainty: VERY_LOW`, top files `middleware.ts`, `adminClient.ts`, `queries.rbac.test.ts`, `queries.ts`
- Correct answer should have centered on `kuvio/src/lib/dataLayer.ts`, `kuvio/src/lib/supabase/hooks.ts`, and `kuvio/src/lib/supabase/AuthProvider.tsx`

2. **Task A symbol span was stale**
- Query: `cw_capsule({ query: "updateSite", token_budget: 1200, mode: "review" })`
- Key response: top definition shown as `lib/supabase/queries.ts:520-569`
- Follow-up query: `cw_read({ symbol: "lib/supabase/queries.ts:updateSite" })`
- Key response: it read `Read kuvio/src/lib/supabase/queries.ts:520-569` and landed on `getSiteBySlug`
- Correct answer should have read the real definition at `kuvio/src/lib/supabase/queries.ts:591`

3. **Confidence was not earned on a vague query**
- Query: `cw_capsule({ query: "state management", token_budget: 2000, mode: "review" })`
- Key response: `Confidence: HIGH`, `Uncertainty: VERY_LOW`, returned `components/ErrorBoundary.tsx`, `lib/sitesStore.ts`, `SiteStateView`, empty-state components
- Correct answer should have centered on the data-layer abstraction and the Supabase/Zustand split, not empty states and error boundary scaffolding

4. **Flow tracing bridged HTTP but missed business logic**
- Query: `cw_flow({ source: "handleSubmit", max_hops: 4 })`
- Key response: `handleSubmit -> submitPublicInquiry -> POST -> createClient/createAdminClient...`
- Correct answer should have continued through validation, `consumeRateLimit`, inquiry insert, owner email, and auto-response branches

5. **`cw_stats` was wildly incomplete**
- Query: `cw_stats({ session_id: "review-2026-03-17-taskC" })`
- Key response: `Capsules issued: 1`, `Total tokens used: 2,408`, `Avg follow-up reads: 0.00`, `First-pass rate: 100.0%`
- Correct answer should have reflected the actual Task C session cost of 18,053 output tokens across 9 tool calls
