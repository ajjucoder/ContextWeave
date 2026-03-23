# ContextWeave Field Review: polymarket-arbitrage-sim

**Date:** 2026-03-09
**ContextWeave Version:** (from cw_status: 112 files indexed, 845 symbols, 1108 edges, 44 observations)
**Reviewer Model:** Claude Opus 4.6

## Project Profile

| Metric | Value |
|--------|-------|
| Project | polymarket-arbitrage-sim |
| Stack | TypeScript / Node.js |
| Lines of Code | 12,411 |
| Source Files | 111 (.ts) + 1 (.sh) = 112 |
| Symbols Indexed | 845 |
| Edges | 1,108 |
| Languages | TypeScript (111), Bash (1) |
| Index Time | Pre-indexed (no re-index needed) |
| Architecture | Modular domain-driven: core, strategy, execution, portfolio, risk, simulation, recorder, stats, engine |
| Key Directories | src/ (74 files, 700 symbols), test/ (37 files, 142 symbols) |

## Task-Based Results

### Task A: Find and understand `applyFillToLedger` (narrow — function with callers across 4+ files)

**Phase 1: ContextWeave-First**

| Step | Tool Call | Tokens |
|------|-----------|--------|
| 1 | `cw_capsule({ query: "applyFillToLedger function definition callers fill processing", token_budget: 3000, mode: "review" })` | 2,215 |
| **Total** | | **2,215** |

Returned: definition (portfolio/ledger.ts:129-167), LedgerFill interface, updatePositionWithFill helper, plus execution/simulator.ts simulateExecution, execution/models.ts (isPriceOnTick, simulateFilledQuantity, simulateSlippageBps), and engine/strategy-engine.ts onEvent (truncated).

**Phase 2: Grep+Read Baseline**

| Step | Tool Call | Tokens (est.) |
|------|-----------|---------------|
| 1 | `Grep("applyFillToLedger")` — 12 result lines | ~500 |
| 2 | `Read(portfolio/ledger.ts, lines 1-170)` — definition + context | ~700 |
| **Total** | | **~1,200** |

Found: exact definition, ALL callers (strategy-engine.ts:465, backtest/runner.ts import, test/portfolio/ledger.test.ts, test/analytics/run-report.test.ts), supporting types, and full context.

**Phase 3: Comparison**

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 2,215 | ~1,200 |
| Tool calls | 1 | 2 |
| Completeness | Partial | Complete |
| Time to correct answer | Slower (noise to parse) | Faster (direct) |

**What ContextWeave found:** Definition, LedgerFill interface, updatePositionWithFill. Also pulled in onEvent (a caller, shown but truncated).

**What ContextWeave missed:** Explicit caller enumeration. Grep instantly showed all 4 call sites. CW showed onEvent but didn't surface the backtest/runner.ts caller or test callers.

**Noise introduced:** 3 symbols from execution/models.ts (isPriceOnTick, simulateFilledQuantity, simulateSlippageBps) — not related to applyFillToLedger. These consumed ~600 tokens (~27% of budget) for zero value.

**Follow-up suggestions useful?** No suggestions were offered (suggestedReads was empty).

**Winner: Grep+Read** — half the tokens, complete caller enumeration, no noise.

---

### Task B: Trace end-to-end flow from WS event through quote book to execution and ledger (broad — crosses 5+ files)

**Phase 1: ContextWeave-First**

| Step | Tool Call | Tokens |
|------|-----------|--------|
| 1 | `cw_capsule({ query: "end-to-end flow from WebSocket event through quote book update to opportunity evaluation execution and ledger update", token_budget: 4000, mode: "review" })` | 391 |
| **Total** | | **391** |

Returned: toReplayEvent (recorder/record.ts:105-141) and onEnd (recorder/proxy-agent.ts:155-158). Two symbols across 2 files. 6% pivot coverage. Confidence: LOW. Uncertainty: HIGH.

**Phase 2: Grep+Read Baseline**

