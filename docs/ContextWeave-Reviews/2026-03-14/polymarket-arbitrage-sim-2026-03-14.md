# ContextWeave Field Review: polymarket-arbitrage-sim

**Date:** 2026-03-14
**ContextWeave Version:** 0.1.0

Token accounting note: task totals below use estimated delivered output tokens across every contributing tool call, measured as `ceil(response_chars / 4)`. I did not use `cw_stats` as the primary comparison metric because it only counts capsules and ignores rescue reads/searches.

## Project Profile

| Metric | Value |
|--------|-------|
| Project | `polymarket-arbitrage-sim` |
| Stack | Node.js, TypeScript, `ws`, `axios`, `ethers`, CLI/backtest/simulation tooling |
| Lines of Code | 12,411 |
| Source Files | 111 profiled code files (`cw_status` indexed 112 including `scripts/tunnel.sh`) |
| Symbols Indexed | 845 |
| Languages | TypeScript, Bash |
| Index Time | Already indexed; `.contextweave/contextweave.db` last updated `2026-03-14 15:00:48 +0545` |
| Architecture | Modular event-driven simulation app with live-feed adapters, strategy engine, execution simulator, risk layer, portfolio ledger, recorder/backtest pipelines |
| Key Directories | `src/engine`, `src/execution`, `src/portfolio`, `src/risk`, `src/clients/live`, `src/paper`, `src/backtest`, `src/recorder`, `test/` |

## Task-Based Results

### Task A: Find and understand `simulateExecution`

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 3,428 | 4,057 |
| Tool calls | 5 | 7 |
| Completeness | Complete | Complete |
| Time to correct answer | 2.65s | 0.02s |

**What ContextWeave found:** It got the definition first, summarized the core helper set (`applyLifecycleEvents`, `evaluateRejection`, `simulateSlippageBps`, `simulateFilledQuantity`), and `cw_flow` correctly traced the direct static call to `applyLifecycleEvents`.

**What ContextWeave missed:** `cw_impact` polluted the caller picture with import-only and weird downstream entries like `src/backtest/runner.ts: isRecord`, so I still had to verify real call sites manually.

**Follow-up suggestions useful?** Yes, partially. The capsule’s follow-ups around execution helpers were directionally correct for this exact-symbol query.

**Winner:** Tie

### Task B: Trace the live paper-trading flow from websocket update to simulated execution and ledger update

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 4,380 | 5,305 |
| Tool calls | 6 | 8 |
| Completeness | Complete | Complete |
| Time to correct answer | 2.54s | 0.02s |

**What ContextWeave found:** With manual `cw_grep` + `cw_read`, it recovered the real chain: `feedAdapter.start(...)` in `src/paper/runner.ts`, handler invocation inside `LiveWebSocketFeedAdapter.runCaptureLoop`, then `StrategyEngineImpl.onEvent`, then `simulateExecution`, then `applyFillToLedger` and equity recomputation.

**What ContextWeave missed:** The first-pass capsule was almost useless. It led with `src/strategy/traces.ts`, disabled stubs, and adapter interfaces, not the hot path. `cw_flow(startPaperTrading)` never crossed the callback boundary to `engine.onEvent`. It also overemphasized `PaperExecutionAdapter`, even though the runtime path here only pings that adapter for health and does not use it for actual fills.

**Follow-up suggestions useful?** No. The capsule suggested `trace`, `DisabledLiveExecutionAdapter`, and other side material instead of the real flow files.

**Winner:** Grep+Read

### Task C: Explain how risk controls and stop conditions are enforced across the app

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 3,773 | 2,972 |
| Tool calls | 8 | 8 |
| Completeness | Partial | Complete |
| Time to correct answer | 2.51s | 0.01s |

**What ContextWeave found:** `cw_overview` did at least point me at the right neighborhoods: `src/risk/checks.ts`, `src/risk/killSwitch.ts`, and `src/engine/strategy-engine.ts`. The direct reads then showed the actual checks: intent validity, kill-switch state, max order notional, max event exposure, and max drawdown.

**What ContextWeave missed:** The capsule itself was bad. It surfaced `stop()` methods, stubs, proxy tests, and unrelated backtest errors. It also did not make the key architectural nuance obvious: the kill-switch mutator API exists, but no runtime code in `src/` actually calls `tripKillSwitch`, `pauseKillSwitch`, or `resumeKillSwitch`; only tests do.

**Follow-up suggestions useful?** No. Suggestions like `cw_read(symbol: "stop")` and `cw_read(symbol: "BacktestRuntimeError")` were noise.

