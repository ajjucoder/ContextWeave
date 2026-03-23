# ContextWeave Field Review: Kuvio (Construct-OS)

**Date:** 2026-03-18
**Reviewer Model:** Claude Opus 4.6 (1M context)
**ContextWeave Version:** Not explicitly reported by `cw_status`; DB size ~10.8 MB

> Note: This review was conducted using ContextWeave as a live MCP server with all `cw_*` tools mounted. No CLI fallback was needed. The existing index was used as-is (no forced reindex), which is the realistic experience a developer would have.

## Project Profile

| Metric | Value |
|--------|-------|
| Project | Kuvio / Construct-OS — multi-sector website builder for Nepal businesses |
| Stack | Next.js 16 (App Router), Tailwind CSS v4, Zustand, Supabase, Framer Motion |
| Lines of Code | 95,198 |
| Source Files | 545 (.ts/.tsx/.js/.jsx) |
| Symbols Indexed | 4,122 (per cw_overview) / 883 (per cw_status) — see Flaw P0-2 |
| Files Indexed | 647 (per cw_overview) / 47 (per cw_status/cw_files) — see Flaw P0-2 |
| Languages | TypeScript (8), TSX (37) per cw_status; full project also has Markdown, SQL, CSS |
| Index Time | Not reported (used existing index; no reindex performed) |
| Architecture | Next.js App Router, feature-based directory structure, dual data layer (Zustand fallback + Supabase), 32 theme layouts |
| Key Directories | `src/lib/` (core logic), `src/features/` (pages), `src/components/` (shared UI), `src/app/` (routes), `src/lib/supabase/` (data) |

## Task-Based Results

### Task A: Find and understand `ensureContrast` (narrow symbol lookup)

A WCAG contrast utility defined in `colorUtils.ts`, imported across 12+ component files (services variants, PackagesSection, ContactSection, StructuredFooter, CTA variants). Name is specific enough for grep but requires understanding callers.

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,000 (all wasted) | ~2,700 (all useful) |
| Tool calls | 3 (capsule, grep, flow) | 2 (grep, read) |
| Completeness | **Failed** | **Complete** |
| Time to correct answer | Never reached | 2 calls |

**What ContextWeave found:** Zero relevant results. Returned `getAllProfiles`, `fetchAllSitesAnalytics`, `onScroll`, `toThemeColor`, `buildMockSite` — none related to contrast or WCAG. Confidence reported as LOW (honest).

**What ContextWeave missed:** The entire answer. `ensureContrast` is defined in `src/features/site-preview/colorUtils.ts` which IS indexed (confirmed via `cw_files(pattern: "**/colorUtils*")` — 8 symbols). The function exists in the index but was not retrieved by any CW tool.

**Follow-up suggestions useful?** No. CW suggested `cw_grep(query: "ensureContrast")` which also returned nothing. And `cw_flow(source: "ensureContrast")` returned "No symbol found."

**Root cause:** `cw_grep` returned no matches for a term that exists in an indexed file. The capsule's retrieval pipeline failed to surface the symbol despite it being in the AST index. This suggests the retrieval scoring ignores or down-ranks symbols in files that aren't in some "active" subset.

**Winner:** Grep+Read (decisive)

---

### Task B: Trace inquiry submission flow (UI -> API -> DB -> plan gate)

End-to-end flow: contact form calls `submitPublicInquiry()` -> `fetch('/api/submit-inquiry')` -> API route validates, rate-limits, checks owner plan, inserts into DB, sends email notifications.

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~3,718 (60% noise) | ~4,150 (all useful) |
| Tool calls | 1 | 5 |
| Completeness | **Partial** — DB layer only | **Complete** — full E2E flow |
| Time to correct answer | Never complete | 5 calls |

**What ContextWeave found:** `addInquiry`, `updateInquiry`, `removeInquiry`, `computeInquiryTrend`, `mapInquiry` from queries.ts — the database CRUD layer for inquiries. Also `ModularContactForm` skeleton.

