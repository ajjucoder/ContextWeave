# ContextWeave Field Review: Kuvio Website Builder

**Date:** 2026-03-09
**ContextWeave Version:** (from cw_status — no explicit version reported)

## Project Profile

| Metric | Value |
|--------|-------|
| Project | Kuvio (formerly Sitecraft) — multi-sector website builder |
| Stack | Next.js 16 (App Router) + Supabase + Zustand + Tailwind CSS v4 |
| Lines of Code | ~52,226 |
| Source Files | 368 (.ts/.tsx/.js/.jsx) |
| Files Indexed | 459 (includes .md, .json, .yaml, .sh) |
| Symbols Indexed | 2,469 |
| Edges | 5,612 |
| Languages | TSX (235), TypeScript (144), Markdown (63), JSON (11), JS (3), YAML (2), Bash (1) |
| Index Time | Pre-indexed (no reindex performed) |
| Architecture | Feature-sliced Next.js App Router with Supabase backend, Zustand fallback store, data layer abstraction |
| Key Directories | `src/features/`, `src/lib/`, `src/components/`, `src/app/` |

---

## Task-Based Results

### Task A: Find and understand `showToast` — a utility function with callers across 20+ files

**ContextWeave Phase (capsule @ 2000 token budget):**
- Capsule reported **HIGH confidence, VERY_LOW uncertainty** — 1777/2000 tokens used
- Returned 10 symbols across 4 files
- **Did NOT return the `showToast` definition from `ActionToast.tsx:236`** — instead showed `getContainer` (an internal helper)
- Showed one caller (`AllSitesPage.handleDeleteSite`) — out of ~25 caller files
- **Filled 70%+ of tokens with completely irrelevant code**: `getWorkspaceEditors`, `isSupabaseNotFoundError`, `getAllProfiles` (from queries.ts), `LandingHowItWorks` (landing page UI), `isProtectedPath`/`getAll`/`setAll` (from proxy.ts)
- Follow-up reads suggested: `SiteCard` (irrelevant)

**Second attempt with exact symbol query (1200 budget):**
- Confidence dropped to **LOW, HIGH uncertainty** — honest this time
- Returned `showToast` as a **summary only** (just the signature, no body)
- Filled budget with test mock lines and unrelated page components (`VariationProjectsPage`, `SiteDashboardPage`, `CreateSiteWizard.reset`)
- Definition was in the suggested follow-ups but compressed away

**Grep+Read Phase:**
- 1 Grep call: found definition at `ActionToast.tsx:236` plus all 25+ caller files with line numbers — ~800 tokens of output
- 1 Read call: `ActionToast.tsx` full source — ~1100 tokens
- Total: ~1,900 tokens for a **complete** answer

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~1,777 (first attempt) + ~1,200 (retry) = ~2,977 | ~1,900 |
| Tool calls | 2 capsules | 1 Grep + 1 Read |
| Completeness | Failed (missed definition, found 1/25 callers) | Complete |
| Time to correct answer | Never reached correct answer | Immediate |

**What ContextWeave found:** One caller site (AllSitesPage) and test mock patterns.
**What ContextWeave missed:** The function definition body, the `ToastOptions` type, 24 of 25 caller files. Critically, 70%+ of tokens went to completely unrelated symbols.
**Follow-up suggestions useful?** No — suggested `SiteCard` (irrelevant). Second attempt suggested `showToast` read (correct but should have been in the capsule).
**Winner:** Grep+Read — decisively. ContextWeave cost 56% more tokens and returned an incorrect answer with HIGH confidence.

---

### Task B: Trace inquiry submission flow — from UI form through API route to email notification

