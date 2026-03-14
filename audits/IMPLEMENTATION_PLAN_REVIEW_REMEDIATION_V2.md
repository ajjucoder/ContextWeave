# ContextWeave Review-Driven Remediation Plan v2

Date: 2026-03-14
Source: 18 field reviews across 2 rounds (8 projects Mar 10, 10 projects Mar 14)
Status: DRAFT — not yet executed

## Lessons From the Failed First Remediation

The March 10 review identified 17 findings. We attempted fixes and re-reviewed on March 14. Results:

| Metric | Mar 10 | Mar 14 | Delta |
|--------|--------|--------|-------|
| Narrow precision | 7.8 | 5.8 | -2.0 |
| Broad recall | 3.4 | 3.0 | -0.4 |
| Budget utilization | 3.8 | 1.8 | -2.0 |
| Confidence calibration | 3.8 | 3.0 | -0.8 |
| Flow tracing | 3.4 | 3.1 | -0.3 |
| Follow-up quality | 3.4 | 2.1 | -1.3 |
| Token savings | 3.5 | 1.6 | -1.9 |
| Would replace Grep? | 0Y/3P/5N | 0Y/0P/10N | worse |

**What went wrong:**
1. We widened the funnel (more candidates, higher caps) without improving the filter. More noise, not less.
2. We verified fixes against synthetic test fixtures, not real codebases. Tests passed; field failed.
3. We introduced a regression: `file:` vs `path:` schema mismatch in follow-up suggestions.
4. Budget utilization changes (pool-widen, multi-hop) added more irrelevant symbols instead of more relevant ones.
5. The cross-encoder reranker was built but wired to see `"scopeLabel in filePath"` strings, not actual code content.

**Rules for this plan:**
- NO change is considered done until field-verified on at least 3 external codebases
- NO widening changes (more candidates, higher caps) without paired tightening (better filters)
- Every PR must include a before/after measurement on real queries, not just test fixtures
- Revert any change that degrades narrow precision (our one remaining strength)

---

## Phase 0: Revert Damage and Fix Regressions (Day 1)

### 0.1 Fix `file:` vs `path:` Schema Mismatch

**The bug:** `formatter.ts` emits `cw_read(file: "...", symbol: "...")` but `cw_read` schema expects `path:`. The `file:` key is silently ignored, causing global fuzzy fallback that resolves to wrong files.

**Impact:** Found in 6/10 Mar 14 reviews. Directly causes wrong-file reads and destroys agent trust.

**Fix:**
- In `src/mcp/tools/read.ts`: accept `file` as an alias for `path` in the zod schema
- In `src/capsule/formatter.ts`: change all `file:` emissions to `path:`
- In `buildStructuredOutput`: same change for structured suggested reads
- Add test: `cw_read({ file: "src/foo.ts", symbol: "bar" })` should resolve same as `cw_read({ path: "src/foo.ts", symbol: "bar" })`

**Files:** `src/capsule/formatter.ts`, `src/mcp/tools/read.ts`

### 0.2 Revert Widening Changes That Made Things Worse

**The problem:** hardCap raises (120→200/300), pool-widen pass, small-codebase expansion, and multi-hop retrieval all added more noise. Narrow precision dropped from 7.8 to 5.8.

**Fix:**
- Revert hardCap to original values: broad 120/180, task 84
- Remove the pool-widen pass that adds ALL symbols from selected directories
- Remove the small-codebase expansion (adding ALL symbols at distance 3)
- Remove the multi-hop retrieval pass (adding callers/callees of packed results)
- Keep the HyDE expansion (no evidence it caused harm)
- Keep the cross-encoder reranker (but fix its inputs — see Phase 2)

**Files:** `src/capsule/generator.ts`

**Verification:** Run narrow precision queries from reviews. `useDataLayer`, `validateOrigin`, `sendTurn` must all rank definition at #1 in structured output.

### 0.3 Fix `cw_stats` Honesty