**What ContextWeave missed:**
- `src/app/api/submit-inquiry/route.ts` — the actual API route (the core of the flow)
- `src/lib/publicInquiry.ts` — the client-side caller (`submitPublicInquiry`)
- Plan gate logic (inline owner plan check in the route)
- Rate limiting pipeline (`consumeRateLimit`)
- Input validation (`validateInquiryBody`)
- Email notifications (Resend integration)
- CORS handling

**Noise returned:** Entire `VariationCreateSitePage.tsx` wizard flow (Step1BusinessInfo, Step2Services, Step3Branding, Step4Review, LivePreview, buildMockSite, toSlug) — 7 symbols consuming ~1,500 tokens that have zero relationship to inquiry submission.

**Notable:** The actual API route does NOT use `addInquiry` from queries.ts — it uses a direct `publicClient.from('inquiries').insert()`. So even the "useful" part of CW's answer was misleading — it pointed to the wrong insert path.

**Winner:** Grep+Read (decisive)

---

### Task C: How does the data layer work? (architectural question)

Understanding the `useDataLayer`/`useSiteDataLayer` pattern: dual-mode (Zustand fallback + Supabase), mutation interface, caching, env-var switching.

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,394 (40% noise) | ~1,900 (all useful) |
| Tool calls | 1 | 2 |
| Completeness | **Partial** — core hooks only | **Complete** — full architecture |
| Time to correct answer | Partial in 1 call | Complete in 2 calls |

**What ContextWeave found (genuinely useful):**
- `useDataLayer` and `useSiteDataLayer` hook functions with full source
- `DataLayer` and `SingleSiteDataLayer` interfaces
- `useSitesStore` with `SitesState` interface (full Zustand store)
- `useSite` skeleton from hooks.ts
- Cache eviction functions (`evictSiteCache`, `evictSitesCache`)

**What ContextWeave missed:**
- `DataLayerMutations` interface (the shared contract both modes implement)
- `wrapStore` function (how Zustand is wrapped into the mutation interface)
- `useSupabaseMutations` function (how Supabase queries become mutations)
- `supabaseConfigured` / `isSupabaseEnabled()` (the env-var switch)
- Module-level caching (`sitesCache`, `siteCache` Maps in hooks.ts)

**Noise returned:**
- Auth route `createServerClient` calls (3 files) — not relevant to data layer
- `queries.rbac.test.ts` full Supabase mock (56 lines) — test noise
- `isSupabaseNotFoundError`, `getProfile` — tangentially related
- `middleware.ts` supabase variable — not relevant

**Winner:** Grep+Read (narrowly — CW was partially useful here)

---

### Overall Token Comparison

| | ContextWeave | Grep+Read |
|--|-------------|-----------|
| Task A tokens | 2,000 | 2,700 |
| Task B tokens | 3,718 | 4,150 |
| Task C tokens | 2,394 | 1,900 |
| **Total** | **8,112** | **8,750** |
| Completeness | 0/1/1 (Failed/Partial/Partial) | 3/3 Complete |
| **Actual savings** | **-7%** (CW used slightly fewer tokens but produced incomplete/wrong answers) |

**The token comparison is misleading.** CW's 8,112 tokens delivered one partial and two failed/partial answers. Grep+Read's 8,750 tokens delivered three complete answers. Per-useful-token, Grep+Read is dramatically more efficient.

## Stress Test Results

### 2A: Exact Symbol Ranking

| Symbol | Definition at #1? | What outranked it? | Notes |
|--------|------------------|--------------------|-------|
| `mapSite` | Yes | N/A | Also returned `updateSite` + `deleteSite` (callers). Budget exhausted at 98% with only 43% pivot coverage. |
| `useSitesStore` | Yes | N/A | Good callers shown. Noise: CONTRIBUTING.md, handoff-prompt.md skeletons. |
| `showToast` | Yes | N/A | Definition #1, but heavy noise: `toSlug`, `toThemeColor`, `markDirty`, `clearSelection` — unrelated symbols from files that import `showToast`. Full `ProjectsPage` (234 lines) returned for one `showToast` call. |

**Summary:** Definitions consistently rank #1. However, the remaining budget is wasted on tangential symbols from consumer files rather than useful callers/callees. The `showToast` query is the worst example — 3 symbols from `VariationCreateSitePage.tsx` (`toSlug`, `toThemeColor`, `toThemeTextColor`) have zero semantic relationship to toast notifications.