**ContextWeave Phase (capsule @ 3000 token budget):**
- Reported **HIGH confidence, VERY_LOW uncertainty** — 2560/3000 tokens
- Found key files: `Inquiry` type, `buildInquiryEmailHtml`, `buildInquiryEmailText`, `mapInquiry`, `DbInquiry`, `getAllowedOrigin` (from submit-inquiry route)
- **Also found `showToast` definition and `ToastCard`** — consuming ~800 tokens on the toast system that's tangentially related at best
- **Missed the critical UI entry point**: `publicInquiry.ts` (`submitPublicInquiry` function) — the client-side function that initiates the flow
- **Missed the actual contact form components** in the public site templates
- Included irrelevant code: `isAllowedKey` (admin settings), `logos` (landing page), `metadata` (privacy page), `handleSignOut` (trial expired page), `message` variable (CreateSiteWizard)
- Only showed `getAllowedOrigin` from the API route — not the `POST` handler that contains the actual logic
- Follow-up reads suggested: `logos` (landing page constant — completely irrelevant)

**Grep+Read Phase:**
- 1 Grep for `submit-inquiry|submitInquiry`: found `publicInquiry.ts`, `route.ts`, `proxy.ts` CSRF exempt, and test file — ~700 tokens
- 1 Read of `publicInquiry.ts` (39 lines): client-side entry point — ~300 tokens
- 1 Read of `route.ts` (227 lines): full API handler with rate limiting, Supabase insert, Resend email — ~1,800 tokens
- Total: ~2,800 tokens for a **complete** end-to-end trace

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,560 | ~2,800 |
| Tool calls | 1 capsule | 1 Grep + 2 Reads |
| Completeness | Partial (found email builder + types, missed UI entry point + API handler body) | Complete |
| Time to correct answer | Partial understanding | Complete understanding |

**What ContextWeave found:** Email templates, inquiry types/mappers, CORS helper — the "middle" of the flow.
**What ContextWeave missed:** The UI entry point (`submitPublicInquiry`), the API handler body (`POST`), the contact form components, the Resend integration details. The capsule's suggested follow-ups were all wrong files.
**Follow-up suggestions useful?** No — suggested reading `logos` from landing page and `ToastTone` type.
**Winner:** Grep+Read — similar token cost but complete vs partial answer. ContextWeave found supporting types but missed the actual flow.

---

### Task C: How does data fetching/state management work across the app?

**ContextWeave Phase (capsule @ 3000 token budget):**
- Reported **MEDIUM confidence** (first time not HIGH) — 2733/3000 tokens, 71% coverage confidence
- **Strong hits**: `useDataLayer`, `useSiteDataLayer`, `wrapStore` from `dataLayer.ts` — the core abstraction layer
- **Strong hits**: `useSitesStore`, `SitesState` interface from `sitesStore.ts` — the Zustand store
- **Noise**: `AdminSettingsPage` (218 lines of admin QR upload code), `VariationCreateSitePage` form data, `EmptyState` component, `sitecraft /App.tsx` (legacy prototype), a markdown plan file
- **Critical miss**: `hooks.ts` — the Supabase data hooks (`useSites`, `useSite`, `useProfile`) with the caching layer (`sitesCache`, `siteCache` Map, `syncSupabaseCacheUser`) — this is WHERE the actual data fetching happens
- **Critical miss**: `useSupabaseMutations` — the mutations half of the data layer
- 24% L3 noise reported by ContextWeave itself

**Grep+Read Phase:**
- 1 Grep for `useDataLayer|useSiteDataLayer|useSites\b|useSite\b`: found 34 files — ~500 tokens
- 1 Read of `hooks.ts` (322 lines): full caching layer, auth-aware hooks — ~2,500 tokens
- (Already had `dataLayer.ts` from CW capsule for comparison)
- Total: ~3,000 tokens for a **complete** answer

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,733 | ~3,000 |
| Tool calls | 1 capsule | 1 Grep + 1 Read |
| Completeness | Partial (found abstraction layer, missed implementation) | Complete |
| Time to correct answer | Partial understanding | Complete understanding |

**What ContextWeave found:** The data layer abstraction (`useDataLayer` → Supabase or Zustand), the Zustand store shape, the wrapStore adapter. Good architectural overview of the facade pattern.
**What ContextWeave missed:** The actual Supabase hooks (`useSites`, `useSite`) where data fetching happens, the module-level caching strategy (`sitesCache`, `siteCache` Map), the auth-state-change cache invalidation, `useSupabaseMutations`. This is like understanding a function's signature but not its body.
**Follow-up suggestions useful?** Partially — suggested reading `handleFileUpload` (admin page, irrelevant) and a markdown plan file.
**Winner:** Grep+Read — similar cost, complete answer vs partial.

