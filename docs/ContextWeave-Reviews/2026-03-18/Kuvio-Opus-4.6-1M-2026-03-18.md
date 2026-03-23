# ContextWeave Field Review: Kuvio (Website Builder)

**Date:** 2026-03-18
**ContextWeave Version:** From cw_status — no explicit version string reported (finding in itself)
**Reviewer Model:** Claude Opus 4.6 (1M context)

## Project Profile

| Metric | Value |
|--------|-------|
| Project | Kuvio — multi-sector website builder for Nepal businesses |
| Stack | Next.js 16 (App Router) + Tailwind CSS v4 + Zustand + Supabase |
| Lines of Code | 99,207 |
| Source Files | 567 (546 indexed by CW) |
| Symbols Indexed | 3,277 (cw_status) / 3,701 (cw_overview) — discrepancy noted |
| Languages | TSX (258), TypeScript (173), Markdown (101), JS (6), JSON (5), YAML (2), Bash (1) |
| Index Time | Pre-existing (already indexed from prior session) |
| Architecture | Feature-based modular: `src/features/`, `src/components/`, `src/lib/`, `src/app/` |
| Key Directories | `kuvio/src/` (441 files, 3521 symbols), `kuvio/docs/` (79 files) |

---

## Task-Based Results

### Task A: Find and understand `mapSite` (transforms DB rows to Site type)

A function in `queries.ts` with callers across the same file — 6 call sites total. Generic name pattern ("map" + domain noun).

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~4,039 (capsule 2889 + cw_read 350 + cw_flow 800) | ~1,670 |
| Tool calls | 3 (capsule + cw_read + cw_flow) | 7 (3 grep + 4 read) |
| Completeness | Partial | Complete |
| Time to correct answer | Did not reach correct answer | 4 tool calls |

**What ContextWeave found:**
- Full `mapSite` definition (but STALE — missing 6 fields added for healthcare/restaurant sectors: `operatingHours`, `certifications`, `availabilityStatus`, `autoResponseEnabled`, `priceCategories`, `menuCategories`)
- 3 of 6 callers: `getSite`, `getSiteBySlug`, `createSite`
- Dependencies: `coerceThemePreset`, `mapProject`, `mapTeamMember`, etc. (via summaries in other files)
- `cw_flow` traced the incoming call chain all the way from `mapSite → getSite → load → useSites → useDataLayer → [5 leaf components]` — impressive depth

**What ContextWeave missed:**
- 3 of 6 callers: `getUserSites` (2 `.map(mapSite)` calls at lines 512/515) and `updateSiteField` (line 660) — 50% caller recall within the SAME file
- The 6 healthcare/restaurant fields in the actual function body (stale index)
- `cw_read(symbol: "Site")` returned lines 152-197 which are `LayoutType` union, `VALID_LAYOUTS`, `resolveLayout()`, and `ThemePreset` — NOT the `Site` interface (which starts at line 201). The symbol-to-line-range mapping was wrong.

**What ContextWeave included that was NOISE:**
- `admin/export/[type]/route.ts` at relevance 0.99 — a completely unrelated CSV export route whose `rows` variable matched because it uses `.map()`. Nothing to do with `mapSite`.
- `constructionTemplateData.ts`, `publicMetadata.ts`, `siteCompleteness.ts`, `siteMockData.ts`, `publicUrl.ts` — these consume the `Site` type but have zero relationship to `mapSite`
- Test files (`adminDataMapping.test.ts`, `constructionTemplateData.test.ts`) with irrelevant skeleton data

**Follow-up suggestions useful?** No — `cw_read(symbol: "Site")` returned the wrong line range. The suggestion was correct in intent but the execution returned `LayoutType`/`ThemePreset` instead of the `Site` interface.

**Winner: Grep+Read** — 2.4x cheaper, complete, current code

---

### Task B: Trace inquiry submission flow (UI → HTTP → API → DB)

End-to-end flow: `useQuoteForm` hook → `submitPublicInquiry` client lib → `fetch('/api/submit-inquiry')` → API route handler → validation → rate limiting → Supabase insert → email notification.

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 2,995 (capsule only — follow-ups were wrong) | ~1,850 |
| Tool calls | 1 | 4 (2 grep + 2 read) |
| Completeness | Partial (API-side only, truncated) | Complete |
| Time to correct answer | Never reached — missed client side entirely | 4 tool calls |

