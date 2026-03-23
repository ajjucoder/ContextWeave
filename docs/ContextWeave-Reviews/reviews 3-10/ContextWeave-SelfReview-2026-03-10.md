# ContextWeave Field Review: ContextWeave (Self-Review)

**Date:** 2026-03-10
**ContextWeave Version:** 0.1.0 (from cw_status)
**Reviewer Model:** Claude Opus 4.6

## Project Profile

| Metric | Value |
|--------|-------|
| Project | ContextWeave |
| Stack | TypeScript ESM, Node 22, tree-sitter, better-sqlite3, MCP SDK stdio |
| Lines of Code | ~20k src, ~20k tests (~362k total including QA temp dirs) |
| Source Files | 107 src, 181 tests (1,734 indexed including QA temp) |
| Symbols Indexed | 15,618 (inflated ~4x by .qa-temp-* dirs: 13,037 symbols from QA) |
| Languages | TypeScript (746), JavaScript (666), markdown (146), yaml (71), json (48), tsx (41), bash (4), python (4), + 8 more |
| Index Time | Already indexed (persistent) |
| Architecture | MCP server with 7-phase capsule pipeline, BM25 search, BFS graph traversal |
| Key Directories | src/capsule (pipeline), src/core (indexer/graph/types), src/mcp (tools), src/db (schema/queries), src/memory (BM25/observations) |

## Task-Based Results

### Task A: Find and understand `scoreCandidates` (a scoring function in capsule generation)

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 3,194 | ~1,050 |
| Tool calls | 1 | 4 |
| Completeness | **Failed** | Complete |
| Time to correct answer | Never | Immediate |

**What ContextWeave found:** Related scoring functions (`scoreNode`, `selectCandidates`, `rankPivots`) across scorer.ts, pivot-scorer.ts, generator.ts. Surfaced the scoring pipeline context but never answered the question.

**What ContextWeave missed:** The function `scoreCandidates` does not exist. Grep reported "No matches found" in ~50 tokens. CW spent 3,194 tokens returning adjacent-but-wrong results without ever signaling the queried symbol doesn't exist.

**Follow-up suggestions useful?** No. Suggested reading `SessionContext` (irrelevant to scoring).

**Winner:** Grep+Read decisively. CW has no "symbol not found" signal.

### Task B: Trace end-to-end `cw_capsule` flow (MCP registration to response)

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,150 (capsule + cw_flow) | ~1,900 |
| Tool calls | 2 | 5 |
| Completeness | **Partial** | Complete |
| Time to correct answer | Never complete | 5 calls |

**What ContextWeave found:** `registerCapsuleTool` (capsule.ts) and `generateCapsule` (generator.ts) — the entry point and the core function. These are the bookends.

**What ContextWeave missed:** The intermediate pipeline: `classifyQueryIntent`, `packNodes`/`packNodesStoryMode`, `formatCapsule`, `buildStructuredOutput`, `hybridSearch`. Also missed `server.ts` as the wiring point. `cw_flow` traced 8/10 paths into `.qa-temp-probes/zod/` instead of the actual call chain. Included an irrelevant Fastify handler from `.qa-temp-manual/`.

**Follow-up suggestions useful?** No. Top suggestion was `isBusyError` (4-line utility function).

**Winner:** Grep+Read. More complete, fewer tokens, no noise.

### Task C: How does the BM25 + fuzzy fallback search pipeline work?

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~1,140 | ~1,200 |
| Tool calls | 1 | 3 |
| Completeness | **Partial** | Complete |
| Time to correct answer | 1 call (incomplete) | 3 calls (complete) |

**What ContextWeave found:** The `BM25Index` class with `searchWithFallback` method — the core 3-layer fallback logic (BM25 → trigram → Levenshtein). This was genuinely useful and showed the architecture clearly.

**What ContextWeave missed:** `src/utils/stemmer.ts` (Porter stemmer), `src/utils/fuzzy.ts` (trigram similarity), `src/utils/levenshtein.ts` (Levenshtein correction), `src/memory/observations.ts` (callers). For an architectural question about a pipeline across files, missing the utility implementations is a significant gap.

**Follow-up suggestions useful?** No. Suggested reading `logger` (1-line constant).

