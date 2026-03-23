# ContextWeave Field Review: Sitecraft

**Date:** 2026-03-14
**ContextWeave Version:** `0.1.0` (`cw_status` did not report version; CLI reported `contextweave v0.1.0`)

Token counting note: token totals below are tool output tokens, counted with the same `gpt-tokenizer` for both ContextWeave and grep+read outputs. This captures the actual context delivered to an agent, including capsule overhead and every follow-up call used to reach the answer.

## Project Profile

| Metric | Value |
|--------|-------|
| Project | Sitecraft (`kuvio/` directory, package name `sitecraft`) |
| Stack | Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Zustand, Supabase, Radix UI, Vitest, Playwright |
| Lines of Code | 79,567 |
| Source Files | 447 |
| Symbols Indexed | 3,275 |
| Languages | tsx, typescript, markdown, javascript, json, yaml, bash |
| Index Time | 22,273 ms (`cw_reindex`) |
| Architecture | Modular monolith: App Router UI + BFF-style API routes + Supabase backend + Zustand mock fallback |
| Key Directories | `kuvio/src/app`, `kuvio/src/features`, `kuvio/src/components`, `kuvio/src/lib`, `kuvio/src/lib/supabase`, `kuvio/supabase/migrations`, `kuvio/docs` |

## Task-Based Results

### Task A: Understand `validateOrigin(request)` and map its auth/admin caller spread

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 7,598 | 2,376 |
| Tool calls | 6 | 2 |
| Completeness | Complete | Complete |
| Time to correct answer | ~8s | ~1s |

**What ContextWeave found:** The function body quickly, plus a strong `cw_impact` fan-out showing it is used by login/register/complete-profile and a large set of admin routes.
**What ContextWeave missed:** The initial capsule did not actually show the caller spread. I had to use `cw_impact` and `cw_grep` to get the real answer.
**Follow-up suggestions useful?** No. `RequestValidationError` was low-value, and `cw_read(file: "features/admin/AdminUserDetailPage.tsx", symbol: "callAdminApi")` resolved to `AdminPendingPage.tsx`, which is just wrong.
**Winner:** Grep+Read

### Task B: Trace public inquiry submission from `QuoteModal` to API, DB write, and email delivery

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 13,047 | 3,220 |
| Tool calls | 16 | 5 |
| Completeness | Complete | Complete |
| Time to correct answer | ~18s | ~2s |

**What ContextWeave found:** The API route, rate limiting, DB insert, and Resend email send path. `cw_flow` also bridged `submitPublicInquiry` to the `/api/submit-inquiry` route.
**What ContextWeave missed:** The initial capsule completely missed the actual UI/client chain (`QuoteModal` -> `useQuoteForm` -> `submitPublicInquiry`) and instead burned budget on `AdminUserDetailPage.handleRecordPayment`, `mapInquiry`, `SettingsPage.handleInvite`, and other noise. File-qualified `cw_read` on `useQuoteForm` returned `QuoteModal.test.tsx`, not the real hook.
**Follow-up suggestions useful?** No. The top follow-up was `handleRecordPayment`, which is unrelated to inquiry submission.
**Winner:** Grep+Read

### Task C: Explain how the app switches between Zustand mock mode and Supabase live mode

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 13,001 | 4,758 |
| Tool calls | 15 | 5 |
| Completeness | Complete | Complete |
| Time to correct answer | ~20s | ~2s |