**What ContextWeave found:**
- The API route handler `POST` in `submit-inquiry/route.ts` (truncated at 113 lines)
- `corsJson` helper function
- `addInquiry` in `queries.ts` (the DB write function)
- `markInquiryRead` in `sitesStore.ts`

**What ContextWeave missed (critically):**
- `useQuoteForm` hook (`src/hooks/useQuoteForm.ts`) — the UI entry point
- `submitPublicInquiry` (`src/lib/publicInquiry.ts`) — the client-side function that calls `fetch()`
- `validatePublicInquiryInput` — client-side validation
- `validateInquiryBody` (`src/lib/inquiryValidation.ts`) — server-side validation
- `consumeRateLimit` (`src/lib/rateLimit.ts`) — rate limiting
- `buildInquiryEmailHtml` (`src/lib/inquiryEmail.ts`) — email notification

**What ContextWeave included that was NOISE (1,500+ tokens wasted):**
- 7 UNRELATED API route handlers all scored 0.82-0.94 relevance: `admin/unban-user`, `admin/update-role`, `admin/upgrade-user`, `auth/complete-profile`, `auth/login`, `auth/register`, `generate-copy`, `track-view`, `uploads`. Every API route exports `POST`, and the retrieval matched on the symbol name `POST`.
- `ProjectsAllPage.tsx` and `AboutPage.tsx` scroll handlers (matched on "handler" — NOT form submission handlers)
- `publicMetadata.ts`, `publicUrl.ts` — irrelevant

**Follow-up suggestions were actively wrong:**
- "Read the highest-value compressed symbol: `handler` in ProjectsAllPage.tsx" — this is `() => setScrolled(window.scrollY > threshold)`, a scroll handler. Completely irrelevant.
- "Narrow to `app/api/submit-inquiry`" — would help for API side but still misses the client-side flow

**Ironic twist:** `cw_flow(source: "submitPublicInquiry")` traced the ENTIRE flow perfectly — including the HTTP boundary via `framework_entry` edge to the API route. The flow tool can do what the capsule cannot. But the capsule doesn't leverage flow data for retrieval.

**Winner: Grep+Read** — 1.6x cheaper, complete, traced full chain in 4 calls

---

### Task C: How does state management work across the app?

Architectural question requiring understanding of Zustand store, data layer hooks, Supabase hooks, caching strategy, and how components consume the abstraction.

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 1,621 (27% of 6,000 budget) | ~1,600 |
| Tool calls | 1 | 5 (3 grep + 2 read) |
| Completeness | Failed | Complete |
| Time to correct answer | Never | 5 tool calls |

**What ContextWeave found:**
- `ErrorBoundary.tsx` `interface State { hasError: boolean; error: Error | null }` — ranked #1 at relevance 1.0. This is a React class component error state interface. NOT state management.
- `sitesStore.ts` skeletons (`useSitesStore`, `SitesState`) — correct but only skeleton level
- `dataLayer.ts` `wrapStore` function — correct but only 1 of ~10 relevant functions in this file
- `rateLimit.ts` full `consumeRateLimit` implementation (90 lines) — NOTHING to do with state management

**What ContextWeave missed (the entire architecture):**
- `useDataLayer()` and `useSiteDataLayer()` — THE two primary hooks that every component uses
- `useSites()` and `useSite()` in `hooks.ts` — the Supabase-backed hooks
- Module-level caching (`sitesCache`, `siteCache` Map) in `hooks.ts`
- The Zustand-vs-Supabase routing logic (`supabaseConfigured` flag)
- How any component actually consumes data

**What ContextWeave included that was NOISE:**
- `rateLimit.ts` (90 lines, relevance 0.09) — rate limiting has nothing to do with state management
- Landing pages v1/v2, `LandingPage.tsx` — included `const D = "font-[...]"` variable. Irrelevant.
- `VariationCreateSitePage.tsx` `toThemeTextColor` — color utility. Irrelevant.
- `queries.ts` `WorkspaceEditor` interface — editor type. Irrelevant.

**Root cause:** The word "state" matched `ErrorBoundary.tsx`'s `interface State` as the #1 result (relevance 1.0). The retrieval treated a lexical match on a 4-line error boundary interface as MORE relevant than the entire Zustand + data layer system. This is a fundamental semantic understanding failure.

**Follow-up suggestions were wrong:**
- "Read WorkspaceEditor" — irrelevant
- "Read toThemeTextColor" — irrelevant
- "Narrow to src/components" — state management lives in `src/lib`, not `src/components`