**Winner:** Tie on tokens, Grep+Read wins on completeness.

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: **6,484**
- Total Grep+Read tokens across 3 tasks: **~4,150**
- Actual savings: **-56% (ContextWeave cost MORE)**

## Stress Test Results

### Exact Symbol Ranking

| Symbol | Definition at #1? | What outranked it? | Confidence |
|--------|------------------|--------------------|------------|
| `classifyQueryIntent` | **Yes** | N/A — correct file, correct line | HIGH (94%) |
| `BM25Index` | **Yes** | N/A — correct file, correct line | HIGH (86%) |
| `computePageRank` | **Yes** | N/A — correct file, correct line | HIGH (100%) |

Symbol lookup mode is CW's strongest capability. All 3 definitions ranked #1 with appropriate confidence.

### Confidence Honesty

| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| "error handling patterns across the application" | HIGH (74%) | 1,966/2,000 | **No** — returned `pattern-detector.ts` (code patterns, not error handling), Hebrew Zod locale `error` variable, Fastify `defaultClientErrorHandler`. None are CW's error handling. Confused "error handling patterns" with the `patterns` DB table. |
| "database" | LOW (63%) | 1,996/2,000 | **Yes** — appropriately uncertain for a vague single-word query. Returned scattered `db: Database.Database` users but missed the actual database layer (schema.ts, migrations.ts). |

**Key finding:** The confidence model over-reports on queries with lexically ambiguous terms. "error" matched literal error variables; "pattern" matched the pattern detector. HIGH confidence for a wrong answer is dangerous.

### Budget Utilization

| Query | Budget | Used | Utilization | Issue |
|-------|--------|------|-------------|-------|
| "indexer process files build symbol graph" | 8,000 | 2,457 | **31%** | Returned BFS traversal + Zod `process()` instead of actual indexing functions |
| "MCP server tool registration" | 8,000 | 1,924 | **24%** | 4 of 9 files were from .qa-temp-* dirs (Fastify Request/server) |

Broad queries consistently underutilize budget (24-31%) while including noise from QA temp directories. The pipeline finds ~20 stage-B candidates and packs them, but many are from polluted sources.

### Flow Tracing

| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| generateCapsule → formatCapsule | **Yes** (1 hop, correct) | N/A | Direct call edges work perfectly |
| registerCapsuleTool (outgoing) | **No** | N/A | 8/10 paths went into .qa-temp-probes/zod/ (z.string() matched Zod source) |
| indexProject (outgoing) | **Partial** | N/A | Found fileQueries/symbolQueries imports but then traced to UserService.get from tests/fixtures (false edge) |

### Supporting Tools

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| cw_overview | "capsule pipeline" | 5 | Directory tree useful; top 6/10 files by symbol count are from .qa-temp-probes; query focus included Zod json-schema-generator |
| cw_recall | "architecture decisions" | 7 | Returned 2 genuinely useful observations (Wave 4 plan, production review findings). Best-performing tool. |
| cw_impact | "formatCapsule" | 8 | Correctly traced: formatCapsule → generateCapsule → generateCapsuleWithRuntime. Accurate and concise. |
| cw_stats | (session stats) | 3 | Claims "89% reduction, ~138k tokens saved" but actual measurements show CW cost 56% MORE than grep+read. Estimated grep+read cost assumes full file reads, not targeted grep. Misleading metric. |

## Flaws Found

### P0 (Critical — blocks adoption)

1. **QA temp directories massively pollute the index and all results.** `.qa-temp-probes/` (983 files, 9,435 symbols) and `.qa-temp-manual/` (374 files, 3,602 symbols) account for 83% of indexed symbols but are irrelevant to the actual codebase. They appear in capsule results (Fastify handlers, Zod locale files, Zod schemas), flow traces (8/10 paths from `registerCapsuleTool`), and overview rankings (6/10 top files). Root cause: these directories are not in `.gitignore` or `.cwignore`, and ContextWeave indexes everything it finds. Fix: add `.qa-temp-*` to auto-exclude heuristics for temp/QA directories, or better, surface a warning when >50% of indexed symbols come from non-src directories.