| Step | Tool Call | Tokens (est.) |
|------|-----------|---------------|
| 1 | `Grep("evaluateOpportunities\|deriveQuoteFromEvent\|simulateExecution\|applyFillToLedger")` — 36 result lines | ~1,500 |
| 2 | `Read(strategy-engine.ts, lines 336-527)` — onEvent method | ~800 |
| **Total** | | **~2,300** |

Found: Complete flow chain — `onEvent` receives `ReplayEvent` → `deriveQuoteFromEvent` → `quoteBook.set` → `evaluateOpportunities` → `evaluateRisk` → `simulateExecution` → `applyFillToLedger`. All in strategy-engine.ts with imports from strategy/, execution/, portfolio/, risk/.

**Phase 3: Comparison**

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 391 | ~2,300 |
| Tool calls | 1 | 2 |
| Completeness | **Failed** | Complete |
| Time to correct answer | N/A (wrong answer) | Fast (2 calls) |

**What ContextWeave found:** A recording helper (toReplayEvent) and a proxy cleanup handler (onEnd). Neither is part of the actual event processing flow.

**What ContextWeave missed:** The entire flow. strategy-engine.ts, strategy/index.ts, execution/simulator.ts, portfolio/ledger.ts, risk/checks.ts — none surfaced.

**Root cause:** The query describes a conceptual flow using natural language ("WebSocket event through quote book..."). ContextWeave's retrieval matched keywords like "WebSocket" and "event" to recorder/ws.ts and recorder/record.ts, which handle raw WS capture — not the strategy engine's event processing pipeline. The tool lacks semantic understanding of data flow and relies on keyword/embedding matching.

**Winner: Grep+Read** — decisive. CW returned the wrong answer entirely.

---

### Task C: How does risk management work across the codebase? (architectural — spans multiple modules)

**Phase 1: ContextWeave-First**

| Step | Tool Call | Tokens |
|------|-----------|--------|
| 1 | `cw_capsule({ query: "risk management system evaluateRisk risk checks kill switch risk controls", token_budget: 4000, mode: "review" })` | 1,220 |
| **Total** | | **1,220** |

Returned: evaluateRisk (risk/checks.ts:31-86), validateRiskLimits, intentNotional, all killSwitch functions (create/isActive/trip/pause/resume from risk/killSwitch.ts). Also: recorder/record.ts checksums, isRecord, isBookLikeEvent, and recorder/checksums.ts buildChecksumsSha256.

**Phase 2: Grep+Read Baseline**

| Step | Tool Call | Tokens (est.) |
|------|-----------|---------------|
| 1 | `Grep("evaluateRisk\|RiskLimits\|RiskSnapshot\|RiskDecision\|KillSwitch")` — 50 result lines | ~2,000 |
| 2 | `Read(types/risk.ts)` — type definitions (~40 lines) | ~200 |
| 3 | `Read(risk/checks.ts)` — implementation (~90 lines) | ~400 |
| **Total** | | **~2,600** |

Found: All type definitions (RiskLimits, RiskSnapshot, RiskDecision, KillSwitchState, KillSwitchSnapshot in types/risk.ts), implementations in risk/checks.ts and risk/killSwitch.ts, integration in strategy-engine.ts (lines 270, 286, 325, 403) and backtest/runner.ts (DEFAULT_RISK_LIMITS), plus test file.

**Phase 3: Comparison**

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 1,220 | ~2,600 |
| Tool calls | 1 | 3 |
| Completeness | Partial | Complete |
| Time to correct answer | Faster but incomplete | Slower but complete |

**What ContextWeave found:** Core implementations of evaluateRisk and killSwitch FSM. This is the heart of risk management.

**What ContextWeave missed:** (1) Type definitions from types/risk.ts (RiskLimits, RiskSnapshot, RiskDecision interfaces). (2) Integration points showing how risk plugs into the strategy engine and backtest runner. (3) DEFAULT_RISK_LIMITS configuration.

**Noise:** recorder/record.ts and recorder/checksums.ts symbols consumed ~300 tokens (~25% of capsule) with zero relevance to risk management. The word "checks" in "risk checks" may have matched "checksums."

**Confidence reported: HIGH. Earned? No.** The answer was incomplete — missing types and integration context. You would NOT write code based solely on this capsule. Confidence should have been MEDIUM.

