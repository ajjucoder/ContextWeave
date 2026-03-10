# ContextWeave — Next Iteration Plan

**Source:** Cross-analysis of 8 field reviews (2026-03-10)
**Full analysis:** `../ContextWeave-Reviews/ANALYSIS-2026-03-10.md`
**Individual reviews:** `../ContextWeave-Reviews/*.md` (8 files)
**Goal:** Make cw_capsule preferred over grep+read for 80%+ of tasks with 50%+ real token savings.

---

## Context for the Implementor

You are fixing ContextWeave, a local-first MCP server that gives AI coding agents token-budgeted code context. It has AST parsing (tree-sitter, 12 languages), a symbol dependency graph, hybrid BM25+vector search, and a 7-phase capsule pipeline. The architecture is sound. The execution quality is poor.

**8 field reviews tested ContextWeave against real codebases. Results:**
- 0/8 reviewers would replace Grep+Explore with ContextWeave
- 2/24 tasks (8.3%) got complete answers from CW; 24/24 from Grep+Read
- ~0% quality-adjusted token savings (CW's cw_stats claims 69.6% — off by the entire magnitude)
- 5 systemic flaws appeared in ALL 8 reviews

**The previous iteration (CODEX_HANDOFF.md) had 16 items. Audit results:**
- 2 fully working in field
- 5 partially implemented but not working (escape hatches left in, wrong thresholds, root cause shifted)
- 4 implemented but no field evidence of effect
- 3 unknown/not tested

**Read before starting:**
1. This file (the fix plan)
2. `../ContextWeave-Reviews/ANALYSIS-2026-03-10.md` — full analysis with root cause diagnosis (Step 2), code paths, line numbers
3. Skim 2-3 review files from `../ContextWeave-Reviews/` to understand what field failures look like

**Key lesson from the last iteration:** Partial fixes with escape hatches don't work. The confidence fix (CODEX_HANDOFF 0.4) specified 4 changes; 3 were not made; the fix had zero field effect. This time: implement each fix completely, verify with tests that cover the failure cases from reviews, and do NOT leave escape hatches "for edge cases."

---

## Execution Order

```
Priority 1: Fix 1 (Confidence)      — 1 day    — No dependencies
Priority 2: Fix 3 (Noise)           — 2 days   — No dependencies
Priority 3: Fix 2 (Budget)          — 2 days   — After Fix 3
Priority 4: Fix 7 (Index pollution)  — 1 day    — No dependencies
Priority 5: Fix 6 (Honest stats)    — 0.5 day  — No dependencies
Priority 6: Fix 5 (Follow-ups)      — 1 day    — After Fix 3
Priority 7: Fix 8 (Target protect)  — 0.5 day  — No dependencies
Priority 8: Fix 9 (Not found)       — 0.5 day  — No dependencies
Priority 9: Fix 4 (Flow tracing)    — 2-3 days — No dependencies
Priority 10: Fix 10 (Impact)        — 1 day    — No dependencies
```

Fixes 1, 4, 7 can run in parallel (no dependencies).
Fix 3 must complete before Fixes 2, 5, 6.
Commit after each fix. Run `npm test` after each fix. Do NOT batch.

---

## Fix 1: Confidence Calibration — Remove All Escape Hatches

**Files:** `src/capsule/confidence.ts`, `src/capsule/formatter.ts`

**Problem:** HIGH confidence on wrong answers in 8/8 reviews (avg score 3.8/10). Three escape hatches in confidence.ts prevent utilization caps from firing.

**Root cause (from code analysis):**

1. `compactButGrounded` escape (confidence.ts, around lines 72-84): when `fileSummaryCount >= 2 && relevantCoverage >= 0.6`, caps are raised from 0.40→0.78 and 0.60→0.82. This condition is easily satisfied, bypassing calibration.

2. `intent !== "narrow" && intent !== "symbol-lookup"` gate (around line 142): narrow queries skip ALL utilization caps. A narrow query returning 320/1800 tokens (18%) can report HIGH.

3. `thinRetrieval` gate (same line): if retrieval metrics look OK, caps are bypassed even at 6% utilization.

4. Text formatter (formatter.ts, around line 95): binary `lowConfidence ? "LOW" : "HIGH"` — no MEDIUM tier. Agents see either LOW or HIGH, nothing in between.

**Changes:**

1. **Delete the entire `compactButGrounded` computation and all branches that reference it.** Find the block that computes `compactButGrounded` (checks `fileSummaryCount`, `relevantCoverage`, `retrievalSurfaceScore` etc.) and delete it. Then find the `if (compactButGrounded)` branch in the caps section and delete it too.

2. **Remove the intent gate.** Find the condition like `if (intent !== "narrow" && intent !== "symbol-lookup" && thinRetrieval)`. Replace it with an unconditional block — apply caps to ALL intents:
   ```typescript
   if (tokenUtilization < 0.30) {
     confidence = Math.min(confidence, 0.40);
   } else if (tokenUtilization < 0.50) {
     confidence = Math.min(confidence, 0.60);
   }
   if (tokenUtilization <= 0.60 || pivotCoverage <= 0.60) {
     confidence = Math.min(confidence, 0.89);
   }
   ```

3. **Make `tokenUtilization` required** in the `ConfidenceParams` interface — remove the `?` optional marker. Update all callers to pass it (search for `computeCoverageConfidence` calls).

4. **Add MEDIUM tier to text formatter.** Find the binary confidence label assignment and replace with:
   ```typescript
   const confidenceLabel = confidence < 0.45 ? "LOW" : confidence < 0.75 ? "MEDIUM" : "HIGH";
   ```

**Tests to add** (in `tests/unit/confidence-calibration.test.ts`):
- `tokenUtilization: 0.18, intent: "narrow"` → confidence must be <= 0.40 (LOW)
- `tokenUtilization: 0.14, intent: "broad"` → confidence must be <= 0.40 (LOW)
- `tokenUtilization: 0.45, pivotCoverage: 0.80` → confidence must be <= 0.60 (MEDIUM)
- `tokenUtilization: 0.80, pivotCoverage: 0.65` → confidence may be >= 0.75 (HIGH)
- Verify `compactButGrounded` no longer exists in the code (grep for it)

**Field evidence this fixes:** Kuvio showToast (HIGH at 89% utilization but wrong answer), EBPS "error handling patterns" (HIGH at 75% but zero relevant code), t3code "state management" (HIGH at 100% but test state objects), lawn "error handling" (HIGH at 86% but handleTimestampClick), Nudgy gap notification (HIGH but missed trigger and listener).

---

## Fix 2: Budget Filling — Fix Upstream Pipeline Bottleneck

**Files:** `src/capsule/generator.ts`, `src/capsule/packer.ts`

**Problem:** 14-33% utilization on 8K budgets in 8/8 reviews (avg 3.8/10). The packer's budget-filling loop works correctly. The problem is upstream — the packer receives too few candidates.

**Root cause (from code analysis):**

1. Generator refill target is 0.70 (around line 1734), not 0.85 as CODEX_HANDOFF specified.
2. BFS hardCap limits broad queries to ~72 candidates (around line 1494).
3. Stage-B filtering goes from ~120 candidates to ~20, too aggressively.

**Changes:**

1. **Raise refill target from 0.70 to 0.85.** Find the constant like `BROAD_TASK_TARGET_UTILIZATION` (should be around 0.7) and change to 0.85.

2. **Add second expansion pass.** After the refill loop, check utilization. If `utilization < 0.50 AND tokenBudget >= 4000`:
   - Double the hardCap for this query (find the hardCap assignment for broad/task and multiply by 2)
   - Re-run the BFS/hybrid search with relaxed thresholds (lower lexical score minimum by 30%)
   - Re-pack with the expanded candidate pool

3. **Story-complete fallback.** When utilization < 0.40 after all passes: instead of spreading across 10+ files at skeleton, select top 3-5 files by relevance score and show them at full/summary compression. The system already detects `packing_scatter` — wire that detection to trigger story-complete mode.

4. **Packer deep-fill.** In packer.ts, after the promotion pass: when utilization < 0.50, for each file already at L0/L1 compression, fetch ALL remaining symbols from that file (via DB query) and add them at L2/L3 until budget is filled. This ensures depth over breadth.

**Tests:**
- 8K budget broad query must return >= 4000 tokens (50% minimum)
- When `packing_scatter` is detected, output should have <= 5 files (not 10+)

**Depends on:** Fix 3 (noise filtering must be in place first, or backfill adds more noise).

---

## Fix 3: Noise Elimination — Per-Symbol Relevance Filtering

**File:** `src/capsule/generator.ts`

**Problem:** 25-70% of capsule tokens are irrelevant in 8/8 reviews. The exact-name boost (CODEX_HANDOFF 0.1) works — definitions rank #1. But the REST of the budget is filled with noise from `backfillWithinSelectedFiles`.

**Root cause (from code analysis):**

The `backfillWithinSelectedFiles` function (around lines 1346-1409) adds ALL symbols from selected files at distance <= 2. Scoring is `lexicalScore * 1.5 + centrality * 4 + 0.25`. High-centrality irrelevant symbols (e.g., `VerificationResult` with 99 lines and many edges) outscore relevant but less-central ones.

This is why:
- `LandingHowItWorks` appears in showToast queries (same file imports showToast)
- `VerificationResult` appears in EVERY EBPS capsule (high centrality hub)
- `AdminSettingsPage` (218 lines) appears in state management queries
- `checksums` appears in risk management queries (word "checks" matched)

**Changes:**

1. **Add query-relevance gate to backfill.** In the backfill function, before adding each symbol:
   ```typescript
   const queryTerms = decomposedQuery.terms; // already available in scope
   const symbolTokens = tokenizeSymbolName(candidate.name); // split camelCase/snake_case
   const queryOverlap = queryTerms.filter(t => symbolTokens.some(s => s.toLowerCase().includes(t.toLowerCase()))).length / queryTerms.length;
   const hasDirectEdgeToPivot = pivotIds.has(candidate.id) || edges.some(e => pivotIds.has(e.targetId) || pivotIds.has(e.sourceId));

   if (queryOverlap === 0 && !hasDirectEdgeToPivot) continue; // SKIP — no relevance
   ```

2. **Reweight scoring formula.** Change from:
   ```
   lexicalScore * 1.5 + centrality * 4 + 0.25
   ```
   To:
   ```
   queryOverlap * 6 + lexicalScore * 1.5 + centrality * 2 + 0.25
   ```
   This makes query relevance the dominant signal instead of centrality.

3. **Relevance floor.** After scoring, apply:
   ```typescript
   if (queryOverlap === 0 && !hasDirectEdgeToPivot) score *= 0.5;
   ```

4. **Test-file penalty.** When `mode === "review"` or `mode === "feature"`:
   ```typescript
   if (/\b(test|spec|mock|fixture|__tests__|__mocks__)\b/i.test(candidate.filePath)) score *= 0.3;
   ```

**Tests:**
- Query "showToast" on a codebase where `LandingHowItWorks` is in a file that imports showToast → `LandingHowItWorks` must NOT appear in capsule
- Query "risk management" → `checksums`, `isRecord` must NOT appear
- Query "SmartExtractor" in review mode → test fake classes (`_FakeRow`, `_FakeRows`) must NOT appear while SmartExtractor is truncated

---

## Fix 4: Flow Tracing — JSX Callbacks + Path Diversity + Incoming

**Files:** `src/core/parser.ts`, `src/mcp/tools/flow.ts`, `src/core/weighted-bfs.ts`

**Problem:** cw_flow non-functional in 8/8 reviews (avg 3.4/10). Returns "No outgoing flows found" for 4/8, traces into irrelevant code for 3/8.

**Root cause (from code analysis):**

The flow traversal itself works correctly — it follows all edge kinds. The failure is in edge creation:
- JSX prop callbacks (`onClick={handleClick}`) do NOT create edges. The parser only detects callbacks in regular call expression arguments, not JSX attributes.
- BFS weight table in `weighted-bfs.ts` is missing `callback`, `server-action`, `route-handler` entries.
- Path diversity: DFS/BFS returns first N paths, all through one branch.
- No incoming flow support.

**Changes:**

1. **JSX prop callback edges** (parser.ts): Find where JSX attributes are processed (look for `jsx_attribute` or `jsx_expression` node handling). When the attribute value is an identifier that matches a known symbol name in the file's symbol table, create a `callback` edge:
   ```typescript
   // Pattern: <Component onClick={handleClick} />
   if (node.type === 'jsx_attribute' && valueNode?.type === 'identifier') {
     const symbolName = valueNode.text;
     // resolve symbolName to a symbol in current file or imports
     // if found, create edge: { kind: 'callback', sourceId: currentFunction, targetId: resolvedSymbol }
   }
   ```

2. **"use server" detection** (parser.ts): When extracting function symbols, check if the function body starts with `'use server'` string literal. If so, tag the symbol and create `server-action` edges from any file that imports this function.

3. **BFS weight table** (weighted-bfs.ts): Find the `EDGE_WEIGHTS` map/object and add:
   ```typescript
   callback: 0.7,
   'server-action': 0.7,
   'route-handler': 0.7,
   ```

4. **Path diversity** (flow.ts): After collecting all paths from BFS, group by first-hop target symbol. Ensure each distinct first-hop callee gets at least 1-2 paths before any single branch gets more than 3. Implement as a round-robin selection from the grouped paths.

5. **Incoming flows** (flow.ts): Add `direction` parameter to the flow tool schema (`"incoming" | "outgoing" | "both"`, default `"outgoing"`). For `"incoming"`, query edges where `target_symbol_id = ?` instead of `source_symbol_id = ?`. For `"both"`, merge results from both queries.

**Tests:**
- Create a test TSX file with `<form onSubmit={handleSubmit}>` where `handleSubmit` is defined in the same file → verify callback edge is created
- `cw_flow("_run_single_client")` on EBPS → should show paths through extraction, download, verify, AND report branches (not all through extraction)
- `cw_flow("estimate_frontage", { direction: "incoming" })` → should find `_verify_parking` as a caller

---

## Fix 5: Follow-up Suggestions — Query-Aware in All Paths

**File:** `src/capsule/formatter.ts`

**Problem:** Suggestions irrelevant in 7/8 reviews (avg 3.4/10).

**Root cause:** Two issues:
1. `buildStructuredOutput` (around lines 355-363) sorts follow-ups by `node.score` only — NO query-awareness
2. Candidates come from the already-noisy packed symbol set, so irrelevant high-centrality symbols compete

**Changes:**

1. **Unify scoring.** In `buildStructuredOutput`, replace the `suggestedReads` sorting with the same `uncoveredHits` + query-relevance logic already used in the text path (around lines 183-200). Copy the scoring function, don't maintain two implementations.

2. **Relevance floor.** Only include follow-up symbols where at least ONE of:
   - Symbol name has lexical overlap with a query term
   - Symbol has a direct edge to/from a pivot symbol
   Otherwise exclude it entirely.

3. **Cap at 5 suggestions.** Fewer, more relevant suggestions are better.

**Depends on:** Fix 3 (cleaner candidate pool feeds better suggestions).

---

## Fix 6: Honest Stats

**File:** `src/mcp/tools/stats.ts`

**Problem:** Claims 69.6% savings average; measured ~0% quality-adjusted across 8 reviews.

**Root cause:** Baseline estimate uses `sum(file_sizes) / 4`, assuming full-file reads. Real grep+read is targeted — developers read 20-50 lines per file, not whole files.

**Changes:**

1. Replace baseline formula with: `uniqueFilesReferenced * averageSymbolTokens * symbolsPerFile * 0.3`
2. Add `budgetUtilization` metric: `avg(tokensUsed / tokenBudget)` across all capsule log entries
3. Remove "% reduction" headline number entirely
4. Report instead: `"Tokens used: X | Budget utilization: Y% | Capsules issued: Z | Avg tokens/capsule: W"`
5. If a savings estimate is shown, add disclaimer: `"(estimated vs targeted grep+read — actual savings vary)"`

---

## Fix 7: Index Pollution Auto-Exclusion

**Files:** `src/core/indexer.ts`, `src/utils/directory-weights.ts`

**Problem:** .claude/worktrees/, .qa-temp-*, legacy dirs cause 40-88% token waste (Nudgy: -88%, CW-Self: -56%).

**Changes:**

1. Add to default exclusion patterns in the indexer's file discovery:
   ```
   .claude/worktrees/**
   .qa-temp-*/**
   ```

2. Git worktree detection: when scanning directories, if a `.git` file (not directory) exists and contains `gitdir:`, skip that directory tree — it's a worktree.

3. Content-hash dedup: after indexing, if two files have identical SHA-256 content hashes, keep only the one with the shorter/canonical path. Delete the duplicate's symbols and edges.

4. Pollution warning: in `cw_status` output, if > 50% of indexed symbols come from directories outside `src/`, `lib/`, `app/`, `packages/`, emit: `"Warning: X% of symbols are from non-source directories. Consider adding exclusions to .cwignore."`

---

## Fix 8: Primary Target Protection

**File:** `src/capsule/packer.ts`

**Problem:** Primary target (relevance 0.99-1.0) compressed to skeleton/summary while noise gets full source (Kuvio: showToast compressed, VariationProjectsPage 80 lines full; EBPS: SmartExtractor truncated "256 more lines", test fakes shown full).

**Change:** Before general packing, find the highest-relevance symbol. If its relevance >= 0.90, reserve budget for it:
```typescript
const reserved = Math.min(tokenBudget * 0.4, estimateTokens(primarySymbol.fullSource));
// Pack primarySymbol at L0 (full) first
// Then pack remaining symbols with (tokenBudget - reserved)
```

---

## Fix 9: Symbol Not Found Signal

**File:** `src/capsule/generator.ts`

**Problem:** Query for nonexistent `scoreCandidates` returned 3194 tokens of adjacent results with no warning (CW self-review). Actively harmful — user assumes the answer is about their query.

**Change:** After pivot resolution, check if any resolved pivot's `name` exactly matches the query string (case-insensitive). If not, AND the query looks like a single symbol name (matches `/^[a-zA-Z_]\w*$/`):
- Set `metadata.symbolNotFound = true`
- Prepend to capsule text: `"Note: No symbol named 'scoreCandidates' found in the index. Showing related symbols."`
- Set confidence to LOW unconditionally

---

## Fix 10: Impact File-vs-Symbol Conflation

**File:** Wherever `cw_impact` depth-2+ traversal lives (likely `src/mcp/tools/impact.ts` or similar)

**Problem:** At depth 2+, returns symbols that share a file with a depth-1 dependent but have no actual dependency on the target. Example: `cw_impact("evaluateRisk")` at depth 2 returns `readArrayTopPrice` and `deriveQuoteFromEvent` — these are in `runner.ts` which imports `evaluateRisk`, but these specific symbols never reference it.

**Change:** When traversing from depth N to depth N+1:
- Current (broken): find all symbols in files that contain depth-N dependents
- Fixed: only follow edges WHERE the source symbol IS a depth-N dependent, not just any symbol in the same file

Concretely: at each depth, the traversal should query edges by `source_symbol_id IN (depth_N_symbol_ids)`, NOT by `file_id IN (depth_N_file_ids)`.

---

## Validation Checklist

After all fixes, verify ALL of these:

```
[ ] npm run build — compiles without errors
[ ] npm test — all existing tests pass plus new tests
[ ] Confidence never HIGH when tokenUtilization < 0.30 (must be LOW)
[ ] Confidence never HIGH when tokenUtilization < 0.50 (must be MEDIUM or LOW)
[ ] Text output shows LOW/MEDIUM/HIGH (not binary LOW/HIGH)
[ ] MEDIUM confidence tier exists and is used (grep for it in test output)
[ ] 8K budget queries return >= 4000 tokens (50%+ utilization)
[ ] packing_scatter detection triggers story-complete mode (3-5 files, not 10+)
[ ] backfillWithinSelectedFiles skips symbols with zero query relevance
[ ] Test/spec/mock files get 0.3x scoring penalty in review/feature mode
[ ] Noise in capsules < 20% of budget (test with known-noisy queries)
[ ] cw_flow traces JSX prop callbacks (test with onClick={handler})
[ ] cw_flow shows paths through multiple branches (not all through one)
[ ] cw_flow supports direction: "incoming"
[ ] Follow-up suggestions have query-term overlap (both text and structured paths)
[ ] cw_stats does not claim >50% savings on any session
[ ] .claude/worktrees/ auto-excluded from index
[ ] .qa-temp-* auto-excluded from index
[ ] Git worktrees (`.git` file with `gitdir:`) auto-excluded
[ ] Primary target at relevance >= 0.90 shown at full compression before noise
[ ] Nonexistent symbol query includes "not found" warning and LOW confidence
[ ] cw_impact depth-2+ follows symbol-level edges, not file-level
[ ] No regressions in existing test suite
```

---

## Target Metrics for Next Review Cycle

| Metric | Current (8 reviews) | Target | How to Verify |
|--------|---------------------|--------|---------------|
| Narrow precision | 7.8/10 | 9.0/10 | Definition #1, <20% noise around it |
| Broad recall | 3.4/10 | 6.0/10 | >60% of critical files found in capsule |
| Budget utilization | 3.8/10 | 6.0/10 | >50% utilization on 8K budgets |
| Confidence calibration | 3.8/10 | 7.0/10 | No HIGH on <50% utilization; MEDIUM used |
| Flow tracing | 3.4/10 | 5.0/10 | Direct calls + JSX callbacks traced; diverse paths |
| Follow-up quality | 3.4/10 | 6.0/10 | >50% of suggestions relevant to query |
| Token savings | ~0% quality-adj | >30% | Measured across 3+ tasks with complete answers |
| Would replace Grep+Explore? | 0Y/3P/5N | 3Y/4P/1N | Reviewer verdict after re-review |

---

## Conventions

- TypeScript ESM (`import`/`export`, no CommonJS)
- `const` over `let`, `async/await` over `.then()`, named imports, never use `any`
- No code comments unless logic is genuinely non-obvious
- Conventional commits: `fix(capsule): remove confidence escape hatches`, `fix(capsule): add per-symbol relevance filtering to backfill`
- Tests use vitest at `tests/<module>/<name>.test.ts`
- DB migrations in `src/db/migrations.ts` with incrementing version numbers
- Run tests: `npm test`
- Run build: `npm run build`
- Run specific test: `npx vitest run tests/path/to/test.test.ts`