2. **No "symbol not found" signal.** When querying for a symbol that doesn't exist (`scoreCandidates`), the capsule returns 3,194 tokens of related-but-wrong results with no indication the queried symbol was never found. This is the most dangerous failure mode — the user assumes the answer is about their query when it's actually about adjacent symbols. Root cause: the pipeline resolves pivots by fuzzy matching and never checks if the exact queried symbol exists. Fix: add a check in pivot resolution — if the exact query term matches zero symbol names, emit a `symbolNotFound: true` flag in metadata.

### P1 (Important — degrades quality)

1. **Broad queries severely underutilize budget (24-31%).** Two queries with 8,000-token budgets used only 1,924 and 2,457 tokens. The pipeline retrieves ~20 stage-B candidates and stops, even when the budget could accommodate 4x more context. Root cause: likely in the `stageB` candidate limit or the packer's early termination. Fix: for broad queries with >50% unused budget, expand BFS depth or lower the lexical threshold to fill the budget.

2. **Confidence over-reports on lexically ambiguous queries.** "Error handling patterns" returned HIGH confidence (74%) for a completely wrong answer (confused "error" the concept with `error` variables, "patterns" with the pattern-detector module). Root cause: confidence is based on pivot coverage and dependency coverage, not on semantic match quality. If enough pivots match lexically, confidence is HIGH regardless of whether the matches are semantically relevant. Fix: add a semantic coherence signal — if the returned symbols span >5 unrelated files/modules, lower confidence.

3. **`cw_flow` traces into test fixtures and QA directories.** The flow tool follows all graph edges without source-type filtering. `registerCapsuleTool`'s `z.string()` call resolves to Zod source in `.qa-temp-probes/`. `indexProject`'s `fileQueries` import chains to `UserService.get` in `tests/fixtures/`. Root cause: the edge graph treats all files equally — no distinction between src, tests, and QA artifacts. Fix: add optional scope filtering to flow traces (default to src/) or deprioritize test/fixture/QA edges.

4. **Follow-up read suggestions are consistently unhelpful.** Across all 3 tasks, the suggested follow-up reads were wrong: `SessionContext` (irrelevant to scoring), `isBusyError` (4-line utility), `logger` (1-line constant), `.qa-temp-probes/zod/...json-schema-generator.ts process()` (completely irrelevant). Root cause: suggestions appear to be sorted by compressed-symbol score, not by relevance to the original query. Fix: rank follow-up suggestions by query-term overlap, not just by compression score.

5. **`cw_stats` reports inflated savings.** Claims "89% reduction" vs grep+read, but actual measurement across 3 tasks shows CW cost 56% MORE tokens. The estimated grep+read cost assumes reading entire files rather than targeted grep+read. Root cause: the savings estimator likely multiplies file count by average file size, rather than modeling actual developer behavior (grep → targeted read of 20-50 lines). Fix: use a more realistic baseline — e.g., count unique symbols served and multiply by average symbol size + grep overhead, not by full file size.

### P2 (Moderate — papercut)

1. **Duplicate code snippets in capsule output.** The capsule for `classifyQueryIntent` included `src/core/graph.ts:70-73` (the `neighbors` array literal) separately from the `bfsTraversal` function that contains it. Several capsules showed similar duplication where a sub-expression was included as both part of its parent function and as a standalone snippet. Fix: deduplicate nested snippets — if a snippet's line range is contained within another snippet from the same file, omit the inner one.