**Winner: Grep+Read** — more expensive but complete with types, integration points, and configuration.

---

### Overall Token Comparison

| | ContextWeave | Grep+Read |
|---|---|---|
| Task A | 2,215 | ~1,200 |
| Task B | 391 | ~2,300 |
| Task C | 1,220 | ~2,600 |
| **Total** | **3,826** | **~6,100** |
| **Actual savings** | **37%** | |
| **Completeness** | 0/3 Complete, 2/3 Partial, 1/3 Failed | 3/3 Complete |

**The 37% token savings came at the cost of incomplete or wrong answers in all 3 tasks.** When adjusted for quality (i.e., the additional tokens needed to complete each CW answer), the real savings would be near zero or negative.

## Stress Test Results

### 2A: Exact Symbol Ranking

| Symbol | Definition at #1? | What outranked it? | Notes |
|--------|------------------|--------------------|-------|
| `simulateExecution` | **Yes** (execution/simulator.ts:24, relevance 1.0) | N/A | Also showed callers (PaperExecutionAdapter, onEvent). Excellent. |
| `evaluateOpportunities` | **Yes** (strategy/index.ts:18, relevance 1.0) | N/A | Showed full call chain (groupOutcomesByEvent → evaluateBaskets → rankOpportunities). Excellent. |
| `deriveQuoteFromEvent` | **Yes** (backtest/runner.ts:227, relevance 1.0) | N/A | Showed BOTH copies (runner.ts + strategy-engine.ts). Good dedup awareness. |

**Verdict:** Symbol lookup is ContextWeave's strongest capability. Definition always #1, supporting context well-chosen.

### 2B: Confidence Honesty

| Query | Reported Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| "data processing pipeline patterns" | **HIGH** | 1,987/2,000 (99%) | **No** — returned 20 symbols across 10 files including proxy tunnel code, stats rendering, dataset resolution. Scattershot, not a coherent pipeline overview. HIGH confidence implies "trust this and write code" — you cannot. |
| "error handling patterns across the application" | **LOW** | 1,997/2,000 (100%) | **Partially honest** — found all 6 custom error classes (ConfigError, BacktestRuntimeError, WsClientError, RestClientError, RecorderCliError, StatsCliError). This is actually a decent answer. LOW was too conservative; MEDIUM would have been accurate. |

**Verdict:** Confidence is miscalibrated in both directions. Broad conceptual queries get inflated confidence (HIGH when scattered). Pattern-finding queries get deflated confidence (LOW when actually useful). The confidence score does not reliably predict answer quality.

### 2C: Budget Utilization

| Query | Budget | Used | Utilization | Assessment |
|-------|--------|------|-------------|------------|
| "how does the strategy engine process events" | 8,000 | 6,400 | **80%** | Good. Returned 63 symbols across 21 files — comprehensive. |
| "backtest runner configuration and execution flow" | 8,000 | 2,642 | **33%** | Poor. Multi-pass (4 sub-queries) aggressively filtered from 120 stage-A candidates to 20 stage-B. 5,358 tokens of budget unused despite 36% pivot coverage. |

**Verdict:** Budget utilization is inconsistent. Single-pass symbol queries use 86-99% of budget. Multi-pass broad queries often use <40%. The multi-pass filtering is too aggressive when it encounters many candidate pivots.

### 2D: Flow Tracing

| Function | Direct call traced? | Callback/event traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `applyFillToLedger` | **Outgoing only** — traced to mustBePositive, updatePositionWithFill → deriveRealizedFromClose, normalizeZero | N/A | Cannot trace INCOMING flows (who calls applyFillToLedger). No reverse flow support. |
| `evaluateRisk` | **Outgoing yes** — validateRiskLimits, intentNotional, signedNotional, then into type imports | N/A | Correct but shallow — follows imports not runtime calls. |
| `onEvent` | **Partial** — traced import edge to simulateExecution → lifecycle/types | **No** | Only traced simulateExecution via import edge. MISSED: deriveQuoteFromEvent, evaluateOpportunities, evaluateRisk, applyFillToLedger — all called within onEvent's body but not via top-level imports. Flow tracing follows import graph edges, NOT intra-function call chains. |