**What ContextWeave found:** After forcing it back on track with exact-string grep/read, it did expose the core switch: `const supabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL`, `useDataLayer`, `useSiteDataLayer`, `useSites`, `useSite`, and `AuthProvider`.
**What ContextWeave missed:** The initial capsule was a near-total miss. It prioritized middleware, tests, mock data, create-site pages, landing pages, and even storage tests instead of the actual data layer. File-qualified `cw_read(file: "kuvio/src/lib/dataLayer.ts", symbol: "useDataLayer")` returned test mocks, not the real function.
**Follow-up suggestions useful?** No. Suggested reads included `handleApprove`, storage tests, `DeviceMode`, `LivePreview`, and tier toggles.
**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 33,646
- Total Grep+Read tokens across 3 tasks: 10,354
- Actual savings: `-225.0%` (ContextWeave used 3.25x more tokens than grep+read)

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `validateOrigin` | No | `cw_grep("validateOrigin")` ranked a test import in `requestValidation.test.ts` above the definition |
| `useQuoteForm` | Yes | None |
| `useDataLayer` | Yes | None |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `public inquiry submission flow from QuoteModal to API database and email` | HIGH | 1542 / 2500 | No. It missed `QuoteModal`, `useQuoteForm`, and `publicInquiry.ts`, then suggested admin payment code. |
| `state management` | HIGH | 1986 / 2000 | No. It centered `ErrorBoundary`, `ContextWeaveLanding`, and random `EmptyState` components instead of the actual state architecture. |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `state management` | 8000 | 1656 | 21% |
| `How does the app switch between Zustand mock mode and Supabase live mode across the data layer?` | 8000 | 1121 | 14% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `kuvio/src/lib/dataLayer.ts:useDataLayer` | Yes | No | It traced `useDataLayer -> useSites -> getSites/getSite`, but with lots of duplicate/noisy paths. |
| `kuvio/src/lib/publicInquiry.ts:submitPublicInquiry` | No | Yes | It found the HTTP boundary to `POST /api/submit-inquiry`, but then exploded into `createClient`/`createAdminClient` noise instead of the meaningful insert/email path. |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `Supabase data layer` | 5 | Some value, but mostly a directory dump plus shallow lexical matches. |
| `cw_recall` | `validateOrigin` | 2 | Mostly passive query echoes, not actual learned architectural memory. |
| `cw_impact` | `kuvio/src/lib/publicInquiry.ts:submitPublicInquiry` | 8 | Strong dependent mapping through hook/UI/layout usage. One of the few genuinely useful tools. |
| `cw_stats` | session stats | 1 | Claimed `First-pass rate: 100%`, `Correction rate: 0%`, `Avg follow-up reads: 0.00` after a session full of follow-up work. Also reported `Indexed: 49 files, 158 symbols`, which is not project index size. |

## Flaws Found

Ordered by severity. Each item is one independently actionable flaw.

### P0 (Critical — blocks adoption)
1. **Broad retrieval misses the actual answer surface**: On Task B and Task C, `cw_capsule` omitted the real entrypoints/files and returned admin pages, tests, docs, or landing-page noise instead. That makes the flagship tool slower and more expensive than grep on real work. Root cause is likely weak body-aware relevance plus poor test/doc downranking and no layer-aware retrieval. Fix: add code-body semantics, strong test/doc penalties, and explicit layer coverage targets for UI/API/store/service queries.
2. **File-qualified `cw_read(file, symbol)` is unreliable**: `cw_read(file: "features/admin/AdminUserDetailPage.tsx", symbol: "callAdminApi")` returned `AdminPendingPage.tsx`. `cw_read(file: "kuvio/src/hooks/useQuoteForm.ts", symbol: "useQuoteForm")` returned `QuoteModal.test.tsx`. That is catastrophic for agent trust. Root cause is likely symbol resolution falling back to global matches even when a file constraint is supplied. Fix: make the file constraint hard, and fail loudly with candidate disambiguation instead of returning the wrong symbol.
3. **Follow-up suggestions actively mislead the agent**: Task B suggested `handleRecordPayment`; Task C suggested storage tests, live preview, and admin tier code. These are not “suboptimal”; they are agent-degrading. Root cause is likely a follow-up scorer that optimizes local score, not unresolved task gaps. Fix: derive missing facets from the query and only suggest reads that close uncovered layers or entities.

### P1 (Important — degrades quality)
1. **Confidence is miscalibrated on broad queries**: `HIGH` confidence for the inquiry-flow task was not earned; the capsule missed the actual UI/hook/client chain. `HIGH` confidence for `state management` was even worse. Root cause is likely confidence scoring that overweights local lexical hits and dependency counts without checking expected layer coverage. Fix: confidence should be gated by whether the answer spans the expected layers for the query class.
2. **Budget utilization is poor and hides incompleteness**: With an 8k budget, ContextWeave used only 21% and 14% on incomplete answers. That is not efficient; it is thin retrieval. Root cause is likely a packer that stops when retrieval is weak instead of broadening search or adding adjacent context. Fix: iterative expansion until either a confidence floor is met or a minimum utilization threshold is reached.
3. **`cw_stats` is not honest enough for evaluation**: It said `First-pass rate: 100%`, `Correction rate: 0%`, and `Avg follow-up reads: 0.00` even though this session required heavy follow-up recovery. Root cause is likely stats tied only to capsule logs, not actual downstream navigation or task success. Fix: track task-scoped sessions, follow-up tool usage, and whether the answer required correction.
4. **`cw_overview` is too lexical for semantic architecture questions**: `cw_overview("Supabase data layer")` did surface `dataLayer.ts`, but it also returned irrelevant route pages and mostly functioned as a directory inventory. Root cause is likely file summaries built from names/signatures instead of meaningful body content. Fix: enrich file summaries with code-body signals and semantic embeddings.

