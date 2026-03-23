# ContextWeave Field Review: FocusPact

**Date:** 2026-03-09
**ContextWeave Version:** From cw_status (no explicit version string exposed)
**Reviewer:** Claude Opus 4.6 (automated field review)

## Project Profile

| Metric | Value |
|--------|-------|
| Project | FocusPact |
| Stack | Next.js 16 App Router + React 19 + TypeScript 5 + Supabase + Upstash Redis |
| Lines of Code | 16,875 |
| Source Files | 100 (102 indexed by CW) |
| Symbols Indexed | 551 |
| Edges | 1,537 |
| Languages | TSX (53), TypeScript (47), JavaScript (2) |
| Index Time | Pre-indexed (no reindex needed) |
| Architecture | Server Actions + API Routes + Supabase RLS + Realtime WebSockets |
| Key Directories | src/app (31 files), src/components (33 files), src/lib (14 files), src/hooks (1 file) |

## Task-Based Results

### Task A: Find and understand `stopFocusSession` — how sessions are stopped, validation, and all callers

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,892 | ~4,900 |
| Tool calls | 3 (capsule + 2 cw_reads) | 6 (1 grep + 5 reads) |
| Completeness | Partial | Complete |
| Time to correct answer | Fast | Moderate |

**What ContextWeave found:** `validateSession` (full), `stopFocusSession` server action (full with follow-up), `handleStopSession` in DashboardClient (partial), `POST` in API stop route (full with follow-up), `FocusSession` type, `SessionValidationResult` interface. Clustered by layer (lib → actions → dashboard → api). Very well structured.

**What ContextWeave missed:** `FocusTimer.tsx` — a component that imports and calls `stopFocusSession` directly. This is a real caller in `src/components/dashboard/FocusTimer.tsx:59`. The capsule covered 4 of 5 files that use this function.

**Follow-up suggestions useful?** Yes — the suggested `cw_read` for the truncated `stopFocusSession` and the API route `POST` were both correct and high-value.

**Winner:** Tie — CW saved ~41% tokens but missed a caller. For understanding the core logic, CW was sufficient. For finding ALL callers, grep wins.

---

### Task B: Trace the tribe invite flow end-to-end (UI → API → database)

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~4,105 | ~9,100 |
| Tool calls | 3 (capsule + 2 cw_reads) | 6 (1 grep + 1 glob + 4 reads) |
| Completeness | Partial | Complete |
| Time to correct answer | Slow (needed follow-ups + still incomplete) | Fast (grep found all 17 files instantly) |

**What ContextWeave found:** `invites/create/route.ts` (partial, needed follow-up), `invites/[token]/route.ts` (types only initially, needed follow-up for handlers), `JoinClient.tsx` (handleJoin function).

**What ContextWeave missed:** 4 critical files:
1. `src/lib/invite.ts` — helper functions (`generateSecureToken`, `buildInviteUrl`, `isValidTokenFormat`, `isInviteExpired`)
2. `src/lib/invite-client.ts` — client-safe invite utilities
3. `src/app/dashboard/components/InviteModal.tsx` — the UI modal where users generate invite links
4. `src/app/join/[token]/page.tsx` — the server component that validates invites and handles auto-join

**Noise:** ~1,200 tokens wasted on completely irrelevant files:
- `app/api/cron/route.ts` (160 lines of streak evaluation logic)
- `app/api/debug/tribe-status/route.ts` (60 lines of debug endpoint)
- `DashboardClient.tsx handleResumeSession` (session resume, not invites)
- `lib/types.ts Database` type (marginally relevant at best)

**Follow-up suggestions useless:** CW suggested reading `handleSafetyEnd` and `supabaseAdmin` — neither is related to the invite flow.

**Winner:** Grep+Read — CW's recall was too low for this cross-cutting flow. It found 3 of 7 key files and wasted budget on 4 irrelevant files. The noise consumed budget that should have surfaced the missing files.

---

### Task C: How is rate limiting implemented across the app?

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,648 | ~2,400 |
| Tool calls | 2 (capsule + 1 cw_read) | 2 (1 grep + 1 read) |
| Completeness | Partial | Complete |
| Time to correct answer | Slow | Instant |

