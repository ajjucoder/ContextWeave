# ContextWeave MCP — Field Reviews

Consolidated reviews from running ContextWeave against 5 real-world codebases. Each review exercised the actual MCP server over stdio and tested narrow queries, broad queries, and supporting tools.

---

## Table of Contents

- [Review Summary Matrix](#review-summary-matrix)
- [Review 1: Sitecraft (Next.js/Supabase)](#review-1-sitecraft)
- [Review 2: FocusPact (Next.js/Supabase)](#review-2-focuspact)
- [Review 3: Codex Team Orchestrator (TypeScript)](#review-3-codex-team-orchestrator)
- [Review 4: KisanSathi (Java/Spring + HTML/CSS)](#review-4-kisansathi)
- [Review 5: Claud-ometer (TypeScript)](#review-5-claud-ometer)
- [Cross-Review Finding Synthesis](#cross-review-finding-synthesis)
- [Tool-by-Tool Scorecard](#tool-by-tool-scorecard)
- [Prioritized Improvement Roadmap](#prioritized-improvement-roadmap)

---

## Review Summary Matrix

| # | Project | Stack | Files / Symbols | Narrow Quality | Broad Quality | Best Tool | Worst Tool | Verdict |
|---|---------|-------|-----------------|----------------|---------------|-----------|------------|---------|
| 1 | Sitecraft | Next.js, Supabase | 321 / 1,968 | Poor (48% coverage) | Decent (80% coverage) | `cw_grep` | `cw_capsule` (narrow) | Not ready to replace Grep |
| 2 | FocusPact | Next.js, Supabase | ~200+ | Partial (missed route handler) | Incomplete (missed core files) | `cw_grep`, `cw_read` | `cw_overview` | Promising but not ready |
| 3 | Codex Team Orchestrator | TypeScript | 237-382 / 3,148-3,411 | Noisy (30% pivot coverage) | Overconfident (HIGH at 63-68%) | Narrow symbol lookup | Broad retrieval | Fast but unreliable for broad |
| 4 | KisanSathi | Java, Spring, HTML/CSS | 444 / 2,773 | Found target + noise | Failed (returned static JS over Java) | `cw_grep` | `cw_capsule` (broad) | Ranking broken for mixed repos |
| 5 | Claud-ometer | TypeScript | ~100+ | Found function + leaked neighbors | Missed API route in chain | `cw_read`, `cw_grep` | `cw_overview` | Useful first-pass, not a replacement |

---

## Review 1: Sitecraft

**Codebase:** 321 files, 1,968 symbols — Next.js + Supabase website builder

### Tool Results

| Tool | Query Type | Result Quality |
|------|-----------|----------------|
| `cw_capsule` (narrow) | "useDataLayer hook + consumers" | **Poor** — 48% coverage, LOW confidence, returned irrelevant symbols (ServicesSection, template plan docs) |
| `cw_capsule` (broad) | "auth + dashboard + data layer connections" | **Decent** — 80% coverage, HIGH confidence, but missed middleware (proxy.ts), returned AboutApp (irrelevant) |
| `cw_impact` | useDataLayer dependents | **Good** — found all 8 direct consumers + 4 depth-2 dependents accurately |
| `cw_flow` | useDataLayer outgoing calls | **Mediocre** — found useSupabaseMutations correctly, but listed duplicate Site/Project interfaces from legacy dirs |
| `cw_recall` | "data layer architecture" | **OK** — 4 relevant observations, but all surface-level doc quotes, not deep learned patterns |
| `cw_grep` | useDataLayer in .tsx files | **Good** — fast, accurate, 20 results with symbol context. Best tool in the suite |
| `cw_overview` | auth + middleware + dashboard | **Weak** — "no direct symbol name match" on 5/8 focus results, listed legal/terms/page.tsx as relevant to auth |
| `cw_stats` | Session savings | **Misleading** — claims 97% token reduction but capsule quality was poor on the narrow query |

### Findings

**P0: Capsule retrieval misses the actual target.** The narrow query asked for `useDataLayer` implementation and consumers. The capsule returned ServicesSection (irrelevant), template redesign docs (irrelevant), CreateSiteWizard full source (278 lines, way too much), and AboutApp.getFontImportUrl (irrelevant). The actual `useDataLayer` implementation from `dataLayer.ts` was only a 2-line skeleton. Meanwhile, `cw_grep` found all 20 import sites instantly. Root cause: ranking over-weights co-occurrence in the observation/memory store and under-weights direct symbol-name matching.

**P0: Cross-session feedback contamination.** `post-tool-use` updates whichever capsule log is globally latest, not the active session log (`post-tool-use.ts:57`, `capsule-log.ts:23`). Validated at runtime: a Read from session-a updated session-b's miss_ratio/followed_up row. Breaks calibration under concurrent agents.

**P0: Coverage confidence can report 1.0 on thin retrieval.** `computeCoverageConfidence` largely ignores pivotCount/pivotsIncluded when totalRelevantPivots > 0 (`confidence.ts:27`, `confidence.ts:41`). Runtime check: pivotCount=100, pivotsIncluded=1, relevantPivotsIncluded=1 — confidence returned 1 for narrow, broad, and task.

**P1: Eval gates allow low-precision/high-confidence behavior to pass.** Baseline shows precision 0.4896 with avg confidence 0.9462. Thresholds only require precision >= 0.15 and confidence >= 0.65 (`eval-runner.ts:115`).

**P1: cw_capsule drops structured quality metadata at MCP boundary.** Tool returns only text content (`capsule.ts:43`), while generator produces rich metadata (quality, strategy, uncertainty, etc.) (`types.ts:201`, `generator.ts:1580`).

**P1: Follow-up commands are ambiguous in large repos.** Capsule formatter emits unqualified `cw_read(symbol: "X")` (`formatter.ts:122`). Resolution falls back to fuzzy name + centrality sort when not file-qualified (`read.ts:44`, `read.ts:62`).

**P1: cw_grep regex semantics are inconsistent.** `/fooBar/` treated literally in ripgrep path unless `use_regex: true`, but behaves as regex in fallback scanner (`search.ts:40`, `search.ts:208`).

**Major: Legacy/duplicate directories pollute results.** `cw_flow` traced useDataLayer and returned Site interface from three locations (src, sitecraft/, sitecraft_demo_AIStudio/). No concept of primary source tree vs archived code.

**Major: Token budget utilization is poor.** Narrow capsule used 702/4,000 tokens (18%). Broad capsule used 468/8,000 tokens (6%). Too conservative about including full source.

**Major: Observation store is shallow.** `cw_recall` returns verbatim quotes from ARCHITECTURE.md and README.md. Not learned patterns — just indexed doc fragments.

**Moderate: No cross-file pattern detection.** Does not detect recurring code patterns, convention violations, or architectural layers.

**Moderate: No incremental awareness.** 5 stale files in index. No automatic re-indexing on file change.

---

## Review 2: FocusPact

**Codebase:** Next.js + Supabase focus session app

### Queries Tested

- **Narrow:** "Where is the minimum focus duration and zombie protocol enforced when stopping a session?" (341 tokens)
- **Broad:** "Explain the focus session architecture end to end..." (706 tokens)

### Findings

**P0: Retrieval completeness insufficient.** Narrow capsule found `src/lib/session-rules.ts:23` and `src/app/actions/sessions.ts:139`, but missed the parallel stop implementation in `src/app/api/sessions/stop/route.ts:55`. The action and route don't enforce the same rule path. Root cause: `intent-classifier.ts:134` treats long question-word queries as broad based on term count.

**P0: Broad retrieval missing code-body semantics.** `cw_overview(query: "realtime supabase session")` returned no focused matches even though key code is in `DashboardClient.tsx:629` and `TribeDashboard.tsx:32`. File summaries built only from path tokens, symbol names, signatures, and kinds (`file-summaries.ts:193`) — no string literals, JSX text, SQL/table names, or channel names indexed.

**P0: Flow tracing too weak.** Could not trace `handleStopSession` -> `stopFocusSession` or `stopFocusSession` -> `validateSession`. ContextWeave explicitly admits the limitation (`flow.ts:233`). Cannot resolve imported identifiers to exported symbols, track aliases, or trace JSX prop callbacks.

**P1: Parser robustness not production-safe for TSX.** Valid files flagged as syntax errors because raw `&` in JSX text produces tree-sitter ERROR. Any `rootNode.hasError` recorded as file error (`parser.ts:1141`).

**P1: Ranking overweights docs/config for architecture questions.** Both capsules spent early budget on docs and repo guidance instead of runtime files. Missed `src/lib/data.ts:144` and `src/app/dashboard/page.tsx:14`.

**P1: Savings metric not trustworthy.** `cw_stats` reported 97% savings but baseline is just summed file sizes / 4 (`stats.ts:53`). Not a real comparison against Explorer/Grep agent traces.

**P2: Integration friction.** ContextWeave not visible as connected MCP server in some environments. Setup needs to be near-zero.

### What Worked

- `cw_grep` found realtime subscriptions and exact symbol usage quickly
- `cw_read` file-qualified symbol reads worked well
- Uncertainty reporting was honest — low confidence correctly surfaced

---

## Review 3: Codex Team Orchestrator

**Codebase:** 237-382 files, 3,148-3,411 symbols — TypeScript agent orchestration system

### Queries Tested

- **Narrow:** `cw_capsule("recommendFanout", 1200, mode="review")`
- **Broad:** `cw_capsule("how do tasks get scheduled and dispatched to worker transports in managed runtime", 1800, mode="review")`
- Tested both stored index (0 file_summaries) and fresh reindex (382 file_summaries)

### Findings

**P0: Existing-project upgrade hygiene is weak.** `server.ts` runs schema migrations at startup but never backfills derived retrieval artifacts. On stored index: file_summaries=0, `cw_overview` couldn't produce focused broad-query hits until fresh reindex.

**P0: Content fallback is too aggressive for narrow queries.** `generator.ts` triggers content fallback whenever < 3 raw pivots exist, and `content-fallback.ts` expands into all symbols from up to 10 files. For `recommendFanout`, the exact symbol existed but runtime injected 90 extra pivots, hit 1200/1200 tokens, and only achieved 30% pivot coverage.

**P0: Confidence is over-calibrated for broad queries.** Broad query returned HIGH confidence at 63-68% coverage while missing obvious runtime files, using only 320/1800 tokens. `confidence.ts` makes it too easy to report HIGH/LOW uncertainty on partial retrieval.

**P1: Broad-query decomposition too heuristic.** `query-decomposer.ts` splits queries into fixed 3-term groups. `clusters.ts` builds file clusters from import edges only, then falls back to crude first-two-directory bucketing.

**P1: Ranking is hand-tuned lexical heuristics, not semantic.** `pivot-scorer.ts` is regex/path-weight heavy. `semantic-reranker.ts` is a tiny hard-coded concept map plus token overlap — not repo-adaptive.

**P1: Budget utilization arbitrarily capped.** `generator.ts` only runs broad/task refill when tokenBudget >= 2000. The 1800-token broad run underfilled badly and never got a second expansion pass.

---

## Review 4: KisanSathi

**Codebase:** 444 files, 2,773 symbols — Java Spring Boot + HTML/CSS/JS (332 JS files vs 78 Java files)

### Queries Tested

- **Narrow:** "SecurityConfig authentication filter chains and remember-me setup"
- **Broad:** "Explain the end-to-end user shopping flow..."

### Findings

**P0: Ranking is wrong for mixed backend + static-asset repos.** ContextWeave treats any `/src/` path as "runtime" (`file-summaries.ts`), so `src/main/resources/static/...` gets boosted alongside `src/main/java/...`. No downweight for resources/static, assets, templates, or vendor code in `directory-weights.ts`. Broad shopping-flow query preferred static JS over the actual Java backend chain (`ProductController.java`, `CartController.java`, `CheckoutController.java`, `CheckoutModel.java`, `OrderModel.java`, `SearchService.java`).

**P0: Bootstrap memory pollutes capsules.** ContextWeave seeds README.md, CLAUDE.md, and .claude/CLAUDE.md as durable observations (`bootstrap.ts`) with 0.9 confidence. Capsule formatter emits high-confidence observations first (`formatter.ts`). A code query started with ContextWeave tool instructions and still claimed high confidence.

**P1: Follow-up navigation is brittle.** "Narrow to most relevant directory" derived from first packed node only (`formatter.ts`). Produced bad recommendation like `Controller/Product/Exception`.

**P1: Product overstates token savings even when retrieval is poor.** `cw_stats` reported 82% savings on a session whose answer was incomplete. Metric only compares capsule tokens to estimated raw file bytes (`stats.ts`).

**P1: Default init/index hygiene insufficient.** Generated config ignores standard JS build dirs but not large `src/main/resources/static` trees. Most indexed symbols came from files an agent shouldn't read first.

### What Worked

- `cw_grep` found `CheckoutModel` immediately — index had the data, ranking was the failure

---

## Review 5: Claud-ometer

**Codebase:** TypeScript — Claude session analytics tool

### Queries Tested

- **Narrow:** `cw_capsule(query: "searchSessions", token_budget: 1200, mode: "review")`
- **Broad:** `cw_capsule(query: "how does session detail data flow from Claude JSONL files to the UI", token_budget: 3200, mode: "review")`

### Findings

**P0: Exact-query precision is too loose.** Narrow `searchSessions` query found the right function at `reader.ts:356`, but expanded into adjacent functions (`reader.ts:276`, `reader.ts:133`). Hard fallback rule in `generator.ts:580` triggers content expansion whenever < 3 pivots found, plus file-wide expansion in `content-fallback.ts:8`.

**P0: Broad flow recall not reliable for end-to-end reasoning.** Real chain: `reader.ts:276` -> `route.ts:12` -> `hooks.ts:28` -> `page.tsx:18`. Capsule surfaced reader, hook skeleton, and page skeleton, but missed the API route implementation entirely.

**P0: Index trust is suspect.** `cw_status` reported syntax error for `page.tsx`, but `npm run lint` returned 0 errors. Valid TSX marked as broken undermines retrieval quality and confidence.

**P1: Query classification is brittle.** Natural-language "where is session search filtering implemented" treated as broader multi-pass exploration query. Comes from term-count heuristic in `intent-classifier.ts:134`.

**P1: Follow-up guidance often wrong.** Capsule recommended `cw_read` targets by score alone (`formatter.ts:88`), pushing generic neighbors ahead of the best next read for the query.

**P1: cw_overview weak for semantic discovery.** On broad flow query, returned "No focused file matches found" and suggested grepping. Relies on lexical file-summary search (`overview.ts:192`).

**P1: Glob ergonomics not production-safe.** `cw_grep` gave false negative for `**/*.{ts,tsx}` but worked with `**/*.tsx`. `path-filters.ts:36` silently escapes `{}` instead of rejecting unsupported brace syntax.

### What Worked

- `cw_read` and `cw_grep` are good once you have a file or symbol
- `cw_stats` estimated 92% token reduction versus naive raw reads

---

## Cross-Review Finding Synthesis

Findings that appeared across multiple reviews, ordered by frequency and severity.

### Appears in All 5 Reviews

| Finding | Severity | Root Cause | Source References |
|---------|----------|-----------|-------------------|
| **Broad capsule retrieval is incomplete and overconfident** | P0 | Confidence model doesn't penalize low token utilization, low pivot coverage, or missing anchor files | `confidence.ts`, `generator.ts` |
| **Token budget severely underutilized** | P0 | Conservative skeletonization + hard minimum thresholds for refill passes | `generator.ts` (>= 2000 gate), `formatter.ts` |
| **Savings metrics are misleading** | P1 | Baseline is sum of file sizes / 4, not actual agent read traces | `stats.ts:53` |

### Appears in 4/5 Reviews

| Finding | Severity | Root Cause | Repos Affected |
|---------|----------|-----------|----------------|
| **Narrow queries leak into irrelevant symbols** | P0 | Content fallback triggers when < 3 pivots, expanding to 10 files | Sitecraft, Codex, Claud-ometer, FocusPact |
| **cw_overview returns no useful results for semantic queries** | P1 | File summaries are path/symbol/signature tokens only — no body semantics | Sitecraft, FocusPact, Claud-ometer, Codex |
| **Follow-up suggestions are wrong or ambiguous** | P1 | Score-based ranking without query-relevance weighting; unqualified symbol names | Sitecraft, KisanSathi, Claud-ometer, FocusPact |
| **Query classification treats narrow intent as broad** | P1 | Term-count heuristic in `intent-classifier.ts:134` | FocusPact, Claud-ometer, Codex, Sitecraft |

### Appears in 3/5 Reviews

| Finding | Severity | Root Cause | Repos Affected |
|---------|----------|-----------|----------------|
| **cw_flow / cw_impact too shallow for real call chains** | P0 | Static edge traversal only; can't resolve aliases, callbacks, HOF, dynamic dispatch | Sitecraft, FocusPact, Claud-ometer |
| **Bootstrap memory / docs pollute code capsules** | P0 | README/CLAUDE.md seeded as 0.9-confidence durable observations, emitted first | KisanSathi, Codex, Sitecraft |
| **TSX parser marks valid files as broken** | P1 | `rootNode.hasError` on recoverable JSX-text issues poisons file quality | FocusPact, Claud-ometer, Sitecraft |
| **Cross-session feedback contamination** | P0 | Post-tool-use updates globally latest capsule log, not active session | Sitecraft (x2 mentions), FocusPact |

### Appears in 2/5 Reviews

| Finding | Severity | Root Cause | Repos Affected |
|---------|----------|-----------|----------------|
| **Legacy/duplicate/static directories pollute results** | P0 | No primary vs archive directory concept; no auto-downweight for resources/static/vendor | Sitecraft, KisanSathi |
| **cw_grep regex behavior inconsistent across backends** | P1 | Ripgrep vs fallback scanner treat `/pattern/` syntax differently | Sitecraft, Claud-ometer |
| **Existing-project upgrade doesn't backfill artifacts** | P0 | Migrations run but file_summaries/clusters not regenerated | Codex, KisanSathi |
| **MCP returns prose, not structured JSON** | P1 | `capsule.ts` only returns text; drops quality/strategy/uncertainty metadata | Sitecraft (x2), Codex |

---

## Tool-by-Tool Scorecard

Aggregate assessment across all 5 reviews.

| Tool | Rating | Strengths | Weaknesses |
|------|--------|-----------|------------|
| **cw_grep** | Strong | Fast, accurate, low noise, best tool in the suite across all reviews | Inconsistent regex semantics; `{}` brace expansion silently fails |
| **cw_read** | Strong | Reliable file-qualified symbol reads, good low-token primitive | Fuzzy resolution unsafe for common names without file qualification |
| **cw_impact** | Good | Accurate direct dependents + depth-2 traversal | Too shallow beyond depth 2; can't trace dynamic/callback paths |
| **cw_capsule** (narrow) | Weak | Sometimes finds the target symbol | Content fallback leaks 10+ files of noise; misses the actual query target; symbol-name boost too weak |
| **cw_capsule** (broad) | Weak | Covers some relevant files | Severely underutilizes budget; overconfident; misses core runtime files; prefers docs over code |
| **cw_flow** | Weak | Finds direct import edges | Cannot trace real call chains; shows legacy/duplicate paths; admits its own limitations |
| **cw_overview** | Poor | Occasionally useful directory-level view | Returns "no matches" on semantic queries; lexical-only; relevance matching is broken |
| **cw_recall** | Poor | Returns something when asked | Only surface-level doc quotes, not learned patterns; BM25 over docs the agent could just Read |
| **cw_stats** | Misleading | Provides session numbers | 97% savings claims based on unrealistic baselines; no quality weighting |
| **cw_status** | Functional | Shows index health | Reports valid TSX as syntax errors |

---

## Prioritized Improvement Roadmap

### Tier 1: Fix the Fundamentals (Must-Have for Usability)

These fix the issues that currently make `cw_capsule` unreliable as a primary retrieval tool.

| # | Fix | What | Why | Source Files |
|---|-----|------|-----|-------------|
| 1 | **Symbol-name boost** | When query contains an exact symbol name, that symbol's definition MUST be #1 result | Capsule for "useDataLayer" should always start with useDataLayer's source | `pivot-scorer.ts`, `generator.ts` |
| 2 | **Kill content fallback for exact matches** | If a narrow query resolves to a unique symbol, skip the "minimum 3 pivots" fallback entirely | Stops 90-pivot explosions on single-symbol lookups | `generator.ts:580`, `content-fallback.ts` |
| 3 | **Fill the token budget** | If budget is 8,000 and only 468 used, expand top-scored symbols to full source until budget is filled | Users request a budget for a reason — don't return 6% of it | `generator.ts` (>= 2000 gate) |
| 4 | **Rebuild confidence calibration** | Never emit HIGH confidence when token utilization is low, pivot coverage is poor, or expected anchor files are missing | False confidence is worse than no confidence | `confidence.ts` |
| 5 | **Fix cross-session feedback** | Make all feedback and memory writes session-scoped and single-writer | Stops one agent from corrupting another's calibration data | `post-tool-use.ts:57`, `capsule-log.ts:23` |
| 6 | **Directory scoping / weighting** | Allow marking dirs as primary vs archive. Auto-downweight resources/static, vendor, legacy, demo dirs | Stops legacy/static dirs from polluting every result | `directory-weights.ts`, `file-summaries.ts` |
| 7 | **Make startup self-healing** | On serve, detect missing file_summaries/file_clusters and backfill automatically | Prevents "0 file_summaries" degraded state on existing repos | `server.ts`, `indexer.ts` |
| 8 | **Separate docs from code capsules** | Don't inject CLAUDE.md / README into code capsules unless query explicitly asks for docs/conventions | Stops bootstrap memory from stealing budget from actual code | `bootstrap.ts`, `formatter.ts` |
| 9 | **TSX parser tolerance** | Add tolerant TSX recovery; classify benign JSX-text parse issues separately from real errors | Stops valid files from being marked broken | `parser.ts:1141` |
| 10 | **Normalize cw_grep regex** | Make identical inputs behave identically across ripgrep and fallback backends; reject unsupported patterns loudly | Agents get environment-dependent behavior currently | `search.ts:40`, `search.ts:208`, `path-filters.ts:36` |

### Tier 2: Reach Feature Parity with Augment

These make ContextWeave better than Grep + Explore Agent for most tasks.

| # | Feature | What | Impact |
|---|---------|------|--------|
| 1 | **Chunked semantic embeddings** | Replace or supplement BM25 with vector embeddings per code chunk (~50-100 line windows) | BM25 can't handle "how does auth connect to the dashboard" — needs semantic similarity |
| 2 | **Intent-aware query routing** | Classify queries as symbol-lookup, pattern-search, architecture-question, debugging. Route each to different pipeline | Symbol lookup should go straight to AST; architecture needs convention graph |
| 3 | **Repo-shape profiling** | Detect "Spring backend + static asset dump" or "Next.js + Supabase" and create retrieval lanes | Broad runtime queries should search backend-java first, not static JS |
| 4 | **Stronger flow tracing** | Resolve imported identifiers to exports, track aliases, add server-action and route edges, trace JSX prop callbacks and HOF patterns | Required for "trace the path" queries to work |
| 5 | **Body-aware file summaries** | Index string literals, JSX text, SQL/table names, channel names, important body calls in file summaries | Fixes `cw_overview` returning "no matches" on semantic queries |
| 6 | **Pattern detection engine** | On index build, detect recurring structural patterns: "all files in src/app/dashboard/*/page.tsx follow pattern X" | Killer feature — agents waste thousands of tokens rediscovering patterns every session |
| 7 | **Smart observation promotion** | When same pattern is observed 3+ times across sessions, auto-promote to "convention" with higher recall weight | Currently all observations are equal; stable patterns should rank higher |
| 8 | **IDF-style term suppression** | Suppress generic terms like get, page, query, route in ranking; boost exact path/module matches | Fixes narrow query contamination from common code words |
| 9 | **Better clustering** | Use import + call + type/reference edges, not import-only unions plus directory slicing | Current clusters are too crude for broad decomposition |
| 10 | **Mandatory chain coverage** | For web apps, broad queries explicitly try to include storage/parser -> server route -> client fetch/hook -> UI entrypoint | Ensures end-to-end flow queries don't miss middle layers |

### Tier 3: Surpass Augment (Open Source Differentiators)

| # | Feature | What | Why Open Source Wins |
|---|---------|------|---------------------|
| 1 | **Agent-facing structured API** | Return JSON with `{ definition, consumers, patterns, conventions }` instead of markdown prose | LLM agents parse structure better than prose; Augment is built for IDE display, ContextWeave is for agent consumption |
| 2 | **Persistent cross-session dependency graph** | Store full graph to disk, load on startup, diff against current files | First-capsule latency drops from "re-index 321 files" to "diff 5 changed files" |
| 3 | **Collaborative observations** | Multiple agents in a team share observations through a shared memory store | No commercial tool does this; sub-agents tag findings and orchestrator reads them |
| 4 | **Cost-aware retrieval** | Track actual token costs per capsule and optimize ranking for information-per-token | The 97% savings claim needs to become real savings backed by quality metrics |
| 5 | **Pluggable index backends** | Support tree-sitter (current), LSP, and language-server-protocol for richer type info | Tree-sitter gives syntax; LSP gives types, completions, go-to-definition. The combo is much stronger |
| 6 | **Benchmark suite** | Ship a test suite: "given this codebase and query, capsule MUST contain these symbols" | Catches "useDataLayer capsule doesn't contain useDataLayer" automatically |
| 7 | **File-change watcher** | `fs.watch` or chokidar on project root, re-index changed files incrementally | 5 stale files after one session means index drifts fast |
| 8 | **Convention graph** | Build a layer above symbol graph: "data layer" -> "dashboard pages" -> "route handlers" -> "Supabase queries" | Lets agents reason about architecture, not just imports |
| 9 | **Canonicalize DB paths** | Store project-relative paths, resolve absolute only at read time | Current absolute paths hurt portability and leak filesystem structure |
| 10 | **Real benchmarking** | Measure first correct file found, follow-up reads needed, missed critical anchors, wrong high-confidence answers against actual agent traces | Replace synthetic savings metrics with task-success metrics |

---

## Bottom Line

**What works today:**
- `cw_grep` and `cw_read` are genuinely useful as low-token navigation primitives
- `cw_impact` provides accurate direct-dependency analysis
- The AST index, symbol graph, and token-budgeted architecture are fundamentally sound
- Uncertainty reporting is honest when it triggers correctly

**What doesn't work yet:**
- `cw_capsule` (the flagship tool) has a retrieval quality problem: it finds things *related to* what you asked about, but often misses *the actual thing you asked about*
- Broad queries are overconfident, underutilize their budget, and miss core runtime files
- `cw_overview` and `cw_recall` provide minimal value over direct Grep/Read
- `cw_flow` cannot trace real application call chains
- Multi-agent correctness is broken via cross-session feedback contamination

**The gap to "replace Grep + Explorer Agent":**
1. **Fix capsule retrieval quality** (Tier 1) — this alone makes it usable as a primary tool
2. **Add semantic embeddings + pattern detection** (Tier 2) — this makes it better than Grep + Explore
3. **Build agent-native API + cross-session graph** (Tier 3) — this makes it the best open-source code intelligence layer available

The gap between where it is and where Augment is isn't huge — it's mostly about retrieval precision and pattern-level intelligence. The symbol graph, impact analysis, and local-first architecture are already ahead of what most tools offer.