---

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: ~8,270 (counting both Task A attempts)
- Total Grep+Read tokens across 3 tasks: ~7,700
- Actual savings: **-7%** (ContextWeave cost MORE)

---

## Stress Test Results

### Exact Symbol Ranking (2A)

| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `showToast` | No — summary only at position 1, but no body. Test mocks and unrelated components consumed the budget | Correctly identified file, but compressed the definition to a 1-line signature while giving full source to `VariationProjectsPage` (80 lines, irrelevant) |
| `useDataLayer` | Yes — full source shown at position 1 | Correctly prioritized, but 47% pivot coverage only |
| `mapSite` | Yes — full source at position 1, plus `updateSite` and `updateSiteStatus` callers | Good result — definition + immediate callers, clean 2-file capsule |

### Confidence Honesty (2B)

| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `showToast` (first attempt, 2000 budget) | HIGH / VERY_LOW uncertainty | 1777/2000 (89%) | **No** — HIGH confidence but completely failed the task. Definition was not shown. 70%+ of tokens were irrelevant (queries.ts, LandingHowItWorks, proxy.ts). This is the worst kind of miscalibration. |
| `error handling patterns across the application` | LOW / MEDIUM uncertainty | 1643/2000 (82%) | **Yes** — honestly reported LOW. Found some error helpers but knew it wasn't comprehensive. This is correct calibration. |

### Budget Utilization (2C)

| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `Supabase RLS policies and security` | 8,000 | 7,017 | 88% |
| `site template rendering and layout system` | 8,000 | 2,552 | **32%** — severe underutilization |

The template/layout query is notable: 8000 token budget, only 2552 used, 37% pivot coverage, LOW confidence. It had budget to spare but couldn't find enough relevant symbols. Meanwhile it included the legacy `sitecraft /App.tsx` (38 lines of Vite prototype) and `submit-inquiry/route.ts` (172 lines — completely unrelated to templates).

### Flow Tracing (2D)

| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `useDataLayer` | Yes — traced to `useSites`, `useSitesStore`, `load`, `createClient`, `syncSupabaseCacheUser`, `clearSupabaseSiteCaches` | N/A (no HTTP boundary) | Good result. Correctly followed import→call chains 5 hops deep. Some noise with duplicate `User` interface paths across 3 `types.ts` files. |
| `submitPublicInquiry` | Partially — traced to `POST` handler via `framework_entry` | **Partially** — recognized `fetch('/api/submit-inquiry')` as a `framework_entry` edge to the `POST` handler. But then only traced the server-side dependencies (createClient, createAdminClient), not the Resend email call chain. | The `framework_entry` inference is impressive — it connected client `fetch()` to server route handler. But downstream tracing stopped at Supabase client creation, missing `buildInquiryEmailHtml`, `consumeRateLimit`, and the dynamic `import('resend')`. |

### Supporting Tools (2E)

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | "authentication and authorization" | 4/10 | Listed relevant files (`auth.ts`, `login/page.tsx`, `proxy.ts`, `callback/route.ts`) but then included irrelevant ones (`LandingPage.tsx`, `command.tsx`, `layout.tsx`). Said "no direct symbol name match" for every file — the query focus section added almost no value beyond the file list. No architectural insight about HOW auth works. |
| `cw_recall` | "architecture decisions data layer" | 1/10 | Returned "No observations found" — after 9 capsules in this session. The memory is empty despite extensive usage. This tool only works if someone manually calls `cw_remember`, which means it's useless for first-time analysis of a codebase. |
| `cw_impact` | `mapSite` | 9/10 | **Excellent.** Found 43 affected symbols across 3 depth levels. Depth 1: direct callers (getSite, getSiteBySlug, createSite, updateSite). Depth 2: hooks, data layer, page handlers. Depth 3: route pages, inner components. This is genuinely useful for refactoring and would be very expensive to replicate with grep. |
| `cw_stats` | (session stats) | 3/10 | Claims "86% reduction" (est. 158K grep+read tokens vs 21.8K CW tokens). This is **wildly misleading**. The estimate assumes you'd read every file the capsule touched, but a skilled developer using grep would read far fewer files and only the relevant lines. My actual measured savings were -7% (CW cost more). The stat is marketing, not engineering. |