### 2B: Confidence Honesty

| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `ensureContrast function definition` | LOW | 1,984/4,000 (50%) | Yes — LOW was appropriate for a total miss. Honest. |
| `error handling patterns across the application` | MEDIUM | 1,930/2,000 (97%) | Borderline yes — found 4 error handling patterns across different layers. Missing many API route error patterns. MEDIUM is slightly generous. |
| `how does authentication work` | MEDIUM | 2,380/8,000 (30%) | Yes — found login route, complete-profile, AuthProvider, proxy. Missing register, callback, signOut, session refresh. MEDIUM is fair. |
| `inquiry submission flow` | LOW | 3,718/6,000 (62%) | Yes — LOW was appropriate since it missed the API route (the core of the flow). |
| `theme layout rendering pipeline` | MEDIUM | 4,595/8,000 (57%) | Borderline — found route pages and data fetching but completely missed the actual theme rendering (ThemeRouter, layout components, archetype selection). The "rendering pipeline" part was barely addressed. |

**Summary:** Confidence calibration is reasonably honest. LOW means "this is probably wrong" — correct. MEDIUM means "useful but incomplete" — mostly correct. Never saw HIGH confidence on any query, which may indicate the system is conservative. Would I trust MEDIUM confidence enough to write code without double-checking? No.

### 2C: Budget Utilization

| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `how does authentication work` | 8,000 | 2,380 | **30%** |
| `theme layout rendering pipeline` | 8,000 | 4,595 | **57%** |
| `ensureContrast function definition` | 4,000 | 1,984 | 50% |
| `inquiry submission flow` | 6,000 | 3,718 | 62% |
| `mapSite` (narrow) | 1,200 | 1,171 | 98% |
| `useSitesStore` (narrow) | 1,200 | 1,195 | 100% |
| `showToast` (narrow) | 1,200 | 1,146 | 96% |

**Pattern:** Narrow symbol lookups hit near-100% utilization. Broad architectural queries severely underutilize budget (30-62%). The 30% utilization on "authentication" with 8,000 budget is the worst — CW found 28 symbols across 9 auth-related files but couldn't fill the budget. It should have expanded coverage to the register route, callback handler, signOut, session refresh logic, etc.

**Root cause (likely):** The retrieval pipeline caps the number of candidate symbols early (stageA -> stageB filtering), then the packer fills what it has. With broad queries, the filter is too aggressive, leaving unused budget.

### 2D: Flow Tracing

| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `mapSite` (incoming) | Yes — 10 paths traced | N/A | Correctly traced mapSite <- getSite <- load <- useSites <- useDataLayer <- consumer components. But only showed the `getSite` path; `mapSite` is also called from `getSiteBySlug`, `createSite`, `updateSite` — those incoming paths were missing. |
| `submitPublicInquiry` (outgoing) | Yes | **Yes — HTTP boundary traced!** | Correctly traced `submitPublicInquiry` -> `[framework_entry]` -> `POST` in `route.ts` -> `validateInquiryBody`, `corsJson`, `getRateLimitCookieId`, etc. This is genuinely impressive — it inferred the `fetch('/api/submit-inquiry')` -> Next.js API route connection. |

**Summary:** `cw_flow` is the standout tool. It traces across file boundaries, through hooks and framework conventions, and even across HTTP boundaries via `[framework_entry]` edges. This is something Grep fundamentally cannot do. The `submitPublicInquiry` -> `POST` trace is the single most impressive result in this entire review.

**Caveat:** Flow tracing appears to use the full 647-file index (references files NOT in the 47-file cw_status count), while capsules are restricted to the smaller set. This inconsistency is confusing and undermines the capsule tool.