### P2 (Moderate — papercut)
1. **Passive memory bleeds into unrelated capsules**: The `validateOrigin...` observation kept appearing inside unrelated Task B and Task C capsules. Root cause is likely over-permissive passive memory injection. Fix: tighten relevance thresholds or disable passive observation injection by default for unrelated queries.
2. **Status/overview warnings are noisy and confusing**: `cw_status` warned that `100% of indexed files are from non-source directories` on a normal repo centered around `kuvio/src`. That undermines trust in the diagnostics layer. Root cause is likely a brittle source-root heuristic. Fix: infer source roots from repo structure and framework conventions, not generic directory labels.

## What Worked Well

- `cw_impact` is genuinely strong. It was the best tool in the set and often more useful than raw grep for blast-radius/dependent mapping.
- Exact symbol lookup is sometimes good. `useQuoteForm` and `useDataLayer` both put the right definition at the top of the capsule.
- `cw_flow` can bridge `fetch()` to a Next route at a coarse level, which grep does not do automatically.
- Reindex speed was respectable for this repo size: 560 files, 3,274 symbols, 22.3s.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 5 |
| Broad recall (found all relevant files) | 2 |
| Budget utilization (% of budget used) | 2 |
| Confidence calibration (honest scores) | 3 |
| Flow tracing (traces real call chains) | 6 |
| Follow-up quality (suggested reads were useful) | 1 |
| Token savings vs grep+read (measured, not claimed) | 1 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

- **Broad retrieval miss, Task B**
  - Query: `cw_capsule({ query: "public inquiry submission flow from QuoteModal to API database and email", token_budget: 2500, mode: "review" })`
  - Key response: `Confidence: HIGH`, files included `app/api/submit-inquiry/route.ts`, `features/admin/AdminUserDetailPage.tsx`, `lib/supabase/queries.ts`, `features/site-settings/SettingsPage.tsx`
  - Correct answer should have centered `components/public/QuoteModal.tsx`, `hooks/useQuoteForm.ts`, `lib/publicInquiry.ts`, and `app/api/submit-inquiry/route.ts`

- **File-qualified read returning the wrong file**
  - Query: `cw_read({ file: "kuvio/src/hooks/useQuoteForm.ts", symbol: "useQuoteForm" })`
  - Key response: `Read kuvio/src/components/public/QuoteModal.test.tsx:10-16`
  - Correct answer should have returned the real hook in `kuvio/src/hooks/useQuoteForm.ts`

- **Misleading follow-up suggestion**
  - Query: same Task B capsule
  - Key response: suggested `cw_read(file: "features/admin/AdminUserDetailPage.tsx", symbol: "handleRecordPayment")`
  - Correct answer should have suggested the missing client-side chain, not admin payment code

- **Architectural capsule off-target**
  - Query: `cw_capsule({ query: "How does the app switch between Zustand mock mode and Supabase live mode across the data layer?", token_budget: 2800, mode: "review" })`
  - Key response: top files included `lib/supabase/middleware.ts`, `lib/supabase/queries.rbac.test.ts`, `lib/siteMockData.ts`, `features/admin/AdminUserDetailPage.tsx`
  - Correct answer should have centered `lib/dataLayer.ts`, `lib/supabase/hooks.ts`, and `lib/supabase/AuthProvider.tsx`

- **Confidence dishonesty**
  - Query: `cw_capsule({ query: "state management", token_budget: 2000, mode: "review" })`
  - Key response: `Confidence: HIGH`, `Uncertainty: LOW`, while major hits included `components/ErrorBoundary.tsx`, `app/contextweave/ContextWeaveLanding.tsx`, and various `EmptyState` components
  - Correct answer should have focused on `lib/sitesStore.ts`, `lib/dataLayer.ts`, `lib/supabase/hooks.ts`, and `lib/supabase/AuthProvider.tsx`

- **Budget underutilization**
  - Query: `cw_capsule({ query: "How does the app switch between Zustand mock mode and Supabase live mode across the data layer?", token_budget: 8000, mode: "review" })`
  - Key response: `Tokens: 1121/8000`
  - Correct answer should have used the remaining budget to pull in the actual data layer files rather than stopping on thin retrieval

- **Stats not reflecting reality**
  - Query: `cw_stats()`
  - Key response: `First-pass rate: 100.0%`, `Correction rate: 0.0%`, `Avg follow-up reads: 0.00`
  - Correct answer should have reflected extensive follow-up recovery during this review session