---

## Flaws Found

### P0 (Critical — blocks adoption)

1. **HIGH confidence on wrong answers (showToast task)**: The first capsule for "showToast" reported HIGH confidence / VERY_LOW uncertainty while returning zero useful content — the definition was absent, 70%+ of tokens were completely unrelated code (queries.ts functions, landing page component, proxy helpers). A developer trusting this confidence would write code based on incomplete/wrong context. **Root cause**: Confidence appears to be computed from retrieval coverage metrics (pivots found, dependencies resolved) rather than semantic relevance to the query. The system found "pivots" (file/symbol matches) but those matches were on unrelated symbols in files that happened to import `showToast`. **Fix**: Confidence must penalize cases where the primary query term's *definition* is absent from results. If the user asks about "showToast" and the function body isn't in the capsule, confidence cannot be HIGH regardless of how many callers were found.

2. **Noise domination — irrelevant symbols consume budget**: Across all 3 tasks, 40-70% of capsule tokens went to symbols with no relevance to the query. Examples: `LandingHowItWorks` in a showToast query, `AdminSettingsPage` (218 lines of QR upload code) in a state management query, `isSlugTakenInDb` in an inquiry flow query, `logos` array in an inquiry flow query. **Root cause**: The retrieval pipeline (stageA → stageB) casts a wide net but the packing stage doesn't filter aggressively enough. Files that *import* a relevant symbol get their other symbols packed too. **Fix**: After selecting files, score each individual symbol for relevance to the query before packing. A file being relevant doesn't make all its symbols relevant.

3. **Missing definitions in symbol-lookup mode**: When queried with an exact symbol name like "showToast", the system should ALWAYS return the definition as the #1 result with full source. Instead, it returned a 1-line summary of the definition while giving full source to `VariationProjectsPage` (80 lines, score 26.96 — irrelevant). The definition scored 459.52 but was compressed to a summary. **Root cause**: The packing algorithm compressed the highest-scored symbol to make room for lower-scored symbols from other files. The "spread across 12 files at 1.17 symbols/file" diagnostic confirms this — it's prioritizing file diversity over symbol relevance. **Fix**: For symbol-lookup queries, anchor the target definition at full fidelity before allocating budget to anything else. The diagnostics correctly identified this as `packing_scatter` but the fix wasn't applied.

### P1 (Important — degrades quality)

4. **Follow-up suggestions are mostly wrong**: Across all capsules, follow-up `cw_read` suggestions were rarely useful. Examples: suggested reading `logos` (landing page array) for an inquiry flow query, `handleFileUpload` (admin page) for a state management query, `2026-02-27 p1 remaining mvp` (plan doc) for a mapSite query. **Root cause**: Follow-ups seem to be based on score ranking of compressed symbols rather than relevance to the original query. **Fix**: Filter follow-up suggestions through the same relevance scoring used for the query, not just compression score.

5. **Legacy/prototype files pollute results**: The `sitecraft /App.tsx` (Vite prototype) and `sitecraft /types.ts` appeared in multiple capsules despite being a deprecated legacy app in a subdirectory with a trailing space. Similarly, `sitecraft_demo_AIStudio/` files appeared in flow traces. **Root cause**: The indexer treats all files equally regardless of project structure. The `.cwignore` excludes `node_modules` and build dirs but not legacy code. **Fix**: Either respect a project-root config that marks subdirectories as deprecated/low-priority, or use heuristics (separate `package.json`, different framework) to downrank symbols from non-primary source roots.