### 2E: Supporting Tools

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `data layer architecture` | 5/10 | Structure section (directory summary, top files by symbol count, entry points, dependency flows) is useful. But the "Query Focus" section returned irrelevant results: `page.tsx` files about JSON-LD data, not the data layer. Also: reports 647 files indexed while cw_status says 47 — see P0-2. |
| `cw_recall` | `theme system architecture layout archetypes` | 2/10 | Returned documentation snippets from ARCHITECTURE.md and design-prompts README. No learned patterns, no architectural insights. The capsule-insight observation was just a meta-note about a prior query. This is BM25 keyword matching against doc snippets, not real "memory." |
| `cw_impact` | `queries.ts:mapSite` | **9/10** | Excellent. 46 affected symbols across 3 depths. Depth 1: direct callers (getSite, getSiteBySlug, createSite, updateSite). Depth 2: hooks, data layer, edit page handlers. Depth 3: framework routes, UI components. Accurate, comprehensive, genuinely useful for blast radius analysis. The `file:symbol` disambiguation syntax works well. |
| `cw_stats` | (session) | 6/10 | Shows useful session metrics (9 capsules, 20,513 total tokens, 70% avg utilization). But "Indexed: 52 files, 139 symbols" contradicts both cw_status (47/883) and cw_overview (647/4122). Three different file/symbol counts from three tools is a reporting bug. |

## Flaws Found

### P0 (Critical — blocks adoption)

1. **Capsule retrieval fails on indexed symbols:** `ensureContrast` is confirmed indexed in `colorUtils.ts` (8 symbols, verified via `cw_files`), yet `cw_capsule`, `cw_grep`, and `cw_flow` all failed to find it. The capsule returned 12 completely unrelated symbols. Root cause: likely a mismatch between the "active" file set used by capsules vs the full index. The capsule's stageA->stageB retrieval pipeline apparently cannot surface symbols from files outside a narrow working set, even when those files are indexed. **Suggested fix:** Capsule retrieval must search the FULL symbol index, not a subset. If there's a "recently touched files" optimization, it should be a boost factor, not a filter.

2. **Three different file/symbol counts across three tools:** `cw_status` reports 47 files / 883 symbols. `cw_overview` reports 647 files / 4,122 symbols. `cw_stats` reports 52 files / 139 symbols. This makes it impossible to know what's actually indexed. Root cause: each tool appears to count a different scope — cw_status may count "parsed AST files," cw_overview may count "all tracked files," cw_stats counts "session-touched files." **Suggested fix:** Use consistent definitions. Every tool that reports counts should say what it's counting (e.g., "47 AST-parsed source files of 647 tracked files").

3. **cw_grep only searches a subset of indexed files:** `cw_grep("ensureContrast")` returned zero results even though the symbol exists in an indexed file. If `cw_grep` is meant to be a replacement for `rg`/`grep`, it MUST search all project files (or at minimum all indexed files). Currently it appears restricted to the same subset as capsules. **Suggested fix:** `cw_grep` should search the full project (or clearly document its scope). A grep tool that silently skips files is worse than useless — it's actively misleading.

### P1 (Important — degrades quality)

4. **Capsules waste budget on unrelated symbols from consumer files:** When querying `showToast`, the capsule returned `toSlug`, `toThemeColor`, `toThemeTextColor` from `VariationCreateSitePage.tsx` — symbols with zero semantic relationship to toast notifications. They appeared because the file imports `showToast`. Root cause: the packer fills budget by including symbols from files that reference the query target, without filtering for relevance of individual symbols within those files. **Suggested fix:** When a file is included because it references the target symbol, only pack the specific symbol reference and its immediate context — not arbitrary other symbols from the same file.

5. **Severe budget underutilization on broad queries (30%):** The "authentication" query with 8,000 token budget only used 2,380 (30%). CW found 28 symbols across 9 auth-related files but couldn't fill the budget. Meanwhile, the register route, callback handler, signOut flow, and session refresh logic were missing. Root cause (likely): `stageA -> stageB` filtering is too aggressive on broad queries, pruning candidates before the packer runs. The packer can't fill budget with candidates that were already eliminated. **Suggested fix:** For broad/review queries, relax the stageA->stageB filter threshold, or implement a "budget-aware expansion" pass that adds more candidates when utilization is below 50%.

