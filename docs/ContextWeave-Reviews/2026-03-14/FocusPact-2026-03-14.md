# ContextWeave Field Review: FocusPact

**Date:** 2026-03-14
**ContextWeave Version:** 0.1.0

Review method: the MCP transport was not exposed in this Codex session, so I drove the real registered ContextWeave tool handlers directly against this repo's persisted `.contextweave` index. This still exercised the actual `cw_*` tool logic and output format.

## Project Profile

| Metric | Value |
|--------|-------|
| Project | FocusPact (`focus-pact-app`) |
| Stack | Next.js 16 App Router, React 19, TypeScript 5, Supabase, Tailwind v4, Radix, Upstash |
| Lines of Code | 16,875 |
| Source Files | 100 |
| Symbols Indexed | 581 |
| Languages | TSX, TypeScript, Markdown, JSON, JavaScript |
| Index Time | 1,984 ms full reindex |
| Architecture | App Router webapp with Server Components, server actions, API routes, Supabase auth/realtime, RLS-first data model |
| Key Directories | `src/app`, `src/app/actions`, `src/app/api`, `src/components`, `src/lib`, `src/lib/supabase`, `database/migrations`, `scripts` |

Step 0 notes:
- Initial `cw_status` said the repo was indexed at **102 files / 551 symbols**.
- Fresh `cw_reindex` produced **124 files / 581 symbols** and flagged **3 parse-error files during reindex**.
- Post-reindex `cw_status --verbose` settled at **124 files / 581 symbols / 936 edges** and marked two TSX files as `[ERROR]`.

## Task-Based Results

Time figures below are local tool execution time only. The meaningful comparison is call count plus how much repair work was needed before the answer was trustworthy.

### Task A: Find and understand the server-side `createClient` used by auth/session flows, and distinguish it from the browser `createClient`

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 4,148 | 1,095 |
| Tool calls | 4 | 4 |
| Completeness | Partial | Complete |
| Time to correct answer | 79 ms | 17 ms |

**What ContextWeave found:** The capsule immediately surfaced `src/lib/supabase/server.ts` and correctly identified the server-side `createClient` using `cookies()` and `createServerClient`.

**What ContextWeave missed:** The capsule's own recommended follow-up `cw_read(symbol: "createClient")` jumped to `src/lib/supabase/client.ts`, not the server definition it had just highlighted. `cw_impact(target: "src/lib/supabase/server.ts:createClient")` then polluted the dependent set with browser-side consumers like `DashboardClient`, `JoinClient.handleJoin`, and `ProfileDropdown`, which do not import the server client.

**Follow-up suggestions useful?** No. The default follow-up was actively misleading on an ambiguous symbol, and I had to recover with a file-qualified `cw_read`.

**Winner:** Grep+Read

### Task B: Trace invite link generation and tribe join flow from dashboard UI through API to Supabase RPC

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 6,902 | 5,441 |
| Tool calls | 9 | 7 |
| Completeness | Complete | Complete |
| Time to correct answer | 65 ms | 9 ms |

**What ContextWeave found:** It did identify the user-facing entry points: `InviteModal`, `JoinClient`, `JoinPage`, and the invite token route. File-qualified `cw_read` was useful once I already knew the exact route symbol I wanted.

**What ContextWeave missed:** The initial capsule did not surface `src/app/api/invites/create/route.ts` or either `join_tribe_atomic` call site, yet it still reported HIGH confidence. Its suggested `cw_read(symbol: "GET")` opened `src/app/api/sessions/route.ts`, which is irrelevant to the invite flow. I had to fall back to `cw_grep` plus targeted reads to recover the actual path.

**Follow-up suggestions useful?** No. `buildInviteUrl` was fine but low value; `GET` was outright wrong for this task.

**Winner:** Grep+Read

### Task C: Answer the design question “What is the auth + tribe-membership gate pattern across page loads, server actions, and API routes?”

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 8,419 | 5,425 |
| Tool calls | 9 | 10 |
| Completeness | Complete | Complete |
| Time to correct answer | 50 ms | 8 ms |