**Root cause:** `cw_flow` is built on the static import/export edge graph. It can trace `A imports B` and `B imports C`. It cannot trace "function A calls function B on line 437" when both are already imported at the module level. This makes it blind to the most important flows — the ones inside function bodies.

### 2E: Supporting Tools

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | "risk management architecture" | **7** | Good directory summary and focused file matches. Correctly identified risk/checks.ts, risk/killSwitch.ts, types/risk.ts, strategy-engine.ts, backtest/runner.ts. Useful for orientation. |
| `cw_recall` | "architecture decisions risk strategy" | **2** | Returned 1 result: a README snippet. 44 observations exist in the index but none surfaced for this relevant query. Memory is either poorly populated or BM25 search doesn't match architectural concepts. |
| `cw_impact("evaluateRisk")` | N/A | **4** | Depth 1 correct: found StrategyEngineImpl.onEvent, test file, backtest/runner.ts. Depth 2-3 wrong: showed readArrayTopPrice, readTopSize, deriveQuoteFromEvent — these are in runner.ts but have ZERO dependency on evaluateRisk. Impact conflates file-level imports with symbol-level dependencies. |
| `cw_impact("applyFillToLedger")` | N/A | **4** | Same problem. Depth 1 found real dependents (onEvent, test files, runner.ts). Depth 2-3 returned unrelated symbols from the same files. |
| `cw_stats` | N/A | **6** | Reports 64% token reduction (20,245 vs 56,985 estimated). The estimated grep+read cost is self-calculated and likely inflated — my actual grep+read for 3 tasks was ~6,100 tokens, not the ~17,000+ that CW's estimate would imply. Metrics are useful but the savings claim needs calibration against real-world usage. |

## Flaws Found

### P0 (Critical -- blocks adoption)

1. **Flow/pipeline queries fail catastrophically:** Task B ("end-to-end flow from WebSocket event through...") returned 6% pivot coverage, completely wrong files (recorder instead of engine), and only 391/4000 tokens used. Natural language descriptions of data flow do not retrieve the correct symbols. **Root cause:** Retrieval is keyword/embedding-based and matches surface terms ("WebSocket," "event") to files that contain those words literally (recorder/ws.ts, recorder/record.ts) rather than understanding which functions participate in the described pipeline. **Fix:** Add a dedicated flow-query mode that (1) identifies named entry points in the query, (2) uses the call graph to trace forward/backward from those entry points, and (3) returns the chain rather than keyword-matched symbols.

### P1 (Important -- degrades quality)

1. **Impact analysis conflates file-level imports with symbol-level dependencies:** `cw_impact("evaluateRisk")` at depth 2+ returns `readArrayTopPrice`, `readTopSize`, `deriveQuoteFromEvent` from backtest/runner.ts. These symbols have no dependency on `evaluateRisk` — they merely exist in the same file that imports `evaluateRisk`. **Root cause:** The edge graph tracks file-to-file import relationships. At depth > 1, it follows edges from the file rather than from the specific symbol. **Fix:** Impact traversal should only follow edges where the source symbol is actually referenced by the dependent symbol, not just co-located in the same file.

2. **Flow tracing follows import edges, not intra-function call chains:** `cw_flow("onEvent")` traces to `simulateExecution` (via import) but misses `deriveQuoteFromEvent`, `evaluateOpportunities`, `evaluateRisk`, `applyFillToLedger` — all called within onEvent's body. **Root cause:** The AST parser extracts import/export edges and direct symbol references but does not build a call graph from function body analysis. **Fix:** During indexing, parse function bodies for call expressions and create `[call]` edges to resolved symbols. This is the highest-value improvement possible — it would fix flow tracing, impact analysis, and capsule relevance for callers/callees.

3. **Noise in capsules — irrelevant symbols consume 25-30% of budget:** Task A included 3 execution model functions unrelated to ledger fills. Task C included recorder checksums/isRecord when querying risk management. **Root cause:** Relevance scoring gives non-zero weight to symbols that share broad semantic similarity (e.g., "checks" matches both "risk checks" and "checksums"). The filtering threshold is too low. **Fix:** Apply a minimum relevance threshold (e.g., drop symbols below 10% of top-ranked relevance) or use a second-pass re-ranker that verifies semantic connection to the query after initial retrieval.

