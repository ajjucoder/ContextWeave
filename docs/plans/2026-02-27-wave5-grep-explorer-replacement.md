# Wave 5: Grep/Explorer Replacement — Complete CW Overhaul

## Goal
Make ContextWeave fully replace Grep and Explorer agent in Claude Code and any MCP-compatible agent.

**Targets:**
- 90%+ confidence on ALL query types (narrow, broad, task, vague)
- 90% token reduction vs Grep+Explorer baseline
- Zero empty-result queries on real-world codebases
- True plug-and-play for any developer

## Current State (Measured)

| Query Type | Avg Confidence | Failure Mode |
|---|---|---|
| Narrow (symbol lookup) | 86% | Works well |
| Broad (architecture) | 88% | Works on known terms |
| Task (implement/fix) | 77% | Decent but inconsistent |
| Vague ("performance") | 30% | **Returns zero results** |

**Root causes from audit:**
1. FTS only indexes symbol `name` + `kind` — not bodies, comments, strings
2. Non-code files (JSON, YAML, MD) completely invisible
3. No file system operations (no ls, no read, no glob)
4. `searchFilesByQuery` uses raw full-query MATCH — fails on multi-word queries
5. Stale DBs can have files/symbols but empty summaries/clusters
6. Stage A/B explosion on broad queries — too many candidates, not enough filtering

## Research Findings

### From Claude Code analysis (grepai benchmark, 155K LOC TypeScript):
- 37 Grep calls, 43 Read calls, 5 Explorer spawns per 5 questions
- **Dominant cost: Read calls (563K cache-creation tokens), not Grep output (~300 tokens)**
- Explorer runs on Haiku, uses Glob+Grep+Read iteratively, synthesizes before returning
- MCP tools cannot override built-in Grep — must be additional tools with CLAUDE.md policy

### From code search research:
- Zoekt/Sourcegraph: trigram indexing over ALL content, not just symbols
- Serena MCP: metadata-first (`include_body=false`), body on demand
- Navigation Paradox paper: graph covers 99.5% structural queries; BM25 covers semantic
- BM25 beats embeddings for code-to-code search; 14x faster

---

## Implementation Plan

### Phase 1: P0 — Fix Stale/Partial Index State

**Problem:** Existing DBs can have files/symbols populated but `file_summaries`/`file_clusters` empty. Derived data not always computed.

**Tasks:**
1.1. In startup bootstrap (runMigrations or post-index), detect and backfill:
  - If `file_summaries` count == 0 AND `files` count > 0 → backfill summaries for all files
  - If `file_clusters` count == 0 AND `files` count > 0 → recompute clusters
1.2. In `indexProject`, when `toProcess.length === 0`, do NOT early-return before checking/backfilling summaries and clusters
1.3. Add tests: "legacy DB with empty summaries/clusters gets repaired without full reindex"

### Phase 2: P0 — Fix Broad-Query File Prefiltering

**Problem:** `searchFilesByQuery` relies on single raw full-query MATCH against FTS. Multi-word queries like "paper trading runner strategy engine" produce poor or zero results.

**Tasks:**
2.1. Decompose query into meaningful term groups (reuse `decomposeQuery` or `tokenize`)
2.2. Union retrieval: search each term/phrase separately, merge results, rank by term coverage
2.3. Fallback path: if full-query MATCH returns 0, run per-term retrieval and merge
2.4. Test with real broad queries on polymarket repo:
  - "paper trading runner strategy engine execution adapter profit"
  - "backtest results profit PnL win rate equity drawdown"

### Phase 3: P1 — Control Stage A/B Explosion

**Problem:** Broad queries produce too many pivot candidates, overwhelming ranking.

**Tasks:**
3.1. Per-term candidate cap (e.g., max 20 pivots per search term)
3.2. Global candidate cap before ranking (soft limit based on budget)
3.3. Stronger locality bias: symbols in same directory as top pivots get boosted
3.4. Test-file downweighting: `*.test.*`, `*.spec.*` files get 0.5x score for non-test queries
3.5. Hub dampening: high-degree symbols only survive if lexical match is strong

### Phase 4: P1 — Improve Packing/Budget Utilization for Broad/Task

**Problem:** Broad/task queries stop packing at very low token utilization when useful candidates remain.

**Tasks:**
4.1. Add utilization floor for broad/task (similar to narrow promotion)
4.2. Adaptive budget filling: if tokensUsed < 50% of budget and candidates remain, promote L3→L2→L1
4.3. Increase packed symbols/file-context until budget is meaningfully used (>70%)
4.4. Test: broad queries should use >60% of token budget when candidates available

### Phase 5: P1 — Fix Quality Label Clarity

**Problem:** "LOW confidence (high)" is confusing — low confidence + high uncertainty mixed in one label.

**Tasks:**
5.1. Replace ambiguous formatting with clear labels:
  - "Confidence: LOW | Uncertainty: HIGH"
  - "Confidence: 73% (medium uncertainty)"
5.2. Update formatter.ts header rendering
5.3. Update any tests that assert on the old format

### Phase 6: P1 — Add CW Grep/Explorer Replacement Tools

**New tools to add:**

#### 6.1. `cw_overview` — Compact Project/Module Overview
```typescript
{
  path?: string,         // directory (default: project root)
  depth?: number,        // exploration depth (default: 2)
  max_tokens?: number    // output cap (default: 2000)
}
```
Returns: file tree + top-level symbols per file + cluster summary.
Replaces: Explorer agent's initial exploration phase.

#### 6.2. `cw_files` — Directory/Glob Listing
```typescript
{
  pattern?: string,      // glob pattern ("**/*.test.ts", "src/capsule/*")
  path?: string,         // root directory
  max_results?: number   // cap (default: 50)
}
```
Returns: matching file paths with metadata (language, symbol count, size).
Replaces: Glob tool, `ls` via Bash.

#### 6.3. `cw_search` — Content Search with Snippets
```typescript
{
  query: string,         // search pattern (text or regex)
  path?: string,         // scope to directory
  glob?: string,         // file filter ("*.ts")
  context_lines?: number,// lines around match (default: 2)
  max_results?: number   // cap (default: 20)
}
```
Returns: file:line:content matches (ripgrep-style output).
Replaces: Grep tool for content search.
**Implementation:** Uses `full_source` from symbols table + raw file content for non-indexed files. FTS5 over symbol bodies + file-level content.

#### 6.4. `cw_read` — Bounded File Read
```typescript
{
  path: string,          // file path
  start_line?: number,   // optional start
  end_line?: number,     // optional end
  symbol?: string,       // read just this symbol
  max_lines?: number     // cap (default: 500)
}
```
Returns: file content scoped to the requested range.
Replaces: Read tool for most use cases.

### Phase 7: Tests and Evidence

7.1. Add/extend tests for:
  - Legacy DB backfill of summaries/clusters
  - Broad-query file prefilter fallback behavior
  - Packing utilization for broad/task
  - New MCP tool schemas and basic behavior
7.2. Run full test suite
7.3. Real check on /path/to/project:
  - "paper trading runner strategy engine execution adapter profit"
  - "backtest results profit PnL win rate equity drawdown"
7.4. Report before/after metrics:
  - stageA candidates, stageB selected, symbols packed
  - tokens used, coverageConfidence
  - Whether PaperExecutionAdapter, LiveWebSocketFeedAdapter, src/paper/runner.ts appear in output

## Constraints
- Keep changes production-safe and backward compatible
- Do not remove existing tools
- Commit logically in small commits with clear messages
- Conventional commit format (feat/fix/test/refactor)