**What ContextWeave found:** It eventually recovered the major pieces: `createTribe`, `updateSession`, `HomePage`, `SetupPage`, and `api/invites/create`. `cw_grep("auth.getUser")` was especially useful for enumerating auth checks.

**What ContextWeave missed:** The main capsule front-loaded `app/actions/tribes.ts` and other action files while omitting the global middleware/page-routing boundary that actually defines the top-level gate pattern. It still labeled the answer HIGH confidence with VERY_LOW uncertainty.

**Follow-up suggestions useful?** Mixed. `createTribe` was relevant, but the broad answer only became trustworthy after overview + grep + explicit reads of middleware and pages.

**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: **19,469**
- Total Grep+Read tokens across 3 tasks: **11,961**
- Actual savings: **-62.8%** (ContextWeave used 62.8% more agent-visible tokens)

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `GET` | No | `getUser`, `getTribeDateString`, and other `get*` symbols; the capsule did not put an actual `GET` route first |
| `POST` | Yes | N/A |
| `createClient` | Yes | N/A, but the browser definition outranked the server definition |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `invite link generation and join tribe flow from dashboard UI through API to Supabase RPC` | LOW | 518 / 2000 | Yes, after re-running with a smaller budget it admitted weaker coverage |
| `auth and tribe membership guard patterns across pages server actions and api routes` | HIGH | 708 / 2000 | No — the answer still missed the middleware/pages boundary until extra tools were used |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `invite link generation and join tribe flow from dashboard UI through API to Supabase RPC` | 8000 | 510 | 6.4% |
| `auth and tribe membership guard patterns across pages server actions and api routes` | 8000 | 692 | 8.6% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `getDashboardData -> checkAndUpdateStreak` | Yes | N/A | Clean and correct |
| `generateLink -> src/app/api/invites/create/route.ts:POST` | N/A | Yes | Good route-entry tracing, but it still could not trace `generateLink -> join_tribe_atomic` |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `auth tribe membership` | 5 | Decent repo map, weak answer synthesis |
| `cw_recall` | `Zombie Protocol` | 1 | Returned no observations for a core project concept |
| `cw_impact` | `src/lib/supabase/server.ts:createClient` | 2 | Dependents were badly polluted by browser-side `createClient` consumers |
| `cw_stats` | current review session | 1 | Claimed 85% savings and 100% first-pass rate despite measured token regression and obvious follow-up churn |

## Flaws Found

Ordered by severity. Each flaw is intentionally narrow and independently actionable.

### P0 (Critical — blocks adoption)
1. **Ambiguous follow-up reads are self-contradictory**: Task A capsule correctly surfaced `src/lib/supabase/server.ts:createClient`, then suggested `cw_read(symbol: "createClient")`, which resolved to the browser client in `src/lib/supabase/client.ts` instead. This breaks trust exactly when the symbol name is common. Root cause: capsule follow-ups are emitted without carrying the resolved symbol/file identity into `cw_read`. Suggested fix: emit file-qualified follow-ups by default and have `cw_read` prefer in-capsule disambiguation context when a symbol was just surfaced.

2. **`cw_impact` conflates homonymous symbols across files**: `cw_impact(target: "src/lib/supabase/server.ts:createClient")` listed browser-only consumers like `DashboardClient`, `JoinClient.handleJoin`, and `ProfileDropdown` as dependents of the server client. That is wrong and makes the blast radius unusable. Root cause: impact tracing widens to same-named symbols/imports instead of staying pinned to the file-qualified target. Suggested fix: when the user supplies a file-qualified symbol, trace only that symbol's graph unless the user explicitly requests multi-definition expansion.

3. **Session stats are materially dishonest**: `cw_stats` reported **85% reduction** and **100% first-pass / 0% correction** for this review session. My measured task totals were the opposite: **19,469 CW tokens vs 11,961 grep tokens**, and every broad task required correction/recovery calls. Root cause: stats compare against inflated raw-file-read estimates rather than actual interactive alternatives, and follow-up detection is effectively dead. Suggested fix: log real downstream tool usage per session, mark correction when a capsule is followed by navigation/retry tools, and report measured session savings separately from heuristic raw-read savings.