4. **Confidence miscalibration on broad queries:** "data processing pipeline patterns" reported HIGH confidence with scattered, incoherent results. Task C risk query reported HIGH but missed type definitions and integration points. **Root cause:** Confidence appears to be computed from retrieval-stage metrics (pivot coverage %, dependency resolution) rather than from answer coherence or query-type difficulty. Broad/conceptual queries inherently have lower answer quality but can still hit high pivot coverage. **Fix:** Discount confidence for queries classified as "broad" or "task" intent. Factor in the ratio of noise-to-signal in the final capsule.

### P2 (Moderate -- papercut)

1. **Budget underutilization on multi-pass queries:** "backtest runner configuration" used 33% of 8000 budget. "end-to-end flow" used 10% of 4000 budget. Multi-pass strategy filters too aggressively. **Root cause:** Stage-B filtering (120 → 20 candidates for backtest query) discards too many pivots. **Fix:** When budget utilization is below 50% and pivot coverage is below 50%, dynamically relax the stage-B filter or fall back to single-pass.

2. **cw_recall returns almost nothing despite 44 stored observations:** `cw_recall("architecture decisions risk strategy")` returned 1 result (README snippet). Observations exist but don't surface. **Root cause:** BM25 search on observation text doesn't match conceptual queries well. Most observations appear to be auto-generated from docs, not architectural insights. **Fix:** Improve observation quality (prefer user-stored or capsule-derived insights over doc scrapes) and consider embedding-based recall in addition to BM25.

3. **Duplicate function bodies shown without deduplication note:** `deriveQuoteFromEvent` exists identically in both `backtest/runner.ts` and `engine/strategy-engine.ts`. The capsule showed both full copies consuming ~700 extra tokens. **Root cause:** No content-hash deduplication across symbols. **Fix:** When two symbols have identical or near-identical bodies, show the first in full and note "identical copy at [other location]" for subsequent ones.

4. **cw_stats overestimates grep+read baseline cost:** Reports 64% savings (20,245 vs estimated 56,985 tokens). My actual grep+read cost for 3 equivalent tasks was ~6,100 tokens. The 56,985 estimate is ~9x higher than reality. **Root cause:** The estimator likely assumes reading entire files rather than targeted grep+read of specific line ranges. **Fix:** Calibrate the baseline estimate against actual measured grep+read token usage from real sessions.

## What Worked Well

1. **Exact symbol lookup is excellent.** All 3 test symbols had definitions ranked #1. Budget utilization was 86-99% for symbol queries. This is genuinely better than grep for understanding a single function's signature, body, and immediate context.

2. **Multi-level compression is well-designed.** The full/summary/skeleton/reference compression levels are smart. Key symbols get full source, supporting symbols get signatures, distant references get one-liners. This is good information density engineering.

3. **Follow-up read suggestions are accurate.** When symbols are compressed, the suggested `cw_read` calls point to the right symbols with line counts. The scoring makes sense.

4. **Error handling pattern discovery worked despite LOW confidence.** Found all 6 custom error classes across 6 modules. For "what error classes exist?" this is actually the right answer. The tool is underconfident here.

5. **cw_overview provides useful project orientation.** Directory summary with symbol counts, focused query matches, top files by complexity — this is a genuinely useful starting tool for unfamiliar codebases.