**What ContextWeave found:** `middleware.ts` rate limiting code (full, excellent). `lib/ratelimit.ts` — only a 1-line skeleton (`const redis = isConfigured ? Redis.fromEnv() : null`). This is the CORE rate limiting file with 140 lines including `checkRateLimit`, `checkRateLimitOrThrow`, `RateLimitExceededError`, `getClientIP` — and CW showed 1 line.

**What ContextWeave missed:** The actual body of `ratelimit.ts` (needed a follow-up cw_read), and WHERE `checkRateLimitOrThrow` is called (in `sessions.ts` server actions — the user-ID rate limiting layer).

**Noise:** ~1,400 tokens wasted on 10 irrelevant files — every API route in the project got listed as a summary/skeleton, none showing any rate limiting logic.

**Winner:** Grep+Read — a single grep for `checkRateLimit|ratelimit` found all 3 files and exact call sites in ~500 tokens. CW cost MORE and delivered LESS.

---

### Overall Token Comparison

| | ContextWeave | Grep+Read |
|--|-------------|-----------|
| Task A | 2,892 | 4,900 |
| Task B | 4,105 | 9,100 |
| Task C | 2,648 | 2,400 |
| **Total** | **9,645** | **16,400** |
| **Actual savings** | **~41%** | — |

CW's self-reported savings: 65% (from `cw_stats`). Actual measured savings: 41%. The discrepancy comes from CW overestimating the grep+read baseline cost.

**Critical caveat:** CW's 41% token savings came at the cost of incomplete answers in 3/3 tasks. A cheaper incomplete answer is not necessarily better than a slightly more expensive complete one.

## Stress Test Results

### Exact Symbol Ranking (2A)

| Symbol | Definition at #1? | What outranked it? | Notes |
|--------|------------------|--------------------|-------|
| `validateSession` | **Yes** | N/A | Clean result. Also found test version and caller. |
| `handleStopSession` | **Yes** | N/A | But included irrelevant `handleStartClick`, `handleCancelStart` (25% L3 noise). |
| `checkRateLimitOrThrow` | **Yes** | N/A | Excellent. Also pulled related `checkRateLimit` + `RateLimitExceededError`. Zero noise. |

**Verdict:** Symbol ranking works well. All 3 definitions appeared at #1. This is CW's strongest capability.

### Confidence Honesty (2B)

| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| "error handling validation" | HIGH | 2,255/4,000 (56%) | Partially — results were relevant but scattered across 10 files. HIGH overstates it for such a vague query. |
| "notification system" | LOW | 832/4,000 (21%) | **Yes** — honest. Project has no notification system. LOW + HIGH uncertainty is accurate. But the results it DID show (getLiveMinutes, realtime channel) were tangential at best. |

**Verdict:** LOW confidence is well-calibrated. HIGH confidence is sometimes overstated, especially for vague queries where CW returns scattered results.

### Budget Utilization (2C)

| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| "error handling validation" | 4,000 | 2,255 | 56% |
| "notification system" | 4,000 | 832 | 21% |
| "How does real-time sync work across the dashboard?" | 8,000 | 4,305 | 54% |

**Verdict:** All 3 queries below 60% utilization. The 8,000-token budget query used only 54% — and the answer was still incomplete (missing `useFocusTimer` hook, Supabase realtime subscription details). CW appears to have a hard ceiling around 4,000-5,000 tokens regardless of budget. The unused budget doesn't get filled with more useful context — it's just wasted allocation.

### Flow Tracing (2D)

| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `stopFocusSession` (outgoing) | **No** — traced low-level imports only | No | All 10 paths were `createClient → Database` or `getTribeDateString → createClient`. None traced the meaningful call chain (handleStopSession → stopFocusSession, or stopFocusSession → validateSession inline logic). |
| `handleStopSession → validateSession` | **No** — "No path found within 5 hops" | N/A | The actual chain is `handleStopSession → stopFocusSession` (Server Action call) → inline validation. CW couldn't trace this because stopFocusSession does validation inline rather than calling `validateSession` directly. The API route DOES call `validateSession`, but CW couldn't trace from `handleStopSession` through `stopFocusSession` to the route. |