2. **"Previously shown" labels waste tokens.** Capsules include `[previously shown] export interface FileRecord` and similar labels that provide no value in a single capsule (there's no "previous" in a fresh query). These seem designed for multi-turn sessions but consume budget in single queries. Root cause: session context tracking marks symbols returned in prior capsules. Fix: only add "previously shown" labels when the sessionId matches a prior capsule in the same session, and exclude them from token budget accounting.

3. **Observations section often includes tangentially related design docs.** Multiple capsules included observations like "Problem Statement: CamelCase blindness" and "Problem Statement: fix missing from TASK PATTERN BUNDLES" that aren't relevant to the specific query. These consume 100-200 tokens per capsule. Root cause: BM25 observation search matches on common terms. Fix: increase the minimum score threshold for including observations, or limit to top 3 by score with a score floor.

## What Worked Well

1. **Symbol lookup mode is excellent.** All 3 exact symbol queries returned the definition at #1 with correct confidence scores. `computePageRank` achieved 100% coverage confidence with VERY_LOW uncertainty. This is genuinely the best way to look up a known symbol.

2. **`cw_impact` is accurate and useful.** Impact analysis for `formatCapsule` correctly identified the 2 affected symbols (generateCapsule, generateCapsuleWithRuntime) with correct edge types. This tool delivers on its promise.

3. **`cw_recall` surfaces useful cross-session memory.** The observation about Wave 4 architecture and the production review findings were genuinely valuable context that grep+read cannot provide. Cross-session memory is a unique differentiator.

4. **Multi-level compression is clever.** The `[full]`, `[skeleton]`, `[summary]`, `[reference]` compression levels are well-designed and allow the packer to fit more symbols within budget. The compression breakdown in metadata is honest about what was included at each level.

5. **Direct call flow tracing works.** `generateCapsule → formatCapsule` traced correctly in 1 hop. When edges are clean and direct, the flow tool is fast and accurate.

6. **Quality notes are honest about weaknesses.** "Pivot coverage below 50%", "dependency coverage below 25%", "overall coverage confidence below 60%" — these notes correctly flag when the capsule is unreliable.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | **9** |
| Broad recall (found all relevant files) | **3** |
| Budget utilization (% of budget used) | **3** |
| Confidence calibration (honest scores) | **4** |
| Flow tracing (traces real call chains) | **4** |
| Follow-up quality (suggested reads were useful) | **2** |
| Token savings vs grep+read (measured, not claimed) | **2** |
| **Overall: Would replace Grep+Explore?** | **No — Partial at best** |

**Summary:** ContextWeave excels at symbol lookup (the "I know the exact name" case) and impact analysis. It fails on broad queries, flow tracing across file boundaries, and any query where QA temp directories pollute results. The token savings claim is unsupported by measurement — in this review, CW cost 56% more than grep+read.

The fundamental blocker is `.qa-temp-*` directory pollution. Until that's fixed, the tool produces noise in ~40% of results. The second blocker is missing "symbol not found" — silently returning adjacent results for a nonexistent symbol is actively harmful.

## Evidence Snippets

### P0-1: QA temp directory pollution

Query: `cw_flow({ source: "registerCapsuleTool", max_hops: 5 })`
Result: 8 of 10 paths traced into `.qa-temp-probes/zod/`:
```
Path 3: [call] → method Mocker.string (.qa-temp-probes/zod/packages/zod/src/v3/tests/Mocker.ts:12)
Path 5: [call] → function string (.qa-temp-probes/zod/packages/zod/src/v4/classic/coerce.ts:5)
```
Correct answer: Should trace `registerCapsuleTool → generateCapsuleWithRuntime → generateCapsule → classifyQueryIntent → ...`

### P0-2: No "symbol not found" signal

Query: `cw_capsule({ query: "scoreCandidates", token_budget: 4000 })`
Result: 3,194 tokens, 43 symbols across 14 files, Confidence: LOW
Returned `scoreNode`, `selectCandidates`, `rankPivots` — but never indicated `scoreCandidates` doesn't exist.
Correct answer: `Grep("scoreCandidates") → "No matches found"` (50 tokens)

### P1-2: Confidence over-reports

Query: `cw_capsule({ query: "error handling patterns across the application", token_budget: 2000 })`
Result: **Confidence: HIGH** (74% coverage), returned:
- `pattern-detector.ts` (code pattern detection, not error handling)
- `.qa-temp-probes/zod/src/v4/locales/he.ts` (`const error` — Hebrew Zod locale)
- `.qa-temp-manual/fastify/fastify.js` (`defaultClientErrorHandler`)
None of these answer the query about ContextWeave's error handling patterns.

### P1-5: Inflated savings claim

`cw_stats()` output:
```
grep+read cost (est): ~156,076 tokens
ContextWeave used:    ~17,719 tokens
Estimated savings:    ~138,357 tokens (89% reduction)
```
Actual measurement across 3 tasks:
- ContextWeave: 6,484 tokens
- Grep+Read: 4,150 tokens
- Actual result: CW cost **56% more**, not 89% less