**Winner: Grep+Read** — same cost, actually answered the question

---

### Overall Token Comparison

| | ContextWeave | Grep+Read |
|---|---|---|
| Task A | 4,039 | 1,670 |
| Task B | 2,995 | 1,850 |
| Task C | 1,621 | 1,600 |
| **Total** | **8,655** | **5,120** |
| **Actual savings** | **-69% (CW cost 69% MORE)** | — |

ContextWeave did not save tokens in any of the 3 tasks. It cost more and delivered less in every case.

---

## Stress Test Results

### Exact Symbol Ranking

| Symbol | Definition at #1? | What outranked it? | Noise in results |
|--------|------------------|--------------------|-----------------|
| `showToast` | Yes (ActionToast.tsx) | — | 5 test file mocks shown at [full], `VariationProjectsPage` (222 lines!), `toSlug`/`toThemeColor`/`toThemeTextColor` |
| `useQuoteForm` | Yes (hooks/useQuoteForm.ts) | — | `AUDIT_PROMPT.md` (425 lines of markdown!), `mvp-completion-sprint-design.md` (299 lines) |
| `computeSectorHealth` | Yes (siteCompleteness.ts) | — | Minimal noise — best capsule result of the review |

**Verdict:** Definition ranking works — the right file appears first. But the remaining budget is wasted on massive noise: test mocks, unrelated utility functions, and entire markdown documents.

### Confidence Honesty

| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| "error handling" | HIGH | 1,974/2,000 (99%) | Partially — found error utilities and error boundary pages but missed error handling patterns in try/catch across routes. HIGH + HIGH uncertainty is contradictory. |
| "authentication" | LOW | 1,533/2,000 (77%) | Yes — honestly LOW. Missed AuthProvider, useAuth, proxy middleware, OAuth callback. But included DEVELOPMENT.md (154 lines, irrelevant padding). |

**Verdict:** LOW confidence is honest. HIGH confidence is NOT — it reports HIGH even when pivots coverage is only 54% and the answer would not be trustworthy enough to code against.

### Budget Utilization

| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| "dashboard navigation system" | 8,000 | 1,126 | **14%** |
| "sector-specific features" | 8,000 | 1,946 | **24%** |

**Dashboard navigation (14%):** The retrieval fundamentally failed. #1 result was `proxy.ts` middleware config matcher regex. #2 was `InquiriesPage.tsx` badge color config. #3 was `postcss.config.mjs`. All matched on the word "config" — none are the navigation system. Missed: `nav-config.ts`, `Sidebar.tsx`, `TopBar.tsx`, `DashboardShell.tsx`.

**Sector features (24%):** #1 result was `admin/tiers/route.ts` `const features = ...` (3-line destructuring). Also included `ContextWeaveLanding.tsx` features array (describing ContextWeave itself, not sectors), `proxy.ts` getAll/setAll methods, and `AllSitesPage` (125 lines). Did find `SECTORS`, `HEALTHCARE_SERVICES`, `RESTAURANT_SERVICES` as skeletons but buried at relevance 0.10.

**Verdict:** Large budgets are wasted. The retrieval cannot find enough relevant symbols, so it pads with noise. The system should either return less data or admit it can't fill the budget — not pad with `postcss.config.mjs`.

### Flow Tracing

| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `useDataLayer` (outgoing) | Yes — traced to `useSitesStore`, `useSites`, `load`, `getSites` | N/A | Excellent. Showed the full data flow correctly. |
| `submitPublicInquiry` (outgoing) | Yes — traced to `validatePublicInquiryInput` | **Yes** — traced HTTP boundary via `framework_entry` to `POST` handler | Outstanding. This is CW's strongest tool. |
| `mapSite` (incoming, from Task A) | Partially — found `getSite` path but not `getUserSites` or `createSite` | N/A | Only traced one of the direct callers deeply |

**Verdict:** `cw_flow` is genuinely excellent. It traced the HTTP boundary between `submitPublicInquiry` and the API route — something grep cannot do. The `framework_entry` edge type is a real differentiator. The irony: `cw_flow` solved Task B perfectly, but `cw_capsule` for the same task completely failed to find the client-side code.