6. **cw_stats claims are misleading**: Reports "86% token reduction" by comparing actual CW usage against an inflated estimate of grep+read cost. The estimate assumes reading entire files for every symbol, but real grep+read is targeted. My measured comparison showed CW cost 7% MORE than grep+read across 3 tasks. **Root cause**: The "equivalent grep+read" estimate is a worst-case calculation, not a realistic baseline. **Fix**: Don't report savings estimates at all, or use a more honest baseline (e.g., grep lines + targeted file reads, not full file reads).

7. **HTTP/fetch flow tracing is shallow**: `cw_flow` correctly inferred that `submitPublicInquiry`'s `fetch()` call connects to the `POST` handler (impressive `framework_entry` inference). But downstream tracing stopped at Supabase client creation — it missed `consumeRateLimit`, `buildInquiryEmailHtml`, and the dynamic `import('resend')`. **Root cause**: Dynamic imports (`await import('resend')`) aren't in the static AST graph. Rate limit and email builder are imported at top of file but the flow tracer doesn't follow all call-site edges within the function body. **Fix**: For `framework_entry` targets, trace ALL edges from the handler function body, not just import edges.

### P2 (Moderate — papercut)

8. **Budget underutilization on broad queries**: The template/layout query used only 32% of an 8000-token budget while reporting LOW confidence and 37% pivot coverage. It had 5,448 unused tokens but couldn't find relevant symbols to fill them. **Root cause**: The retrieval pipeline found 120 candidates in stageA but filtered down to only 16 in stageB, then couldn't fill the budget with those 16 symbols. The issue is that the layout files themselves (`MonolithLayout.tsx`, `AtelierLayout.tsx`, etc.) weren't in the results at all. **Fix**: When budget is severely underutilized (<50%) and confidence is LOW, expand the stageB filter or fall back to directory-based retrieval for the most relevant directories.

9. **Duplicate content in capsules**: The `showToast` query (first attempt) included `handleDeleteSite` twice — once as part of `AllSitesPage` (full, 125 lines) and again as an extracted block (13 lines). The cleanup function from `ActionToast.tsx` also appeared twice in the inquiry task capsule. **Root cause**: The packer shows both the containing function and extracted sub-functions without deduplication. **Fix**: Deduplicate overlapping line ranges within the same file.

10. **cw_recall is empty by default**: Returns nothing unless someone manually calls `cw_remember`. For a first-time reviewer of a codebase (the primary use case for context tools), this tool is inert. **Root cause**: The observation store requires explicit writes. **Fix**: Auto-populate observations from capsule results that have HIGH confidence, or from `cw_impact` results that reveal important dependency chains.

---

## What Worked Well

1. **`cw_impact` is genuinely excellent.** The `mapSite` impact analysis found 43 affected symbols across 3 depth levels, correctly tracing from the function through its callers, through hooks, through page components, all the way to Next.js route files. This would require 5-10 grep calls and significant manual analysis to replicate. This is the standout feature.

2. **`cw_flow` framework_entry inference.** Connecting `submitPublicInquiry`'s `fetch('/api/submit-inquiry')` call to the server-side `POST` handler is impressive. Most static analysis tools can't cross HTTP boundaries. The implementation isn't perfect (shallow downstream tracing) but the concept is strong.

3. **`mapSite` capsule was clean.** When the query had a unique, well-scoped symbol name, the capsule returned a focused 2-file result with the definition + callers + related functions. 98% budget utilization, correct file identification. This shows the system CAN work well for precise queries.

4. **Honest LOW confidence on broad queries.** The "error handling patterns" and "site template rendering" queries correctly reported LOW confidence. This calibration was accurate — the capsules were indeed incomplete. The problem is that narrow queries (showToast) got dishonest HIGH confidence.

5. **Self-diagnostics are useful.** The `packing_scatter` bottleneck identification, the "budget_exhaustion" warning, and the "pivot coverage below 50%" notes are genuinely helpful. The system knows when it's failing — it just doesn't prevent the failure or adjust confidence accordingly.