**Verdict:** Flow tracing is CW's weakest capability. It traces import-level edges (file A imports from file B) but cannot trace:
1. Server Action calls across the client-server boundary
2. HTTP `fetch()` calls
3. Inline logic equivalence (function A reimplements function B's logic)

The outgoing flows from `stopFocusSession` returned 10 paths of Supabase plumbing — none of which a developer would care about.

### Supporting Tools (2E)

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | "rate limiting" | 5/10 | Found `ratelimit.ts` and `security-pentest.ts` correctly. But also listed 6 files with "no direct symbol name match" — padding the results with noise. The directory summary itself is useful for orientation. |
| `cw_recall` | "architecture decisions rate limiting security" | 6/10 | Found 6 documentation observations from ARCHITECTURE.md and README. These are doc quotes, not learned patterns. Useful for getting architectural context without reading docs. |
| `cw_impact` | "validateSession" | 7/10 | Found 3 affected symbols: `POST` route and test `result`. Accurate for DIRECT callers. But missed `stopFocusSession` which reimplements the same validation logic inline — not a direct call, so understandable. |
| `cw_stats` | (session) | 4/10 | Self-reported 65% savings, but measured savings were 41%. The "grep+read cost (est)" of 44,798 tokens appears inflated. Stats should be based on actual measurements, not estimates. |

## Flaws Found

### P0 (Critical — blocks adoption)

1. **Flow tracing returns only import plumbing, not meaningful call chains**: `cw_flow("stopFocusSession")` returned 10 paths, all tracing `createClient → Database` or similar low-level infrastructure. Zero paths showed the actual caller (`handleStopSession`) or the actual callee logic (`validateSession`). A developer asking "what calls this function and what does it call?" gets Supabase client initialization paths — completely useless for understanding data/control flow. → **Root cause:** The flow tracer follows AST import/call edges but doesn't weight by developer relevance. Infrastructure imports (Supabase client, type imports) flood out meaningful function-to-function relationships. → **Fix:** Add relevance scoring to flow paths. Deprioritize utility/library imports. Prioritize application-level function calls. Consider filtering out paths that only traverse infrastructure code.

2. **Cross-boundary flows untraced**: `cw_flow("handleStopSession", target: "validateSession")` returned "No path found within 5 hops." The actual path is `handleStopSession` (client) → `stopFocusSession` (Server Action) → inline validation → `validateSession` (used in parallel API route). CW cannot trace Server Action invocations, HTTP fetch calls, or event handlers — the exact boundaries where flow tracing would be most valuable. → **Root cause:** Server Actions look like regular function calls in code but cross the client-server boundary. CW's AST parser likely sees the import but doesn't model the runtime call edge. → **Fix:** Detect `"use server"` directives and model Server Action imports as callable edges. Similarly, detect `fetch("/api/...")` patterns and link them to matching route handlers.

### P1 (Important — degrades quality)

1. **Massive noise in broad queries**: Task B capsule (invite flow) wasted ~1,200 tokens (29% of budget) on completely irrelevant files: cron route, debug endpoint, resume handler. Task C capsule (rate limiting) wasted ~1,400 tokens (53% of useful budget) on summaries of every API route in the project. → **Root cause:** Broad queries trigger a wide net retrieval that pulls in files sharing tangential keywords or import chains. The ranker doesn't sufficiently demote files that share infrastructure (Supabase client) but not domain relevance. → **Fix:** Implement negative relevance signals. If a file shares only infrastructure imports (createClient, NextResponse) with the query results but no domain-specific symbols, demote it aggressively.

2. **Core file shown as skeleton while noise gets full source**: In Task C, `ratelimit.ts` — the most relevant file — was shown as a 1-line skeleton (`const redis = ...`), while irrelevant API routes got summary entries that consumed more budget. The ranking put `ratelimit.ts` at relevance 0.99 (second only to middleware.ts at 1.0), yet it received the least compression-level budget. → **Root cause:** The packer's budget allocation may favor files with more symbols or higher absolute scores, not relative importance within the query context. A file with relevance 0.99 should get near-full budget, not a skeleton. → **Fix:** Budget allocation should be more strongly weighted by relevance score. A file at 0.99 relevance should never be compressed to skeleton while files at 0.27 relevance get summaries.

3. **Self-reported savings inflated**: `cw_stats` reported 65% token savings (15,629 vs estimated 44,798). Actual measured savings across 3 comparable tasks: 41% (9,645 vs 16,400). The 44,798 "grep+read cost" estimate appears to assume worst-case full-file reads. → **Root cause:** The savings estimator likely calculates based on reading entire files that were referenced, ignoring that grep+read workflows are already targeted (developers don't read whole files — they read specific sections). → **Fix:** Base the estimate on realistic grep+read patterns: grep hit lines + context, not full file reads. Or, better yet, don't report estimated savings at all — just report tokens used and let the developer judge.

4. **Budget utilization capped around 50-56% on large budgets**: Three queries with budgets of 4,000-8,000 tokens all utilized 21-56%. The 8,000-token query ("real-time sync") used only 54% and still had an incomplete answer (missing `useFocusTimer` hook details). Unused budget wasn't filled with additional useful context. → **Root cause:** Likely a fixed per-symbol or per-file token cap that prevents the packer from including more symbols even when budget allows. → **Fix:** When budget remains after packing all retrieved symbols, expand compression levels (show full source instead of summaries) or retrieve additional related symbols to fill the budget productively.

### P2 (Moderate — papercut)

1. **Capsule includes `[previously shown]` markers that consume budget without adding value**: In the "error handling validation" capsule, several symbols were marked `[previously shown]` (from the same session's earlier capsules). These still consumed tokens in the response but provided no new information. → **Fix:** Either fully skip previously-shown symbols (freeing budget for new ones) or make the dedup optional.

2. **Follow-up suggestions sometimes point to irrelevant symbols**: Task B's capsule suggested reading `handleSafetyEnd` and `supabaseAdmin` — neither related to the invite flow. These are the capsule's own noise symbols being promoted as follow-ups. → **Fix:** Only suggest follow-ups for symbols that scored above a relevance threshold (e.g., > 0.5), not just any symbol that was compressed.

3. **`cw_read` path resolution inconsistency**: Capsule output shows paths like `lib/ratelimit.ts` and `app/actions/sessions.ts`, but `cw_read` rejects these as "outside the project root" — requiring `src/lib/ratelimit.ts` and `src/app/actions/sessions.ts` instead. → **Fix:** Accept both formats, or ensure the capsule's follow-up suggestions use the same path format that `cw_read` expects.

4. **`cw_overview` query results include "no direct symbol name match" padding**: When querying for "rate limiting", 6 of 8 results said "no direct symbol name match." These add noise without information. → **Fix:** Don't list files that didn't match — or at least move them to a separate "possibly related" section.

## What Worked Well

1. **Exact symbol lookup is excellent.** All 3 symbol queries (`validateSession`, `handleStopSession`, `checkRateLimitOrThrow`) returned the definition at rank #1 with relevant context (callers, types, tests). This is genuinely better than grep for understanding a specific function and its ecosystem.

2. **Multi-level compression is smart.** The capsule's [full], [summary], [skeleton], [reference] levels are well-calibrated for individual results. Showing the definition as [full] and callers as [summary] is the right trade-off — when it picks the right symbols.

3. **Clustered output by directory/layer is useful.** Capsules group results by `[Cluster: lib]`, `[Cluster: app/actions]`, etc. This gives immediate architectural orientation that raw grep output doesn't provide.

4. **LOW confidence is well-calibrated.** When CW says LOW confidence, it genuinely means the results are thin or uncertain. The "notification system" query correctly flagged that it couldn't find a real match.

5. **`cw_impact` for direct callers works well.** Finding that `validateSession` is used by the POST route and the test file is accurate and fast — better than grep for understanding immediate blast radius.

6. **`cw_recall` surfaces architectural documentation.** Pulling observations from ARCHITECTURE.md and README for contextual grounding is useful, especially when starting work on an unfamiliar part of the codebase.

7. **Session dedup with `[previously shown]` prevents redundant full-source dumps.** While the markers consume some tokens (see P2.1), the intent is correct — don't re-show code the agent already has in context.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | **9** |
| Broad recall (found all relevant files) | **4** |
| Budget utilization (% of budget used) | **4** |
| Confidence calibration (honest scores) | **6** |
| Flow tracing (traces real call chains) | **2** |
| Follow-up quality (suggested reads were useful) | **5** |
| Token savings vs grep+read (measured, not claimed) | **6** |
| **Overall: Would replace Grep+Explore?** | **Partial** |

**Partial verdict explanation:** CW is genuinely better than grep for narrow symbol lookups (Task A type queries). It provides structured, compressed, architecturally-oriented context that grep can't match. However, for broad cross-cutting flows (Task B) and pattern-across-files queries (Task C), grep consistently found more relevant files with less noise. The flow tracer (cw_flow) is currently unusable for real developer workflows.

**Recommendation:** Use CW as a **complement** to grep, not a replacement:
- Start with `cw_capsule` for symbol lookup and initial orientation
- Fall back to grep when the capsule's confidence is LOW or when tracing cross-file flows
- Don't use `cw_flow` until it can trace application-level calls instead of import plumbing
- Don't trust `cw_stats` savings numbers — they're inflated by ~40%

## Evidence Snippets

### P0.1: Flow tracing returns import plumbing

**Query:** `cw_flow({ source: "stopFocusSession" })`
**Response (first 3 paths):**
```
Path 1: [import] → function createClient (src/lib/supabase/client.ts:4) → [import] → type Database (src/lib/types.ts:71)
Path 2: [import] → function createClient (src/lib/supabase/server.ts:5) → [import] → type Database (src/lib/types.ts:71)
Path 3: [import] → function createClient (src/lib/supabase/server.ts:5) → [call] → method getAll (src/lib/supabase/middleware.ts:14)
```
**Expected:** Paths like `handleStopSession → stopFocusSession` or `stopFocusSession → checkRateLimitOrThrow`. Got Supabase client plumbing instead.

### P0.2: Cross-boundary flow untraceable

**Query:** `cw_flow({ source: "handleStopSession", target: "validateSession" })`
**Response:** `No path found from "handleStopSession" to "validateSession" within 5 hops`
**Actual path:** `handleStopSession` (DashboardClient.tsx:256) → calls `stopFocusSession` (sessions.ts:139, Server Action) → inline validation logic equivalent to `validateSession`. The API route at `sessions/stop/route.ts:56` calls `validateSession` directly.

### P1.2: Core file gets skeleton while noise gets summaries

**Query:** `cw_capsule("rate limiting", budget: 3000)`
**`ratelimit.ts` output (relevance 0.99):**
```
// [skeleton]
// lib/ratelimit.ts:21 [variable] const redis = isConfigured ? Redis.fromEnv() : null;
```
**Meanwhile, irrelevant files at relevance 0.27-0.36 received summaries/skeletons consuming ~1,400 tokens total:**
- `app/api/cron/route.ts` (3 summaries)
- `app/api/debug/tribe-status/route.ts` (1 summary)
- `app/api/sessions/start/route.ts` (1 summary)
- `app/api/sessions/stop/route.ts` (2 summaries)
- Plus 5 more files with summaries

### P1.3: Inflated savings

**cw_stats output:** `Estimated savings: ~29,169 tokens (65% reduction)` — `grep+read cost (est): ~44,798 tokens`
**Measured across 3 tasks:** CW used 9,645 tokens. Grep+Read used 16,400 tokens. Actual savings: 41%.

### 2C Evidence: Budget underutilization

**Query:** `cw_capsule("How does real-time sync work across the dashboard?", budget: 8000)`
**Response:** `Tokens: 4305/8000` (54% utilization)
**Missing from answer:** `useFocusTimer` hook (the drift-proof timer implementation), Supabase channel subscription details (only partial), `dashboard/page.tsx` server component data loading.