### Supporting Tools

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| cw_overview | "theme system" | 6 | Returned structural overview + file-level matches (SitePreviewApp, ThemeRouter, themePreset.ts). Useful as a directory but no code content. |
| cw_recall | "data layer architecture" | 3 | Only 1 result — a stored observation from a prior query. No architectural knowledge, just a pointer to a previous capsule result. Thin memory. |
| cw_impact | "mapSite" | 7 | Found 28 affected symbols across 3 depths. Missed `createSite` and `getUserSites` as direct callers. Good for understanding blast radius but not exhaustive. |
| cw_stats | (session) | 4 | Reports 68% average utilization which is inflated by prior session data. Actual utilization for THIS session's broad queries was 14-27%. No breakdown by query class. |

---

## Flaws Found

### P0 (Critical — blocks adoption)

1. **Stale index returns outdated code as authoritative context**: The capsule showed `mapSite` at lines 248-300 with the old function body (missing 6 fields). The actual function is at lines 319-374. An agent acting on this capsule would write code against a stale interface. `cw_read(symbol: "Site")` also returned wrong lines (152-197 = LayoutType/ThemePreset instead of the Site interface at 201-252). **Root cause:** Index doesn't detect file modifications since last indexing. Even though `cw_status` reported "1 stale" file, the stale data was served without warning. **Fix:** Either auto-detect file modification timestamps and force re-parse before serving, or stamp each capsule result with "indexed at: <timestamp>" and warn if the file's mtime is newer.

2. **Capsule retrieval matches on symbol NAMES not semantics, causing catastrophic false positives for broad queries**: The query "inquiry submission flow" pulled in 7 unrelated API route handlers because they all export `POST`. The query "state management" returned `ErrorBoundary.tsx` `interface State` as #1 (relevance 1.0). The query "dashboard navigation" returned `postcss.config.mjs` because it exports `config`. **Root cause:** The retrieval pipeline weights symbol name matches too heavily relative to structural/semantic relevance. A `POST` handler for `unban-user` is not relevant to an inquiry submission query just because it's also named `POST`. **Fix:** Down-weight symbols with extremely common names (`POST`, `config`, `State`, `handler`, `default`) when they appear in many files. Consider file-path relevance — `submit-inquiry/route.ts` should massively outrank `admin/unban-user/route.ts` for an inquiry query.

3. **Capsule cannot trace cross-boundary flows but cw_flow can — they aren't connected**: `cw_capsule` for the inquiry flow completely missed `publicInquiry.ts` (the client-side fetch). But `cw_flow(source: "submitPublicInquiry")` perfectly traced the HTTP boundary to the API handler. The capsule retrieval doesn't use flow/edge data to discover related symbols. **Root cause:** The capsule's retrieval pipeline (stageA/stageB) uses text/symbol matching, not graph traversal. The flow graph exists but isn't consulted during capsule packing. **Fix:** For queries classified as "broad" or "flow", run a lightweight graph traversal from the top-N matched symbols and include reachable symbols in the candidate set before packing.

### P1 (Important — degrades quality)

1. **Budget padding with noise when retrieval finds insufficient relevant symbols**: With an 8,000 token budget for "dashboard navigation", only 1,126 tokens (14%) were used. But those 1,126 tokens included `postcss.config.mjs`, badge color config, and middleware matcher regex — pure noise. The system pads with irrelevant results rather than returning a smaller, accurate capsule. **Root cause:** The packing algorithm tries to fill the budget rather than stopping when confidence drops below threshold. **Fix:** Implement a relevance cutoff — stop packing when the next symbol's score drops below a minimum threshold relative to the top result. Return unused budget as "unallocated" rather than padding with noise.

2. **Markdown documents indexed as symbols and mixed into code results**: `useQuoteForm` capsule included `AUDIT_PROMPT.md` (425 lines) and `mvp-completion-sprint-design.md` (299 lines). The "authentication" capsule included `DEVELOPMENT.md` (154 lines). These markdown files appear as "symbols" with names like `"development guide prerequisites node js 18+ npm git local setup"`. **Root cause:** Markdown files are indexed as a single giant symbol with their first ~N words as the symbol name. They match broad queries because they contain many keywords. **Fix:** Either exclude markdown from capsule results by default (add a `--no-docs` flag or separate docs from code), or dramatically down-weight docs in code-focused queries (mode: "review", "feature", "debug").

3. **cw_read symbol lookup returns wrong line range**: `cw_read(path: "lib/types.ts", symbol: "Site")` returned lines 152-197 which is `LayoutType` union tail + `resolveLayout` + `ThemePreset`, NOT the `Site` interface (lines 201-252). **Root cause:** The symbol "Site" in the index points to an outdated line range. Possibly the interface shifted when new types were added above it, and the index wasn't updated. **Fix:** This is the same stale-index problem as P0-1 but specifically affects `cw_read` — the symbol-to-line mapping must be validated against current file content before returning.