4. **Exact-symbol ranking collapses on common web symbols**: Querying exact symbol `GET` returned `getUser`, `getTribeDateString`, and other `get*` helpers ahead of actual `GET` route handlers. The capsule still labeled this HIGH confidence. Root cause: ranking is treating identifier substrings/lexical similarity as stronger than exact whole-symbol matches, with no special handling for HTTP method symbols. Suggested fix: add exact whole-token priority, symbol-kind priors for route methods, and a hard rule that exact symbol definitions outrank fuzzy semantic matches.

### P1 (Important — degrades quality)
1. **Broad flow capsules miss critical path files and then suggest wrong follow-ups**: On the invite flow task, the initial capsule omitted `src/app/api/invites/create/route.ts` and both `join_tribe_atomic` call sites, yet suggested `cw_read(symbol: "GET")`, which opened `src/app/api/sessions/route.ts`. Root cause: broad retrieval is overweighting nearby lexical/UI matches and generic route symbols while underweighting the HTTP endpoint and RPC edges that complete the flow. Suggested fix: add flow-specific retrieval constraints that require at least one UI trigger, one route handler, and one persistence/service edge before claiming broad-flow coverage.

2. **Confidence is overcalibrated for architectural queries**: The auth/membership architecture query reported HIGH confidence and VERY_LOW uncertainty while initially front-loading actions and skipping the middleware/page routing boundary that defines the pattern. Root cause: architecture confidence is based on retrieved pivot count, not boundary diversity across layers. Suggested fix: for architecture intent, require cross-layer coverage thresholds across middleware/pages/actions/routes before HIGH confidence is possible.

3. **Budget utilization is catastrophically low**: With 8000-token budgets, CW used only **510** and **692** tokens. That's not token efficiency; it's under-serving the budget and making the high budget meaningless. Root cause: the packer stops after a small relevant set and does not aggressively refill with adjacent symbols, file summaries, or secondary pivots. Suggested fix: enforce a minimum utilization target or explicitly explain why the budget could not be used; add refill phases that keep packing until the relevant frontier is exhausted.

4. **Index health reporting hides stale or inconsistent reality**: The repo looked “indexed” at 102 files / 551 symbols, but a fresh reindex jumped to 124 / 581 with no staleness warning in the initial status output. Root cause: status reports current DB contents but does not surface drift between filesystem reality and index coverage strongly enough. Suggested fix: show indexed-vs-discovered file counts or at least a “last full scan vs current repo file count” discrepancy warning.

### P2 (Moderate — papercut)
1. **Parser false-positives pollute trust**: Reindex/status marked `src/app/dashboard/components/SafetyGuardModal.tsx` and `src/app/dashboard/components/SettingsModal.tsx` as syntax-error files, but ESLint parsed both files and reported normal semantic/style issues instead of syntax failures. Root cause: TSX parse-error handling is too coarse and stores only a generic “syntax errors detected” marker. Suggested fix: record actual parse diagnostics, keep partial ASTs when possible, and distinguish parse recovery from fatal syntax failure.

2. **Default indexing scope is noisy for app-focused retrieval**: Full reindex indexed docs, AGENTS, plans, scripts, and app code together. That is defensible for a knowledge engine, but it makes status/overview noisier for day-to-day code navigation. Root cause: document indexing is enabled without a clear code-vs-doc separation in user-facing summaries. Suggested fix: split status/profile into code files vs document files, and consider lower default rank for plans/AGENTS unless the query is obviously doc-shaped.

3. **`cw_recall` is too weak to matter in a fresh real-world review**: Querying `Zombie Protocol` returned nothing despite that concept being central to this project's docs/instructions. Root cause: recall is memory-store only, and bootstrap seeding is too thin to make project memory genuinely useful. Suggested fix: improve durable bootstrap extraction from README/AGENTS/project context or clearly label recall as session-memory-only so users do not expect project knowledge retrieval.