6. **Deduplication awareness.** The `deriveQuoteFromEvent` capsule correctly showed both copies, making the code duplication visible. (Though it should have deduped them — see P2 flaw #3.)

## Scorecard

| Metric | Score (1-10) | Notes |
|--------|-------------|-------|
| Narrow precision (right symbol, right rank) | **8** | Definitions always #1. Callers incomplete but present. |
| Broad recall (found all relevant files) | **3** | Task B catastrophic failure. Task C missed types/integration. |
| Budget utilization (% of budget used) | **5** | Great for symbol queries (86-99%), terrible for broad (10-33%). |
| Confidence calibration (honest scores) | **4** | HIGH when incomplete, LOW when decent. Not reliable. |
| Flow tracing (traces real call chains) | **3** | Import edges only. Misses intra-function calls entirely. |
| Follow-up quality (suggested reads were useful) | **7** | Accurate pointers to compressed symbols. |
| Token savings vs grep+read (measured, not claimed) | **4** | 37% raw savings but 0/3 tasks fully answered. Net value questionable. |
| **Overall: Would replace Grep+Explore?** | **Partial** | Yes for symbol lookups. No for flow understanding, callers, or architectural questions. |

## Evidence Snippets

### Task B failure (P0 — flow queries)

**Query:** `cw_capsule({ query: "end-to-end flow from WebSocket event through quote book update to opportunity evaluation execution and ledger update", token_budget: 4000, mode: "review" })`

**Response (key parts):**
```
Confidence: LOW | Uncertainty: HIGH
Coverage confidence: 40%
Retrieval: stageA 117 -> stageB 24
Coverage: pivots 2/31 (6%)
Files returned: recorder/record.ts (toReplayEvent), recorder/proxy-agent.ts (onEnd)
```

**Correct answer:** The flow lives in `engine/strategy-engine.ts` → `strategy/index.ts` → `execution/simulator.ts` → `portfolio/ledger.ts` → `risk/checks.ts`. None of these files appeared.

---

### Impact analysis conflation (P1 — file vs symbol dependency)

**Query:** `cw_impact({ target: "evaluateRisk" })`

**Response (key parts):**
```
Depth 1:  (correct)
  import → class StrategyEngineImpl (src/engine/strategy-engine.ts:268)
  import → method StrategyEngineImpl.onEvent (src/engine/strategy-engine.ts:336)
  import → arrow isRecord (src/backtest/runner.ts:128)
Depth 2:  (wrong)
  call → arrow readArrayTopPrice (src/backtest/runner.ts:180)
  call → arrow readTopSize (src/backtest/runner.ts:202)
  call → arrow deriveQuoteFromEvent (src/backtest/runner.ts:227)
```

`readArrayTopPrice`, `readTopSize`, and `deriveQuoteFromEvent` have zero dependency on `evaluateRisk`. They are in `runner.ts` which imports `evaluateRisk`, but these specific symbols never reference it. The depth-2 traversal leaked to unrelated symbols via file-level import edges.

---

### Flow tracing misses intra-function calls (P1)

**Query:** `cw_flow({ source: "onEvent" })`

**Response:** 10 paths, ALL starting with `[import] → function simulateExecution`. Then traces simulateExecution's import tree (Clock, ExecutionResult, OrderIntent, lifecycle, etc.).

**Missing:** `deriveQuoteFromEvent` (called at line 340), `evaluateOpportunities` (called at line 355), `evaluateRisk` (called at line 403), `applyFillToLedger` (called at line 465). These are the 4 most important calls in onEvent and none appear in the flow trace.

---

### Confidence miscalibration (P1)

**Query:** `cw_capsule({ query: "risk management system evaluateRisk risk checks kill switch risk controls", token_budget: 4000 })`

**Response:** Confidence: **HIGH**, Coverage: 60%.

**Missing from "HIGH confidence" answer:** `RiskLimits` interface (types/risk.ts:12), `RiskSnapshot` interface (types/risk.ts:18), `RiskDecision` interface (types/risk.ts:38), integration in strategy-engine.ts:403, DEFAULT_RISK_LIMITS in backtest/runner.ts:63. The answer covers implementation but misses the type contract and integration layer — incomplete for writing code against the risk system.

---

### cw_stats overestimates savings (P2)

**cw_stats response:**
```
Total tokens budgeted: 34,600
Total tokens used:     20,245 (59% of budget)
Estimated savings:     ~36,740 tokens (64% reduction)
grep+read cost (est):  ~56,985 tokens
```

**Actual measured grep+read for 3 equivalent tasks:** ~6,100 tokens (3 Grep calls + 3 targeted Reads). The estimated 56,985 is ~9x higher than measured reality. The 64% savings claim is based on an inflated baseline.