4. **Test file mocks inflate results for symbol lookups**: `showToast` capsule included 5 test files' mock definitions (`showToast: (...args) => showToastMock(...args)`) at [full] detail. Each is a 1-line mock that adds no understanding of the actual symbol. **Root cause:** Test mocks re-export the same symbol name and are treated as definitions. **Fix:** Detect test file patterns (`*.test.ts`, `*.test.tsx`, `*.spec.ts`) and down-weight or skip mock re-definitions when a real definition exists.

5. **cw_flow returns redundant paths that differ only at leaf nodes**: The `mapSite` incoming flow returned 10 paths, all sharing the chain `getSite → load → useSites → useDataLayer` and branching only at the final component. This uses 10x the tokens to express what is essentially 1 chain with 5 leaf consumers. **Root cause:** The path enumeration algorithm doesn't deduplicate shared prefixes. **Fix:** Return a tree structure or deduplicate shared path prefixes: show the chain once, then list the leaf divergence points.

### P2 (Moderate — papercut)

1. **Confidence HIGH + Uncertainty HIGH is contradictory**: The "error handling" capsule reported both `Confidence: HIGH` and `Uncertainty: HIGH`. These should be inversely correlated — HIGH confidence with HIGH uncertainty means the system is confident in an uncertain answer, which is worse than honestly saying LOW. **Fix:** Either make them inversely linked or rename "uncertainty" to something like "scope_coverage" to avoid the semantic contradiction.

2. **cw_stats reports inflated average utilization**: Session stats showed "Budget utilization: 68%" which includes prior session data. The actual utilization for broad queries in THIS session ranged from 14-27%. No per-query-class breakdown. **Fix:** Report utilization broken down by query class (narrow vs broad) and by the current session only.

3. **Symbol count discrepancy between cw_status and cw_overview**: `cw_status` reported 3,277 symbols; `cw_overview` reported 3,701. This is a ~13% discrepancy with no explanation. **Fix:** Ensure both tools query the same source, or explain the difference (e.g., "3,277 code symbols + 424 document symbols").

4. **No version string reported by cw_status**: There is no way to identify which build of ContextWeave is being tested. This makes it impossible to correlate findings with code changes. **Fix:** Add a version/commit hash to `cw_status` output.

5. **cw_impact misses callers that use `.map(fn)` pattern**: `mapSite` has 2 callers via `.map(mapSite)` in `getUserSites` (lines 512/515). `cw_impact` didn't find these — it only found callers that use `mapSite(arg)` direct call syntax. **Root cause:** The AST edge detection likely only recognizes `fn(args)` call patterns, not `array.map(fn)` where `fn` is passed as a callback. **Fix:** Detect callback-passing patterns (`.map(fn)`, `.filter(fn)`, `.forEach(fn)`, `Promise.then(fn)`) and create edges from the callback consumer to the passed function.

---

## What Worked Well

1. **`cw_flow` is genuinely excellent.** It traced `submitPublicInquiry` across the HTTP boundary to the API route handler using `framework_entry` edges. This is something grep fundamentally cannot do. If `cw_flow` data were integrated into capsule retrieval, it would fix the worst failure mode.

2. **Symbol definition ranking works.** In all 3 exact-symbol tests, the actual definition appeared as result #1. The problem is everything ELSE that fills the remaining budget, not the top result.

3. **Multi-level compression is a smart design.** The `[full]`, `[summary]`, `[skeleton]`, `[reference]` compression levels are well-conceived. When the right symbols are selected, the compression gives a good density/context tradeoff.

4. **`cw_impact` blast-radius analysis is useful.** Finding 28 affected symbols across 3 depths for `mapSite` — including framework entry points like `generateMetadata` in page routes — is genuinely valuable for refactoring safety checks.

5. **Self-diagnostic output is helpful.** The "Diagnostics" section identifying `packing_scatter` as a bottleneck, the "Budget underutilized" warnings, and the suggested next actions show good self-awareness. The tool knows when it's struggling — it just can't fix it in-flight.

6. **`cw_overview` query focus matches are decent starting points.** For "theme system" it returned `SitePreviewApp`, `ThemeRouter`, `themePreset.ts`, `QuoteModal` — all genuinely related to themes. As a file-discovery tool, it works.