6. **cw_recall returns documentation snippets, not learned patterns:** Asked about "theme system architecture layout archetypes," received ARCHITECTURE.md snippets and design-prompts README links. No synthesized patterns, no architectural insights from prior capsules, no useful cross-session knowledge. Root cause: observations appear to be raw text snippets stored via BM25, not distilled architectural insights. **Suggested fix:** When storing observations from capsules, extract and store structural insights (e.g., "the theme system uses 7 layout archetypes mapped via ThemeRouter") rather than raw doc snippets. Prioritize capsule-derived observations over documentation parroting.

7. **Flow tracing shows incomplete incoming paths:** `cw_flow(source: "mapSite", direction: "incoming")` only showed paths through `getSite`, missing `getSiteBySlug`, `createSite`, and `updateSite` which all call `mapSite` directly. Contrast with `cw_impact("queries.ts:mapSite")` which correctly identified all 4 direct callers. Root cause: flow tracing may have a path limit or deduplication that collapses similar paths, losing some direct callers. **Suggested fix:** Ensure at least one path per direct caller is shown before expanding to deeper paths.

### P2 (Moderate — papercut)

8. **Capsule includes full MOCK_SITES array (270+ lines) in architectural queries:** The "theme layout rendering pipeline" capsule included `MOCK_SITES` at full verbosity — a 270-line mock data array. This is never useful for understanding architecture and wastes significant budget. **Suggested fix:** Detect and auto-compress mock data, test fixtures, and large literal arrays. These should always be skeleton-level at most.

9. **Noise observations from design-prompts docs:** Multiple capsules included observations from `docs/design-prompts/*.md` files (CSS snippets, design prompt text). These are reference documents, not codebase conventions. They pollute the observation store and waste context. **Suggested fix:** Exclude `docs/design-prompts/` from observation extraction, or add a noise filter for pure-documentation directories.

10. **No reindex command available:** The tool set has no `cw_reindex` command. If the index is stale or incomplete, there's no way to force a full rebuild from within the MCP tools. The user must presumably restart the server. **Suggested fix:** Add `cw_reindex({ force?: boolean })` to allow agents to trigger a full reindex when cw_status indicates staleness or when capsule results are clearly incomplete.

11. **cw_overview query focus is unreliable:** Asked for "data layer architecture" and got matches on JSON-LD data pages (`page.tsx` files) and `README.md`. The "query focus" feature uses keyword matching that confuses "data layer" (app architecture concept) with "data" (JSON-LD structured data). **Suggested fix:** Use the same semantic retrieval as capsules for the query focus section, or clearly label it as "keyword matches" to manage expectations.

12. **Corrupt database file present:** `.contextweave/contextweave.db.corrupt.1773824599281` exists alongside the active database. This suggests a past crash or corruption event. While not actively harmful, it signals reliability concerns. **Suggested fix:** Auto-clean corrupt backup files after successful recovery, or log a warning in cw_status when corrupt files exist.

## What Worked Well

1. **`cw_impact` is excellent.** The `queries.ts:mapSite` impact analysis returned 46 affected symbols across 3 depths with high accuracy. It correctly identified direct callers, transitive dependents, and framework entry points. The `file:symbol` disambiguation syntax is intuitive. This tool alone justifies having ContextWeave installed.

2. **`cw_flow` traces across HTTP boundaries.** The `submitPublicInquiry` -> `POST` API route trace via `[framework_entry]` edges is genuinely impressive. This is something grep/read fundamentally cannot do — it requires understanding that `fetch('/api/submit-inquiry')` maps to `src/app/api/submit-inquiry/route.ts:POST`. This is a unique capability.

3. **Confidence calibration is honest.** LOW confidence consistently meant "this answer is wrong/incomplete." MEDIUM consistently meant "partial answer." The system never over-promised. This builds trust even when results are poor.

4. **Symbol definitions rank #1.** For all 3 narrow symbol lookups (`mapSite`, `useSitesStore`, `showToast`), the definition was always the first and highest-ranked result. The disambiguation note for `showToast` ("Found 8 definitions, showing top-ranked from ActionToast.tsx") is helpful.

5. **Multi-level compression is visible and useful.** The `[full]`, `[skeleton]`, `[summary]`, `[reference]` tags clearly indicate how much detail is available. The `... N more lines -- use cw_read(symbol: "X") for full source` hints are actionable.