**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 11,581
- Total Grep+Read tokens across 3 tasks: 12,334
- Actual savings: 6.1%

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `simulateExecution` | Yes | Nothing |
| `evaluateRisk` | Yes | Nothing |
| `recordDatasetPack` | No | `cw_grep` ranked the import in `src/recorder/cli-record.ts` first, and even surfaced `RecordDatasetPackOptions` before clearly surfacing the function definition |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `state` | High | 966 / 2000 | No. It conflated ledger state, lifecycle state, engine state, and kill-switch state with no narrowing. I would not trust it enough to code against. |
| `config` | High | 1993 / 2000 | No. It returned a large pile of config-adjacent snippets, but not a scoped answer. High confidence here means “many matches,” not “good answer.” |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| Live paper-trading flow query | 8000 | 436 | 5.5% |
| Risk controls / kill-switch query | 8000 | 754 | 9.4% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `simulateExecution -> applyLifecycleEvents` | Yes | No | Static call edge worked exactly once; this is the happy path case |
| `recordDatasetPack` | No | No | `cw_flow` wandered into integrity/manifest parsing instead of the actual preflight -> REST -> WS capture chain |
| `startPaperTrading -> onEvent` | No | No | Could not cross `feedAdapter.start((event) => engine.onEvent(...))`; tool explicitly misses callback-style flows |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `risk controls kill switch exposure drawdown` | 6 | Good directory shortlist, weak narrative value; query-focus summaries are vague and noisy |
| `cw_recall` | `risk controls kill switch` | 1 | Returned one README line about the bot, not a learned project pattern |
| `cw_impact` | `simulateExecution` | 4 | Mixed real consumers with import-only references and bogus transitive noise (`backtest/runner.ts: isRecord`) |
| `cw_stats` | task sessions | 2 | Not honest enough for product claims; it ignores `cw_read`/`cw_grep` rescue cost and therefore dramatically overstates savings |

## Flaws Found

Ordered by severity. Each flaw includes what happened, likely root cause, and how to fix it.

### P0 (Critical — blocks adoption)
1. **Broad/task first-pass capsules are not reliable enough to replace grep**: On the real “trace live paper-trading flow” task, the capsule led with `src/strategy/traces.ts`, disabled stubs, and adapter interfaces instead of `src/paper/runner.ts`, `src/clients/live/ws-feed-adapter.ts`, and `src/engine/strategy-engine.ts`. On the risk-architecture task, it surfaced `stop()` methods and proxy/test noise. Root cause: the runtime itself admits `pivot_flood` and `packing_scatter`, and the packing path in `src/capsule/generator.ts` still spreads low-density symbols across many files instead of assembling one coherent story. Suggested fix: hard-boost entrypoint/runtime anchors, cluster related files before tail references, and fail closed when the hot path files are missing from a “trace flow” or “architecture” answer.
2. **Flow tracing breaks on the kinds of boundaries that matter in app code**: `cw_flow({ source: "startPaperTrading", target: "onEvent" })` returned “No path found,” even though the runtime path is obvious in `feedAdapter.start((event) => engine.onEvent(...))`. Root cause: `src/mcp/tools/flow.ts` explicitly says analysis is “primarily limited to static call expressions” and misses prop callbacks, higher-order functions, and dynamic dispatch. Suggested fix: add callback registration/invocation edges for common patterns (`handler`, event emitters, promise callbacks, adapter hooks) before advertising flow tracing as an end-to-end navigation tool.
3. **`cw_stats` materially overstates token savings**: Task B’s session stats claimed 96% savings and Task C’s claimed 95%, but once I counted the actual rescue calls required to get a correct answer, the real results were 17% savings and negative 27% savings respectively. Root cause: `src/mcp/tools/stats.ts` only counts entries in `capsule_log` and estimates raw cost from included file sizes; it ignores `cw_read`, `cw_grep`, `cw_flow`, `cw_impact`, and all correction loops. Suggested fix: instrument every MCP tool response and report both “capsule-only” and “end-to-end task” token costs.