**The problem:** All 18 reviews report fake 100% first-pass rate and 0% correction. Stats only count capsule log entries, not cw_read/cw_grep/cw_flow calls.

**Fix:**
- In `src/mcp/tools/stats.ts`: count ALL tool calls per session (capsule + read + grep + flow + impact + overview), not just capsule logs
- Track follow-up calls: any cw_read/cw_grep/cw_flow call within 60s of a capsule is a follow-up
- Replace "First-pass rate" with "Capsule-only rate" (what % of sessions used only cw_capsule with no follow-up tools)
- Remove the savings estimation entirely — it's always wrong. Show raw token counts only.
- Report project-wide indexed files/symbols, not session-scoped subset

**Files:** `src/mcp/tools/stats.ts`, `src/db/queries/capsule-log.ts`

---

## Phase 1: Fix Retrieval Precision (Days 2-5)

The core problem: capsules include the wrong files. Every review says the same thing. This phase fixes the filter, not the funnel.

### 1.1 Hard-Exclude Non-Source Files From Capsule Retrieval

**The problem:** Test files, docs, vendored JS, mock data, and config files consistently pollute capsule results across all 18 reviews. The 0.3x penalty is not enough — 30% of a high score is still competitive.

**Fix:**
- In `src/capsule/generator.ts`, Stage B candidate loop: SKIP (don't just penalize) candidates from:
  - Test files (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`, `fixtures/`)
  - Vendored bundles (`vendor/`, `static/js/`, minified files >500 chars per line)
  - Doc files (`.md`, `.txt`, `.yaml` unless query is doc-focused)
  - Generated files (`dist/`, `build/`, `.next/`, `coverage/`)
- Only include test files when mode is `debug` or query contains test-related terms
- Only include docs when query contains doc-related terms
- Add `isVendoredOrMinified(filePath, source)` detector: files with average line length >200 chars or matching known vendor patterns

**Files:** `src/capsule/generator.ts`, `src/core/indexer.ts`

### 1.2 Strengthen Exact-Match Dominance

**The problem:** FocusPact's `GET` query returned `getUser`, `getTribeDateString` ahead of actual `GET` route handlers. KisanSathi's `ProductModel` ranked field injections above the class definition.

**Fix:**
- In `src/capsule/pivot-scorer.ts`: exact whole-token match (query === symbolName, case-insensitive) gets +100 bonus (currently +50, which is insufficient when substring matches score 30-40)
- Add symbol-kind priors: for HTTP method names (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`), boost function/method kinds by 3x over variable/import kinds
- Exact definition (kind=function/class/method with exact name match) must ALWAYS outrank usage sites (kind=variable/import with same name)

**Files:** `src/capsule/pivot-scorer.ts`

### 1.3 File-Qualified Read Must Be Hard-Pinned

**The problem:** `cw_read(path: "AdminUserDetailPage.tsx", symbol: "callAdminApi")` returns `AdminPendingPage.tsx`. `cw_read(path: "useQuoteForm.ts", symbol: "useQuoteForm")` returns `QuoteModal.test.tsx`. The file constraint is not enforced.

**Fix:**
- In `src/mcp/tools/read.ts`, `resolveFilePath`: when a file path is provided, ONLY search within that exact file (after path resolution). Never fall back to global fuzzy match.
- If the symbol isn't found in the specified file, return an error: "Symbol 'X' not found in file 'Y'. Available symbols in this file: [list]."
- In `resolveSymbolTarget`: when `filePath` is resolved, use `getByFileAndName(fileId, symbolName)` ONLY. Do not fall back to `fuzzyMatch` across all files.

**Files:** `src/mcp/tools/read.ts`, `src/mcp/tools/symbol-resolution.ts`

### 1.4 Impact Must Respect File-Qualified Targets

**The problem:** `cw_impact(target: "src/lib/supabase/server.ts:createClient")` lists browser-only consumers because it widens to all symbols named `createClient`.

**Fix:**
- In `src/mcp/tools/impact.ts`: when target contains `:` (file-qualified), resolve to THAT specific symbol ID and trace ONLY from it
- Do not expand to other symbols with the same name in different files
- If multiple symbols match within the specified file, list them and ask for disambiguation

**Files:** `src/mcp/tools/impact.ts`

### 1.5 Follow-Up Suggestions Must Close Query Gaps

**The problem:** Follow-ups suggest unrelated code. Task B inquiry flow suggested `handleRecordPayment`. Invite flow suggested `cw_read(symbol: "GET")` which opened the wrong route.

**Fix:**
- In `src/capsule/formatter.ts`: follow-up candidates must have `queryTermOverlap > 0` OR be a direct edge target of a packed pivot — no exceptions
- Follow-ups must use file-qualified paths: `cw_read(path: "src/file.ts", symbol: "name")`, never bare `cw_read(symbol: "name")`
- Cap at 3 follow-ups max (currently 4). Fewer, better suggestions.
- Secondary sort by file diversity: don't suggest 3 symbols from the same file

**Files:** `src/capsule/formatter.ts`

---

## Phase 2: Fix Budget Utilization Without Adding Noise (Days 6-8)

### 2.1 Layer-Aware Retrieval for Broad/Task Queries

**The problem:** Broad queries grab whatever scores highest globally, which is often 8 symbols from the same directory. The actual answer spans UI → API → Service → DB, but retrieval doesn't target layer coverage.

**Fix:**
- In `src/capsule/generator.ts`: after initial candidate selection for broad/task intent, check layer coverage:
  - Count how many distinct "layers" are represented: UI (components/, app/), API (api/, routes/), Service (services/, lib/), Data (db/, models/, repositories/)
  - If fewer than 2 layers are covered AND candidates from other layers exist in the BFS visited set, pull in the top candidate from each missing layer
- This replaces the pool-widen pass with targeted layer filling

**Files:** `src/capsule/generator.ts`, `src/core/repo-profiler.ts`

### 2.2 Confidence Gated by Layer Coverage

**The problem:** HIGH confidence on answers that only cover one layer. Inquiry flow capsule says HIGH but missed the entire UI chain.

**Fix:**
- In `src/capsule/confidence.ts`: for broad/task intent, if the packed result covers only 1 architectural layer, cap confidence at 0.40 (LOW) regardless of other metrics
- If 2 layers: cap at 0.60 (MEDIUM)
- If 3+ layers: allow computed confidence
- Layer detection uses the same repo-profiler lane detection already in the codebase

**Files:** `src/capsule/confidence.ts`, `src/capsule/generator.ts`

### 2.3 Refill With Adjacent Context, Not Random Symbols

**The problem:** When budget is underfilled, the current pipeline tries to add more symbols from random directories. This adds noise. Instead, refill should deepen coverage of ALREADY SELECTED files.

**Fix:**
- In `src/capsule/packer.ts`: when utilization < 50% after initial pack, for each L0/L1 file already packed, show MORE of that file at L2 (skeleton with deps), not random symbols from other files
- Add file-context sections: "Other exports from this file: functionA, functionB, functionC" (name-only, ~3 tokens each)
- This fills budget with relevant context from confirmed-good files instead of noise from unrelated files

**Files:** `src/capsule/packer.ts`

### 2.4 Budget Floor Warning

**The problem:** 5-25% utilization on 8K budgets with no explanation to the user.

**Fix:**
- In `src/capsule/formatter.ts`: when utilization < 30%, add explicit note: "Budget underutilized: only N/M tokens used. The retrieval found N symbols relevant to this query. Consider narrowing your query or using cw_grep for broader coverage."
- Drop confidence by one tier when utilization < 20%

**Files:** `src/capsule/formatter.ts`, `src/capsule/confidence.ts`

---

## Phase 3: Fix Flow Tracing (Days 9-12)

### 3.1 Fix Method-Call Edge Resolution for Java/Spring

**The problem:** `cw_flow(createOrder)` returns no outgoing flows despite obvious calls to `userRepo.save()`, `emailSender.send()`, etc. Java method calls through injected fields are not creating edges.

**Fix:**
- In `src/core/queries/java.ts` (or wherever Java call extraction happens): detect `this.fieldName.methodName()` and `fieldName.methodName()` patterns as call edges
- For Spring `@Autowired`/`@Inject` fields: resolve field type to the class and create edges to the class methods
- Add test: Java class with 3 injected service calls should produce 3 call edges

**Files:** `src/core/parser.ts`, Java query files

### 3.2 Fix Impact for Convex/tRPC API Patterns

**The problem:** `cw_impact("resolveContext")` returns no dependents despite 4 dashboard modules calling `api.workspace.resolveContext`. `cw_flow` can't trace `ctx.runQuery(api.videos.getByShareGrant)`.

**Fix:**
- In `src/core/event-edge-synthesis.ts`: the Convex pattern detection (`useMutation/useQuery/useAction` → `api.module.exportName`) needs verification on the lawn fixture. Check if edges are actually being created.
- If not: fix the regex patterns to match `api.workspace.resolveContext` → `convex/workspace.ts:resolveContext`
- Add test: Convex mutation call should create synthetic edge

**Files:** `src/core/event-edge-synthesis.ts`

### 3.3 Fix Tauri invoke/listen Edge Creation

**The problem:** Nudgy's `handleStart` → `invoke("start_session")` returns no outgoing flows despite crossing real runtime boundaries.

**Fix:**
- Verify `src/core/event-edge-synthesis.ts` Tauri patterns against actual Nudgy source code patterns
- The regex expects `invoke("commandName")` but the actual code might use `invoke<T>("commandName", { args })` — check if the generic type parameter breaks the match
- Add test: TS file with `invoke("start_session")` and Rust file with `#[tauri::command] fn start_session()` should create synthetic edge

**Files:** `src/core/event-edge-synthesis.ts`

### 3.4 Fix WebSocket/Event Boundary Flow

**The problem:** T3 Code's `dispatchCommand` → WebSocket → `sendTurnForThread` path is invisible. polymarket's `startPaperTrading` → callback → `onEvent` returns no path.

**Fix:**
- These are fundamentally hard: WebSocket connections are runtime-only, no static edge can be created without type inference or convention matching
- Pragmatic fix: detect `ws.send`/`socket.emit` patterns on one side and `ws.on`/`socket.on("message")` on the other. If both exist in the same project, create a synthetic `event` edge between the send-site symbol and the receive-site symbol
- For callback patterns like `feedAdapter.start((event) => engine.onEvent(event))`: the parser should already create a callback edge for the arrow function argument. Verify this works.

**Files:** `src/core/event-edge-synthesis.ts`, `src/core/parser.ts`

---

## Phase 4: Fix Cross-Encoder Reranker (Day 13)

### 4.1 Feed Real Code to the Reranker

**The problem:** The reranker sees `"scopeLabel in filePath"` strings (~10 tokens), not actual code. A cross-encoder needs meaningful content to rerank effectively.

**Fix:**
- In `src/core/hybrid-ranker.ts`: build reranker documents from the first 200 characters of each candidate's source code, not just the scope label
- Format: `"[kind] name(signature) in file/path.ts — first 150 chars of body"`
- This gives the cross-encoder actual semantic content to score against the query

**Files:** `src/core/hybrid-ranker.ts`

### 4.2 Increase Reranker Candidate Pool

**The problem:** Only the top 30 RRF candidates are reranked. If the right file is at position 35, the reranker never sees it.

**Fix:**
- Rerank top 50 candidates (up from 30)
- After reranking, take top 20 (up from current limit)

**Files:** `src/core/hybrid-ranker.ts`

---

## Phase 5: Fix Vendored/Static Asset Pollution (Day 14)

### 5.1 Auto-Detect and Exclude Vendored JS in Non-JS Projects

**The problem:** KisanSathi (Spring Boot) had modernizr.js, jQuery plugins, and form-validation bundles consuming capsule budget instead of Java service code.

**Fix:**
- In `src/core/indexer.ts`, `shouldIgnore()`: detect vendored JS patterns:
  - Files with `@license` or `/*! ` comments in the first 5 lines
  - Files in `static/js/`, `static/vendor/`, `assets/js/`, `public/js/`
  - Files with average line length > 200 chars (minified)
  - Files matching known vendor names: `jquery`, `modernizr`, `bootstrap`, `lodash`, `moment`, `popper`
- Add `resources/static/` to the downweight patterns in directory-weights.ts (currently only `src/main/resources/static` is handled)

**Files:** `src/core/indexer.ts`, `src/utils/directory-weights.ts`

### 5.2 Repo Profiler Should Detect Primary Language

**The problem:** When a repo is 90% Java but has 10% vendored JS, the JS files shouldn't compete equally in ranking.

**Fix:**
- In `src/core/repo-profiler.ts`: detect the primary language(s) by file count
- When primary language is Java/Python/Go/Rust and a JS/TS file is outside `src/` or `app/`, apply a 0.2x weight
- This prevents vendored frontend assets from competing with backend code

**Files:** `src/core/repo-profiler.ts`, `src/capsule/generator.ts`

---

## Phase 6: Field Verification Protocol (Days 15-17)

### 6.1 Build Real-Project Test Harness

**The problem:** We verified fixes against synthetic fixtures. Tests passed; field failed.

**Fix:**
- Create `tests/field-real/` directory with scripts that:
  1. Clone 3 external projects (a Next.js app, a Spring Boot app, a Python CLI)
  2. Index each with ContextWeave
  3. Run the exact review queries from the reviews
  4. Measure: tokens used, files found, definition-at-rank-1, noise ratio
  5. Compare against baseline grep+read token counts
- Run this harness before AND after every change
- Gate merges on: narrow precision >= 7.0, noise ratio <= 30%, no regression on exact-match ranking

### 6.2 Before/After Measurement Protocol

Every PR must include:
1. The exact query tested
2. Capsule output BEFORE the change
3. Capsule output AFTER the change
4. Token count comparison
5. Did the correct file(s) appear? Yes/No
6. Did noise files appear? List them.

No PR is merged without this evidence.

---

## Phase 7: Zustand Property-Style Symbol Indexing (Day 18)

### 7.1 Index Object Property Definitions

**The problem:** Nudgy's `updateSession` is defined as a property on a Zustand store object, not as a standalone function. The parser doesn't index these.

**Fix:**
- In `src/core/parser.ts`: for TS/JS, detect `{ propertyName: (args) => { ... } }` and `{ propertyName(args) { ... } }` patterns inside `create()`, `defineStore()`, or object literal assignments
- Create symbols for these property-style definitions with kind `method`
- This fixes Zustand stores, Redux slices, and similar patterns

**Files:** `src/core/parser.ts`, TS/JS query files

---

## Phase 8: Fix Impact False Negatives and Flow Edge Priority (Days 19-21)

### 8.1 Fix `cw_impact` False Negatives on Direct Dependents

**The problem:** `cw_impact("generateCapsuleWithRuntime")` returns "No dependents found" despite `capsule.ts` calling it directly. `cw_impact("resolveContext")` misses 4 obvious route-data dependents. `cw_impact("start_session")` misses the frontend invoke. Found in 5/10 Mar 14 reviews.

**Fix:**
- In `src/mcp/tools/impact.ts`: after `traceImpact` returns empty results, run a fallback grep-style search: `SELECT * FROM edges WHERE target_symbol_id = ?` directly, bypassing any symbol resolution issues
- If the symbol was resolved by name (not file-qualified), try ALL symbols with that name, not just the first match
- Log which symbol ID was used for tracing so misresolution is visible in diagnostics
- Add test: create two files where file B calls a function from file A → impact on file A's function must find file B

**Files:** `src/mcp/tools/impact.ts`, `src/mcp/tools/symbol-resolution.ts`

### 8.2 Flow Tracing Must Prioritize Call Edges Over Import/Type Edges

**The problem:** CW self-review shows `cw_flow(runServe)` returning import/type-usage paths instead of the actual call to `startMcpServer`. Flow leaks test fixtures because import edges connect test files.

**Fix:**
- In `src/mcp/tools/flow.ts`, `traceOutgoing`/`traceIncoming`: sort outgoing edges by priority BEFORE DFS traversal:
  1. `call`, `callback`, `server-action`, `route-handler` (highest — these ARE flow)
  2. `jsx_render`, `event`, `dynamic_dispatch` (medium — these are flow-adjacent)
  3. `import`, `reexport`, `type_usage`, `reference`, `inheritance` (lowest — these are structure, not flow)
- When DFS explores, prefer high-priority edges first so paths follow actual execution order
- Filter test/fixture files from flow results by default (unless query mentions testing)

**Files:** `src/mcp/tools/flow.ts`

### 8.3 Same-Name Symbol Disambiguation in Capsules

**The problem:** research-agent has 3 `main()` functions. FocusPact has 2 `createClient` functions. Capsule picks one without telling the user which.

**Fix:**
- In `src/capsule/generator.ts`: when multiple symbols with the exact same name exist and the query is that name, include ALL definitions (or top 3) with file-qualified labels, not just the highest-scored one
- When `isExactSymbolNameMatch` and there are 2+ matches, add a disambiguation note: "Found N definitions of 'X'. Showing the top-ranked one from file Y."
- In structured output: include `alternateDefinitions: [{ path, line }]` for same-name symbols

**Files:** `src/capsule/generator.ts`, `src/capsule/formatter.ts`

---

## Phase 9: Fix Supporting Tools (Days 22-23)

### 9.1 Fix `cw_recall` Passive Pollution

**The problem:** Recall returns passive query telemetry instead of useful architectural knowledge in 6/10 reviews. `cw_recall("share link access")` returned prior capsule summaries. `cw_recall("Zombie Protocol")` returned nothing despite being a core project concept.

**Fix:**
- In `src/mcp/tools/recall.ts`: default `includePassive` to `false` (currently `true`). Only show passive observations when explicitly requested or when intentional results are empty.
- In `src/memory/search.ts`: increase passive demotion from 0.3x to 0.1x scope weight
- Consider: auto-populate recall from README/CLAUDE.md/AGENTS.md project context on first index, so project concepts are available even without prior `cw_remember` calls

**Files:** `src/mcp/tools/recall.ts`, `src/memory/search.ts`

### 9.2 Fix `cw_grep` Definition Ranking

**The problem:** `cw_grep("recordDatasetPack")` ranks an import in `cli-record.ts` first. `cw_grep("resolveContext")` ranks test imports above the definition.

**Fix:**
- In `src/mcp/tools/ripgrep.ts` (or wherever grep results are formatted): sort results by: definition site (function/class/export declaration) first, then usage sites
- Detect definition patterns: `function X`, `class X`, `export.*X`, `def X`, `const X =` for the matched symbol
- Mark definition results with `[def]` tag in output

**Files:** `src/mcp/tools/ripgrep.ts` or `src/mcp/tools/search.ts`

### 9.3 Fix `cw_reindex` Messaging

**The problem:** `cw_reindex` reports "435 files, 0 symbols (57ms)" on incremental runs, looking like a failed full reindex.

**Fix:**
- In `src/mcp/tools/reindex.ts`: separate output into "Processed: N new/changed files, M symbols" and "Skipped: P unchanged files" and "Total indexed: Q files, R symbols"
- Make it clear whether the run was incremental or cold

**Files:** `src/mcp/tools/reindex.ts`

### 9.4 Fix `cw_status` Source-Root Heuristic

**The problem:** Sitecraft shows "100% of indexed files are from non-source directories" on a normal repo centered around `kuvio/src`. The heuristic doesn't understand monorepo structures.

**Fix:**
- In `src/mcp/tools/status.ts`: detect source roots by looking for `package.json`, `setup.py`, `pom.xml`, `Cargo.toml`, `go.mod` in subdirectories
- When a monorepo has a subdirectory with its own package.json, treat that subdirectory as a source root
- Only warn about non-source files when > 50% are genuinely non-code (docs, config, assets)

**Files:** `src/mcp/tools/status.ts`

### 9.5 Fix Parse Error Reporting

**The problem:** "1 files had parse errors" with no identification of which file or what the error was.

**Fix:**
- In `src/mcp/tools/status.ts` (verbose mode): list the file paths and error messages for files with parse errors
- In `src/mcp/tools/reindex.ts`: include parse error file paths in the reindex output

**Files:** `src/mcp/tools/status.ts`, `src/mcp/tools/reindex.ts`

---

## Execution Order and Dependencies

| Phase | Days | Dependency | Gate |
|-------|------|------------|------|
| 0: Revert + Fix Regressions | 1 | None | All existing tests pass, `file:`→`path:` fixed |
| 1: Retrieval Precision | 2-5 | Phase 0 | Narrow precision >= 7.0 on 5 test queries |
| 2: Budget Utilization | 6-8 | Phase 1 | No noise ratio increase from Phase 1 baseline |
| 3: Flow Tracing | 9-12 | Phase 0 | Flow tests pass for Java, Convex, Tauri patterns |
| 4: Cross-Encoder Fix | 13 | Phase 1 | Reranker sees real code, not labels |
| 5: Vendor Exclusion | 14 | Phase 0 | KisanSathi-style repos don't surface modernizr |
| 6: Field Verification | 15-17 | Phases 1-5 | Real-project harness green |
| 7: Property Symbols | 18 | Phase 0 | Zustand store methods indexed |
| 8: Impact + Flow Priority | 19-21 | Phase 3 | Impact finds direct dependents, flow prefers call edges |
| 9: Supporting Tools | 22-23 | Phase 0 | Recall, grep, reindex, status all improved |

---

## Success Criteria

This plan is NOT done until:

1. **Narrow precision >= 7.0** (currently 5.8, was 7.8)
2. **Broad recall >= 5.0** (currently 3.0)
3. **Budget utilization >= 4.0** (currently 1.8)
4. **Follow-up quality >= 5.0** (currently 2.1)
5. **Token savings >= 3.0** (currently 1.6 — meaning CW should at worst break even with grep)
6. **At least 2/10 reviewers say "Partial" or "Yes"** to replacing Grep+Explore
7. **`cw_stats` reports honest metrics** that match reviewer observations
8. **No `file:` vs `path:` schema mismatches** anywhere in the codebase
9. **No vendored JS in capsule output** for non-JS primary repos
10. **`cw_impact` finds direct dependents** — no false negatives on obvious callers (currently broken in 5/10 reviews)
11. **`cw_flow` returns call-edge paths first** — import/type detours are deprioritized
12. **`cw_recall` returns intentional observations first** — passive telemetry demoted or hidden by default
13. **`cw_grep` ranks definitions above imports/usages** for exact symbol queries
14. **`cw_reindex` clearly distinguishes incremental vs cold runs** with separate processed/skipped/total counts
15. **`cw_status` source-root heuristic works on monorepos** — no false "100% non-source" warnings

These are measured on REAL codebases, not synthetic fixtures.

---

## Review Finding → Plan Item Cross-Reference

Every P0 and P1 finding from both review rounds must map to a plan item. If it doesn't, the plan is incomplete.

### Mar 14 P0 Findings (across 10 reviews)

| Finding | Count | Plan Item |
|---------|-------|-----------|
| `cw_stats` dishonesty (fake 100% first-pass, inflated savings) | 10/10 | 0.3 |
| Broad capsule misses critical path files | 10/10 | 1.1, 2.1, 2.3 |
| Budget catastrophically underutilized (5-25% on 8K) | 10/10 | 2.1, 2.3, 2.4 |
| `cw_flow` breaks on non-static boundaries | 10/10 | 3.1, 3.2, 3.3, 3.4, 8.2 |
| Confidence miscalibrated (HIGH on wrong answers) | 10/10 | 2.2, 2.4 |
| Follow-up suggestions misleading or schema-wrong | 9/10 | 0.1, 1.5 |
| `file:` vs `path:` schema mismatch | 6/10 | 0.1 |
| File-qualified `cw_read` returns wrong file | 4/10 | 1.3 |
| `cw_impact` false negatives on direct dependents | 5/10 | 8.1, 1.4 |
| Vendored/static assets pollute capsules | 2/10 | 5.1, 5.2 |
| Tauri invoke/listen broken | 1/10 | 3.3 |
| Exact-symbol ranking collapses on common names | 2/10 | 1.2, 8.3 |
| Zustand property symbols missing from index | 1/10 | 7.1 |

### Mar 14 P1 Findings (across 10 reviews)

| Finding | Count | Plan Item |
|---------|-------|-----------|
| Budget utilization poor | 10/10 | 2.1, 2.3, 2.4 |
| Confidence miscalibrated on vague/architectural queries | 8/10 | 2.2 |
| `cw_recall` returns passive telemetry, not useful memory | 6/10 | 9.1 |
| Test/doc files rank above source code | 5/10 | 1.1 |
| `cw_overview` too lexical for semantic queries | 4/10 | (addressed by 1.1 test/doc exclusion) |
| `cw_impact` mixes dependents with test/variable noise | 3/10 | 8.1 |
| Follow-up suggestions weak / wrong next step | 7/10 | 1.5 |
| `cw_reindex` misleading on incremental runs | 2/10 | 9.3 |
| Index health reporting misleading | 3/10 | 9.4 |
| Repo profiling mismatches project conventions | 1/10 | 5.2 |
| `cw_grep` ranks imports above definitions | 2/10 | 9.2 |
| Setup friction / MCP connection issues | 1/10 | (out of scope — deployment, not retrieval) |

### Mar 10 Original 17 Findings

| # | Finding | Plan Item |
|---|---------|-----------|
| 1 | Confidence miscalibration | 2.2, 2.4 |
| 2 | Noise domination | 1.1, 1.5 |
| 3 | Budget underutilization | 2.1, 2.3, 2.4 |
| 4 | Flow tracing non-functional | 3.1-3.4, 8.2 |
| 5 | cw_stats inflated | 0.3 |
| 6 | Broad queries miss critical files | 1.1, 2.1 |
| 7 | Follow-up suggestions irrelevant | 1.5 |
| 8 | cw_recall weak | 9.1 |
| 9 | Test files rank above source | 1.1 |
| 10 | Packer compresses target while noise gets full | (addressed by existing target reservation) |
| 11 | Index pollution | 5.1, (existing indexer exclusions) |
| 12 | Duplicate content | (addressed by existing packer dedup) |
| 13 | No symbol-not-found signal | (already implemented) |
| 14 | Path overrides content | 1.1, 5.2 |
| 15 | Previously-shown waste | (already minimal) |
| 16 | cw_read path inconsistency | 0.1, 1.3 |
| 17 | cw_overview padding | 1.1, (body-aware FTS5 already exists) |

**Coverage check:** All P0 and P1 findings from both rounds map to at least one plan item. No orphan findings.

---

## Anti-Patterns to Avoid (Learned From Round 1)

1. **Don't widen without tightening.** Every change that adds more candidates MUST pair with a change that filters better.
2. **Don't verify on synthetic fixtures only.** Run on real repos before declaring done.
3. **Don't mark done without before/after evidence.** Screenshots of capsule output, not just "tests pass."
4. **Don't add features while core retrieval is broken.** HyDE, multi-hop, cross-encoder are all irrelevant if the base retrieval returns the wrong files.
5. **Don't touch confidence scoring unless retrieval is fixed.** Confidence can only be honest if retrieval is good. Fixing confidence on bad retrieval just produces well-calibrated failure messages.
6. **Don't rubber-stamp tickets.** Reading the code and saying "looks implemented" is not verification. The code looked implemented before too, and it failed in the field.