6. **Diagnostics are insightful.** Messages like "Bottleneck: budget_exhaustion -- Token usage reached 98% with only 43% pivot coverage" and "Bottleneck: packing_scatter -- Packed symbols spread across 13 files at 1.15 symbols/file" give genuine insight into what went wrong and how to adjust queries.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 7 — definitions at #1, but surrounding results are noisy |
| Broad recall (found all relevant files) | 3 — consistently misses key files; capsules draw from a restricted subset |
| Budget utilization (% of budget used) | 4 — narrow queries: 96-100%; broad queries: 30-62%. Bimodal and unpredictable |
| Confidence calibration (honest scores) | 8 — LOW means wrong, MEDIUM means partial. Trustworthy. |
| Flow tracing (traces real call chains) | 8 — cross-file and cross-HTTP tracing works. Missing some incoming paths. |
| Follow-up quality (suggested reads were useful) | 3 — suggestions pointed to wrong tools (cw_grep on a term it can't find) or wrong directories |
| Token savings vs grep+read (measured, not claimed) | 2 — net -7% in raw tokens, but CW answers were incomplete/wrong in 2 of 3 tasks |
| Impact analysis accuracy | 9 — 46 affected symbols, 3 depths, all verified correct |
| **Overall: Would replace Grep+Explore?** | **No -- Partial at best** |

**Verdict:** ContextWeave has two genuinely excellent tools (`cw_impact` and `cw_flow`) that do things grep cannot. But the core tool — `cw_capsule` — is unreliable due to the retrieval subset restriction (P0-1) and noise packing (P1-4). Until capsules reliably search the full index and pack relevant symbols, CW cannot replace grep+read as the primary context tool. The recommended workflow today is: **use `cw_impact` and `cw_flow` for change analysis, but use grep+read for everything else.**

## Evidence Snippets

### P0-1: Capsule retrieval fails on indexed symbols

```
Query: cw_capsule({ query: "ensureContrast function definition and all callers for WCAG color contrast", token_budget: 4000, mode: "review" })
Result: 12 symbols across 3 files (queries.ts, ModularLayout.tsx, VariationCreateSitePage.tsx)
         Confidence: LOW. Zero results related to ensureContrast.

Verification: cw_files({ pattern: "**/colorUtils*" })
Result: colorUtils.ts -- lang: typescript, symbols: 8, indexed: 2026-03-18T10:20:50

Verification: Grep("ensureContrast") -- found in 14 source files, defined at colorUtils.ts:70
```

The symbol exists in the index. The capsule cannot find it.

### P0-2: Three different file counts

```
cw_status():   Files: 47,  Symbols: 883,   Edges: 290
cw_overview(): Files: 647, Symbols: 4,122, Edges: 6,170
cw_stats():    Files: 52,  Symbols: 139    (session scope)
```

### P1-4: Noise symbols from consumer files

```
Query: cw_capsule({ query: "showToast", token_budget: 1200 })
Result includes from VariationCreateSitePage.tsx:
  - toSlug (line 130) -- string slug converter
  - toThemeColor (line 278) -- CSS class builder
  - toThemeTextColor (line 282) -- CSS class builder
None of these are related to toast notifications. They appear because the file imports showToast.
```

### P1-5: Budget underutilization

```
Query: cw_capsule({ query: "how does authentication work", token_budget: 8000, mode: "review" })
Result: 2,380/8,000 tokens used (30%)
        28 symbols across 9 files
        Missing: register route, callback handler, signOut, session refresh
```

### 2D: HTTP boundary tracing (positive evidence)

```
Query: cw_flow({ source: "submitPublicInquiry", direction: "outgoing" })
Path 2:
  [framework_entry] -> function POST (src/app/api/submit-inquiry/route.ts:86)
  [call] -> function getRateLimitCookieId (src/lib/rateLimit.ts:137)
  [call] -> function parseCookies (src/lib/rateLimit.ts:103)

CW correctly inferred: fetch('/api/submit-inquiry') -> Next.js route -> POST handler
This is something grep cannot do.
```