### P1 (Important — degrades quality)
1. **Follow-up reads are often ambiguous or outright wrong**: The `evaluateOpportunities` task query produced a capsule centered on `recorder/*` noise and suggested `cw_read(symbol: "onError")` three times. That is not a helpful follow-up; it is a trap. Root cause: `src/capsule/formatter.ts` emits bare symbol names for follow-ups, while `src/mcp/tools/read.ts` resolves by fuzzy match + centrality when a symbol is ambiguous. Suggested fix: always emit file-qualified follow-ups like `src/file.ts:SymbolName`, and block ambiguous follow-up generation if qualification is impossible.
2. **Confidence calibration is too generous on vague short queries**: `state` and `config` both came back `Confidence: HIGH` even though the answers were scope-less piles of unrelated snippets. Root cause: `src/capsule/diagnostics.ts` classifies short queries as `narrow`, and `src/capsule/generator.ts` applies the query-term-coverage penalty only to non-narrow intents. A one-word concept query is not “narrow” in the sense users care about. Suggested fix: require exact symbol evidence before granting narrow-query confidence; generic nouns like `state`, `config`, `model`, `flow`, `handler` should default to concept/broad handling.
3. **Exact-string ranking in `cw_grep` does not prioritize definitions**: `cw_grep("recordDatasetPack")` ranked an import in `src/recorder/cli-record.ts` first and did not cleanly surface the function definition as the top result. Root cause: `src/mcp/tools/search.ts` preserves ripgrep hit order and only annotates enclosing symbols; there is no definition-first reranking for exact symbol names. Suggested fix: post-rank exact name hits so definitions of matching symbols outrank imports, tests, and nearby interface names.

### P2 (Moderate — papercut)
1. **Large budgets are barely used even when answers are weak**: The 8k-budget flow query used 436 tokens; the 8k risk query used 754. That is not efficiency, it is under-retrieval. Root cause: the refill logic in `src/capsule/generator.ts` exists, but in practice it is too conservative to recover from thin broad/task answers. Suggested fix: when confidence is low and utilization is below a floor, force a second-stage expansion biased toward coherent neighboring files, not just more candidate symbols.
2. **`cw_impact` mixes real dependents with low-value noise**: For `simulateExecution`, it included real consumers like `StrategyEngineImpl.onEvent` and `PaperExecutionAdapter.execute`, but also junky transitive chains like `src/backtest/runner.ts: isRecord`. Root cause: impact expansion treats imports and loose downstream edges too similarly. Suggested fix: split output into `direct callers`, `importers`, `tests`, and `transitive dependents`, and default-sort by executable call sites.

## What Worked Well

- Exact-symbol capsules can be strong when the query is truly narrow. `simulateExecution` and `evaluateRisk` both surfaced the correct definition first and exposed relevant helper functions.
- `cw_read` is solid. Safe bounded reads by symbol or path were consistently useful once I already knew which file mattered.
- `cw_overview` is decent as a directory-narrowing tool. It helped isolate the risk layer faster than blindly browsing the tree.
- Direct static-call flow tracing does work in the simple case (`simulateExecution -> applyLifecycleEvents`).

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 6 |
| Broad recall (found all relevant files) | 3 |
| Budget utilization (% of budget used) | 1 |
| Confidence calibration (honest scores) | 3 |
| Flow tracing (traces real call chains) | 2 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 2 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

- **Broad/task capsule failure**
  - Query: `Trace the live paper-trading flow from a websocket market update through startPaperTrading into the strategy engine, simulated execution, and ledger/equity updates.`
  - Key response: `Tokens: 436/3200`, `Confidence: LOW`, files included `src/strategy/traces.ts`, `src/clients/live/stubs.ts`, adapter interfaces
  - Correct answer should have centered `src/paper/runner.ts`, `src/clients/live/ws-feed-adapter.ts`, `src/engine/strategy-engine.ts`, `src/execution/simulator.ts`

- **Wrong follow-up suggestion**
  - Query: `Find and explain evaluateOpportunities: what it does, who calls it, and what downstream functions it relies on.`
  - Key response: follow-ups were `cw_read(symbol: "onError")` three times
  - Correct answer should have followed `evaluateOpportunities`, `evaluateBaskets`, `rankOpportunities`, and real callers in `src/engine/strategy-engine.ts`

- **Callback flow miss**
  - Query: `cw_flow({ source: "startPaperTrading", target: "onEvent", max_hops: 5 })`
  - Key response: `No path found from "startPaperTrading" to "onEvent" within 5 hops`
  - Correct answer should have recognized `await feedAdapter.start((event) => { engine.onEvent(toReplayEvent(event)); })`

- **Confidence dishonesty**
  - Query: `state`
  - Key response: `Confidence: HIGH | Uncertainty: LOW`, mixed `LedgerState`, lifecycle states, `EngineState`, kill-switch state
  - Correct answer should first ask “which state?” or at least identify multiple competing state domains

- **Savings metric dishonesty**
  - Query/session: Task C risk architecture
  - Key response: `cw_stats` reported `Estimated savings: ~15,284 tokens (95% reduction)`
  - Correct measured answer: full CW workflow cost 3,773 estimated tokens vs 2,972 for grep+read, so CW was actually more expensive

- **Exact symbol ranking miss**
  - Query: `recordDatasetPack`
  - Key response: `cw_grep` result #1 was `src/recorder/cli-record.ts` import; result #2 was `RecordDatasetPackOptions`
  - Correct answer should have definition #1 from `src/recorder/record.ts`