---

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 4 — `mapSite` was perfect, `useDataLayer` was good, `showToast` completely failed |
| Broad recall (found all relevant files) | 3 — consistently missed 50-70% of relevant files on broad queries |
| Budget utilization (% of budget used) | 5 — ranged from 32% to 100%, averaging ~75% |
| Confidence calibration (honest scores) | 3 — HIGH confidence on the worst result (showToast) is a critical miscalibration |
| Flow tracing (traces real call chains) | 7 — direct call chains are excellent, HTTP inference is impressive but shallow |
| Follow-up quality (suggested reads were useful) | 2 — suggestions were mostly irrelevant files/symbols |
| Token savings vs grep+read (measured, not claimed) | 2 — measured -7% (cost more), self-reported "86% savings" is misleading |
| **Overall: Would replace Grep+Explore?** | **No — Partial at best** |

**Verdict:** ContextWeave cannot replace Grep+Read for a skilled developer on this codebase. The `cw_impact` tool is a genuine addition to the toolkit and should be used for refactoring tasks. `cw_flow` shows promise for tracing cross-boundary connections. But `cw_capsule` — the primary tool — has a critical noise problem that makes it unreliable: it returns irrelevant code with HIGH confidence, consuming tokens that would be better spent on targeted grep+read. The recommended workflow is: use `cw_impact` before modifying symbols, use `cw_flow` to understand call chains, but use Grep+Read (not `cw_capsule`) for understanding code.

---

## Evidence Snippets

### Evidence 1: showToast HIGH confidence failure
```
Query: "showToast function - how it works, where it's defined, and all callers"
Budget: 2000 tokens
Result: Confidence: HIGH | Uncertainty: VERY_LOW | Coverage: 91%
Files returned: AllSitesPage.tsx, queries.ts, LandingHowItWorks.tsx, proxy.ts
ActionToast.tsx relevance: 0.25 (ranked last)
Symbols from ActionToast.tsx: getContainer (internal helper, not showToast)
```
The definition file was ranked LAST (0.25 relevance) and the wrong symbol was extracted from it. queries.ts (relevance 0.77), LandingHowItWorks (0.75), and proxy.ts (0.56) all outranked the file containing the definition.

### Evidence 2: Noise in inquiry flow capsule
```
Query: "inquiry submission flow - from contact form UI through API route to email notification"
Files with relevance < 0.1 that consumed tokens:
  - app/api/admin/platform-settings/route.ts (0.09) — isAllowedKey function
  - app/(landing)/v1/page.tsx (0.08) — logos array
  - app/legal/privacy/page.tsx (0.08) — metadata constant
  - app/auth/trial-expired/page.tsx (0.07) — handleSignOut
  - features/create-site/CreateSiteWizard.tsx (0.04) — message variable
```
5 of 10 files had relevance below 0.1 and contributed nothing to understanding the inquiry flow.

### Evidence 3: Budget underutilization
```
Query: "site template rendering and layout system"
Budget: 8000 | Used: 2552 | Utilization: 32%
Pivot coverage: 37% (16/43)
Files NOT found: MonolithLayout.tsx, ModularLayout.tsx, PrismLayout.tsx, AtelierLayout.tsx, ForgeLayout.tsx
Files found instead: submit-inquiry/route.ts (172 lines, 0% relevance to templates)
```
The 5 actual layout template files were completely absent from the results despite being the core of what was queried.

### Evidence 4: cw_stats misleading savings claim
```
Claimed: grep+read cost ~158,567 tokens, CW used ~21,853, savings 86%
Actual measured across 3 tasks:
  CW total: ~8,270 tokens
  Grep+Read total: ~7,700 tokens
  Actual savings: -7% (CW cost more)
```

### Evidence 5: cw_impact excellence
```
Query: cw_impact("mapSite")
Result: 43 affected symbols across 3 depth levels
Depth 1: getSite, getSiteBySlug, createSite, updateSite (4 direct callers)
Depth 2: hooks.load, dataLayer.addSite, 10 page handler functions (15 symbols)
Depth 3: route pages, inner components, test mocks (24 symbols)
```
This would require ~5 grep calls and ~10 file reads to replicate manually. Genuine value-add.