## What Worked Well

- File-qualified `cw_read` is genuinely useful once the exact target symbol is already known.
- Direct cross-file flow tracing worked on `getDashboardData -> checkAndUpdateStreak`.
- HTTP boundary tracing did successfully connect `generateLink` to `src/app/api/invites/create/route.ts:POST` via a `framework_entry` edge.
- Exact-symbol retrieval was solid for less ambiguous symbols like `getDashboardData` and `checkRateLimitOrThrow`.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 3 |
| Broad recall (found all relevant files) | 4 |
| Budget utilization (% of budget used) | 1 |
| Confidence calibration (honest scores) | 3 |
| Flow tracing (traces real call chains) | 6 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 1 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

1. **Wrong ambiguous follow-up**
   - Query: `cw_capsule({ query: "server-side createClient used by auth and session flows", token_budget: 1400, mode: "review" })`
   - Key response: first file `src/lib/supabase/server.ts`, follow-up suggestion `cw_read(symbol: "createClient")`
   - Follow-up result: `cw_read(symbol: "createClient")` opened `src/lib/supabase/client.ts:4-9`
   - Correct answer: the intended symbol was `src/lib/supabase/server.ts:createClient`

2. **Impact pollution across duplicate names**
   - Query: `cw_impact({ target: "src/lib/supabase/server.ts:createClient", depth: 2 })`
   - Key response: dependents included `DashboardClient`, `JoinClient.handleJoin`, `ProfileDropdown`
   - Correct answer: those are browser-client consumers and should not appear in server-client impact

3. **Broad flow capsule missed core files**
   - Query: `cw_capsule({ query: "invite link generation and join tribe flow from dashboard UI through API to Supabase RPC", token_budget: 2600, mode: "review" })`
   - Key response: first file `InviteModal`, no `api/invites/create/route.ts`, no `join_tribe_atomic`
   - Correct answer: the flow requires `InviteModal -> api/invites/create/route.ts -> lib/invite.ts -> JoinPage/JoinClient -> api/invites/[token]/route.ts -> join_tribe_atomic`

4. **Misleading broad follow-up**
   - Query: follow-up from the invite capsule, `cw_read({ symbol: "GET", max_lines: 120 })`
   - Key response: opened `src/app/api/sessions/route.ts`
   - Correct answer: the relevant read was invite-token GET or create-route POST, not sessions GET

5. **Architecture confidence not earned**
   - Query: `cw_capsule({ query: "auth and tribe membership guard patterns across pages server actions and api routes", token_budget: 3200, mode: "review" })`
   - Key response: `Confidence: HIGH | Uncertainty: VERY_LOW`, first file `app/actions/tribes.ts`
   - Correct answer: the top-level pattern is anchored by `src/middleware.ts`, `src/lib/supabase/middleware.ts`, `src/app/page.tsx`, and `src/app/setup/page.tsx`, which were not the initial focus

6. **Exact symbol ranking failure**
   - Query: `cw_capsule({ query: "GET", token_budget: 1200, mode: "review" })`
   - Key response: first result was `app/actions/auth.ts:getUser`, followed by other `get*` helpers
   - Correct answer: an actual `GET` route definition should rank first for the exact symbol `GET`

7. **Budget underfill**
   - Query: `cw_capsule({ query: "invite link generation and join tribe flow from dashboard UI through API to Supabase RPC", token_budget: 8000, mode: "review" })`
   - Key response: `Tokens: 510/8000`
   - Correct answer: either fill substantially more of the relevant frontier or explicitly say retrieval was exhausted

8. **Stats dishonesty**
   - Query: `cw_stats({ session_id: "<this review session>" })`
   - Key response: `Estimated savings: 85% reduction`, `First-pass rate: 100.0%`, `Correction rate: 0.0%`
   - Correct answer: measured task totals were 19,469 CW tokens vs 11,961 grep tokens, and broad tasks required obvious correction work