---

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 7 |
| Broad recall (found all relevant files) | 2 |
| Budget utilization (% of budget used) | 3 |
| Confidence calibration (honest scores) | 4 |
| Flow tracing (traces real call chains) | 8 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 1 |
| **Overall: Would replace Grep+Explore?** | **No** |

**Summary:** ContextWeave is a promising tool with excellent flow tracing and good symbol-level precision. But its capsule retrieval fundamentally fails on broad/flow/architectural queries — exactly the queries where an AST-aware tool should shine most. The stale index problem means code returned is potentially wrong, which is worse than returning nothing. Until capsule retrieval integrates graph data and stops padding with noise, grep+read is faster, cheaper, and more reliable for real development tasks.

---

## Evidence Snippets

### P0-1: Stale index (mapSite)

**Query:** `cw_capsule({ query: "mapSite function that transforms database rows to Site type", token_budget: 3000, mode: "review" })`

**CW returned:** `mapSite` at lines 248-300, function body ending with `lastEdited: row.updated_at`

**Actual file (grep + read):** `mapSite` at lines 319-374, includes 6 additional fields:
```
operatingHours: row.operating_hours ?? undefined,
certifications: Array.isArray(row.certifications) ? row.certifications : [],
availabilityStatus: normalizeAvailabilityStatus(row.availability_status),
autoResponseEnabled: row.auto_response_enabled !== false,
priceCategories: Array.isArray(row.price_categories) ? ...,
menuCategories: Array.isArray(row.menu_categories) ? ...,
```

### P0-1: cw_read wrong line range (Site interface)

**Query:** `cw_read(path: "lib/types.ts", symbol: "Site")`

**CW returned:** Lines 152-197 containing `LayoutType` union, `VALID_LAYOUTS` array, `LAYOUT_MIGRATION_MAP`, `resolveLayout()`, `ThemePreset` interface

**Actual location:** `export interface Site {` at line 201-252

### P0-2: POST symbol name false positive

**Query:** `cw_capsule({ query: "inquiry submission flow...", token_budget: 6000 })`

**CW returned 7 unrelated API routes all at relevance 0.82-0.94:**
- `admin/unban-user/route.ts` POST (relevance 0.94)
- `admin/update-role/route.ts` POST (relevance 0.94)
- `admin/upgrade-user/route.ts` POST (relevance 0.94)
- `auth/complete-profile/route.ts` POST (relevance 0.94)
- `auth/login/route.ts` POST (relevance 0.94)
- `auth/register/route.ts` POST (relevance 0.94)
- `generate-copy/route.ts` POST (relevance 0.94)

**What should have been #2-3:** `publicInquiry.ts` (the client `fetch` caller), `useQuoteForm.ts` (the UI hook)

### P0-2: ErrorBoundary outranking state management

**Query:** `cw_capsule({ query: "How does state management work...", token_budget: 6000 })`

**CW returned #1:** `ErrorBoundary.tsx` `interface State { hasError: boolean; error: Error | null }` at relevance 1.0

**What should have been #1:** `dataLayer.ts` containing `useDataLayer()` and `useSiteDataLayer()` (appeared at relevance 0.08 with only `wrapStore` shown)

### P0-3: cw_flow succeeds where cw_capsule fails

**Capsule for inquiry flow:** Completely missed `publicInquiry.ts`

**cw_flow for same function:**
```
submitPublicInquiry
  [call] → validatePublicInquiryInput (publicInquiry.ts:11)
  [framework_entry] → POST (submit-inquiry/route.ts:55)
    [call] → validateInquiryBody (inquiryValidation.ts:33)
    [call] → corsJson → corsHeaders → getAllowedOrigin
```
Perfect trace. The graph data exists — the capsule just doesn't use it.

### P1-1: Budget padding (dashboard navigation)

**Query:** `cw_capsule({ query: "dashboard navigation system...", token_budget: 8000 })`

**CW returned 1,126/8,000 tokens (14%):**
- #1: `proxy.ts` middleware `config.matcher` regex (relevance 1.0)
- #2: `InquiriesPage.tsx` badge color `config` (relevance 0.56)
- #3: `postcss.config.mjs` plugin config (relevance 0.56)

**What should have been returned:** `nav-config.ts`, `Sidebar.tsx`, `TopBar.tsx`, `DashboardShell.tsx` — the actual navigation system files (none appeared anywhere in results)
