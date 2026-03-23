# ContextWeave Field Review: Codex Team Orchestrator

**Date:** 2026-03-18
**Reviewer Model:** Claude Opus 4.6 (1M context)
**ContextWeave Version:** (not exposed by cw_status — see P2 flaw #5)

## Project Profile

| Metric | Value |
|--------|-------|
| Project | codex-team-orchestrator |
| Stack | TypeScript (Node.js), SQLite, tmux |
| Lines of Code | 42,906 |
| Source Files | 381 indexed |
| Symbols Indexed | 3,292 |
| Edges | 4,064 |
| Languages | TypeScript (223), Markdown (80), JSON (59), Bash (14), YAML (5) |
| Index Time | Pre-indexed (not measured this session) |
| Architecture | MCP server with tool-based RPC, SQLite store, scheduler/executor runtime, transport abstraction layer |
| Key Directories | mcp/server (759 symbols), mcp/runtime (370 symbols), mcp/store (282 symbols), tests (1338 symbols) |

---

## Task-Based Results

### Task A: Find and understand `dispatch` in the scheduler — a common-name method with cross-file callers

#### Phase 1: ContextWeave

| # | Tool Call | Tokens | Notes |
|---|-----------|--------|-------|
| 1 | `cw_capsule({ query: "dispatch method in scheduler and all its callers and callees", token_budget: 4000, mode: "review" })` | 1,849/4,000 | MEDIUM confidence. **Returned `hooks.ts:dispatch` as relevance 1.0, scheduler.ts as 0.6.** Wrong dispatch ranked first. |
| 2 | `cw_read({ path: "mcp/runtime/scheduler.ts", symbol: "RuntimeScheduler" })` | ~5,000 (429 lines) | Got the full class. This was the right follow-up. |
| 3 | `cw_flow({ source: "dispatch", direction: "both" })` | ~600 | Traced `hooks.ts:dispatch` callers, NOT scheduler dispatch. All incoming paths went through `dispatchHooks -> callTool`. |

- **Total CW tokens:** ~7,449
- **Completeness:** Partial
- **Missing:** executor.ts (the actual caller of `scheduler.tick()`), `dispatchTeam` private method never traced, `createFairTaskQueue` and `rotateAgents` dependencies not surfaced.

**Follow-up suggestions useful?** No. CW suggested reading `ToolHandler` (1-line type alias), `alloc` and `gitShowFile` from git-isolation tests — completely irrelevant to understanding scheduler dispatch.

#### Phase 2: Grep+Read

| # | Tool Call | Tokens | Notes |
|---|-----------|--------|-------|
| 1 | `Grep("dispatch", path: "mcp/runtime/scheduler.ts")` | ~500 | 34 lines showing all dispatch-related code in one view |
| 2 | `Grep("scheduler\\.(tick\|dispatch)", path: "mcp/")` | ~50 | Found `executor.ts:145` calls `scheduler.tick()` — the missing link |
| 3 | `Read("mcp/runtime/executor.ts", offset: 130, limit: 60)` | ~800 | Full execution flow: tick() → dispatches → executeTask |
| 4 | `Grep("createFairTaskQueue\|rotateAgents", path: "mcp/runtime/")` | ~100 | Found queue.ts import and definition |

- **Total Grep+Read tokens:** ~1,450
- **Completeness:** Complete

#### Phase 3: Comparison

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~7,449 | ~1,450 |
| Tool calls | 3 | 4 |
| Completeness | Partial | Complete |
| Time to correct answer | Never reached correct answer (wrong dispatch) | 2nd tool call found the key link |

- **Token savings:** -414% (CW cost 5.1x more)
- **What CW missed:** executor.ts (the only caller of scheduler.tick()), the connection dispatch→queue→gitManager. CW resolved to the WRONG `dispatch` method.
- **What CW found that Grep wouldn't easily:** The full RuntimeScheduler class in one read (but at 5,000 token cost).
- **Winner:** Grep+Read (decisive)

---

### Task B: Trace agent spawn end-to-end from `team_spawn` tool call through transport to worker

#### Phase 1: ContextWeave

| # | Tool Call | Tokens | Notes |
|---|-----------|--------|-------|
| 1 | `cw_capsule({ query: "team_spawn tool handler end-to-end from MCP tool call through transport layer to worker process creation", token_budget: 6000, mode: "review" })` | 1,651/6,000 | MEDIUM confidence. Found 8 files, 22 symbols. Budget 28% utilized. |
| 2 | `cw_flow({ source: "spawnAndPersistWorkerSession", direction: "both" })` | ~1,200 | Traced callers correctly (ensureWorkerSession → registerAgentLifecycleTools). Outgoing stopped at variable boundary — could not trace `workerAdapter.spawn()` → transport. |

- **Total CW tokens:** ~2,851
- **Completeness:** Partial
- **Missing:** `transport-factory.ts` (how transport is selected: tmux vs headless), the `team_spawn` tool handler body (only skeleton of `spawnAndPersistWorkerSession`), the provider interface crossing.

**Follow-up suggestions useful?** No. Suggested `readBackendName` (6-line utility), `MCPServer` (498 lines — wasteful), `HookHandlerResult` (5-line interface unrelated to spawn).

**Noise in capsule:** `createTeam`, `getTeam`, `touchTeam` from sqlite-store.ts — these are team CRUD, not the spawn flow.

#### Phase 2: Grep+Read

| # | Tool Call | Tokens | Notes |
|---|-----------|--------|-------|
| 1 | `Grep("team_spawn", path: "mcp/")` | ~400 | 23 matches — immediately saw registration at agent-lifecycle.ts:699 |
| 2 | `Read("mcp/server/tools/agent-lifecycle.ts", offset: 699, limit: 80)` | ~1,000 | Full tool handler: validate → resolveSpawnModel → workerAdapter.spawn() |
| 3 | `Grep("class WorkerAdapter", path: "mcp/runtime/")` | ~20 | Found worker-adapter.ts:203 |
| 4 | `Read("mcp/runtime/worker-adapter.ts", offset: 203, limit: 50)` | ~600 | spawn() delegates to provider.spawn() via invoke() wrapper |
| 5 | `Grep("resolveTransport\|createTransport", path: "mcp/runtime/")` | ~40 | Found transport-factory.ts |
| 6 | `Read("mcp/runtime/transport-factory.ts", offset: 70, limit: 60)` | ~750 | Complete transport selection: mode resolution → headless or tmux |

- **Total Grep+Read tokens:** ~2,810
- **Completeness:** Complete

#### Phase 3: Comparison

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,851 | ~2,810 |
| Tool calls | 2 | 6 |
| Completeness | Partial | Complete |
| Time to correct answer | Never complete (missed transport-factory.ts) | 6 targeted calls |

- **Token savings:** -1.5% (essentially same cost, but CW was incomplete)
- **What CW missed:** transport-factory.ts, the tool handler body, provider interface boundary crossing.
- **What CW found that Grep wouldn't easily:** The `cw_flow` incoming chain (ensureWorkerSession → registerAgentLifecycleTools → scripts) was genuinely useful for seeing the call hierarchy.
- **Winner:** Grep+Read (complete vs partial at same cost)

---

### Task C: How do permission profiles, mode policies, hooks, and guardrails combine to gate tool execution?

#### Phase 1: ContextWeave

| # | Tool Call | Tokens | Notes |
|---|-----------|--------|-------|
| 1 | `cw_capsule({ query: "How do permission profiles, mode policies, hooks, and guardrails combine to gate every tool execution", token_budget: 6000, mode: "review" })` | 2,770/6,000 | MEDIUM confidence. 14 files, 30 symbols. 46% budget utilization. |

- **Total CW tokens:** ~2,770
- **Completeness:** Partial
- **Found:** `resolvePermissionAudit` (full), `resolveModeAudit` (full), `evaluatePermissionDecision` (full), `evaluateModeDecision` (full), `evaluateCommandPolicy` (partial), `validatePermissionConfig`, `PermissionDecision` interface.
- **Missing:** `callTool` method — the single orchestration point where all four systems combine in sequence. Without it, you know the decision functions exist but not HOW they compose. Also missing: `hooks.ts:dispatch` method, `deriveHookEvent`.

**Follow-up suggestions useful?** Partially. Suggested `registerBuiltInPolicyHooks` (correct, 170 lines, scored 34.99). Also suggested `updateExecutionAttempt` and `getExecutionAttempt` from sqlite-store.ts — WRONG, completely unrelated.

**Noise:** `scripts/benchmark.sh` mode variable, `scripts/smoke.sh` mode variable, `tests/unit/v3-006.execution-loop.test.ts` (makeWorkerAdapter), `skills/agent-teams/references/policies.md`, `staffing-planner.ts:StaffingDomain`.

#### Phase 2: Grep+Read

| # | Tool Call | Tokens | Notes |
|---|-----------|--------|-------|
| 1 | `Grep("resolvePermission\|resolveModeAudit\|dispatchHooks\|preHook", path: "mcp/server/server.ts")` | ~500 | 27 lines — immediately saw the full gating chain |
| 2 | `Read("mcp/server/server.ts", offset: 348, limit: 70)` | ~900 | `callTool`: permission → mode → hooks → validate → execute. The orchestration. |
| 3 | `Grep("registerBuiltInPolicyHooks", path: "mcp/server/")` | ~60 | Found registration in index.ts:112 |
| 4 | `Read("mcp/server/policy-hooks.ts", offset: 259, limit: 40)` | ~500 | Policy hooks: quality gate, compliance check |

- **Total Grep+Read tokens:** ~1,960
- **Completeness:** Partial (orchestration found; would need ~1,000 more tokens for leaf function details that CW already provided)

#### Phase 3: Comparison

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | ~2,770 | ~1,960 |
| Tool calls | 1 | 4 |
| Completeness | Partial (leaves without trunk) | Partial (trunk without all leaves) |
| Time to correct answer | 1 call, but missing the key insight | 2nd call found the orchestration point |

- **Token savings:** -41% (CW cost more)
- **What CW missed:** The `callTool` method — the entire point of the question ("how do they COMBINE?"). CW gave individual decision functions in isolation.
- **What CW found that Grep wouldn't easily:** The full implementations of `evaluatePermissionDecision`, `evaluateModeDecision`, and `evaluateCommandPolicy` in a single response. CW is good at surfacing the leaf functions.
- **Winner:** Grep+Read (found the integration point; CW found scattered pieces)

---

### Overall Token Comparison

| | ContextWeave | Grep+Read |
|--|-------------|-----------|
| Task A | ~7,449 | ~1,450 |
| Task B | ~2,851 | ~2,810 |
| Task C | ~2,770 | ~1,960 |
| **Total** | **~13,070** | **~6,220** |
| **Actual savings** | **-110%** (CW used 2.1x more tokens) | |

---

## Stress Test Results

### 2A: Exact Symbol Ranking

| Symbol | Definition at #1? | What outranked it? | Utilization |
|--------|------------------|--------------------|-------------|
| `validatePermissionConfig` | Yes | N/A — definition in permission-profiles.ts was #1 | 1088/1200 (91%) |
| `evaluateModeDecision` | Yes | N/A — definition in mode-policy.ts was #1 | 716/1200 (60%) |
| `createFairTaskQueue` | Yes | N/A — definition in queue.ts was #1 | 923/1200 (77%) |

**Verdict:** Symbol lookup works well when queried by exact name. All 3/3 definitions ranked first. However, confidence was MEDIUM for all three — never HIGH, even for exact symbol matches.

### 2B: Confidence Honesty

| Query | Confidence | Tokens Used/Budget | Coverage Confidence | Pivot Coverage | Was confidence earned? |
|-------|-----------|-------------------|---------------------|---------------|----------------------|
| "error handling" | MEDIUM | 1480/2000 (74%) | 69% | 57% | No — results included TmuxRunner type, HeadlessTransport class, defaultBackendForDomain, all irrelevant to understanding error handling patterns. Should be LOW. |
| "how is state managed across the application" | MEDIUM | 1512/2000 (76%) | 45% | **19%** | No — 19% pivot coverage means 81% of candidate symbols were dropped. Result was a grab-bag: git-manager state parsing, SqliteStore constructor, team-ui-view script. Should be LOW. |

**Verdict:** Confidence is stuck at MEDIUM. In this entire session (11 capsules), confidence was MEDIUM 10 times and LOW once. It was NEVER HIGH. The system appears to default to MEDIUM regardless of actual result quality. A query with 19% pivot coverage and 45% coverage confidence should not report MEDIUM.

### 2C: Budget Utilization

| Query | Budget | Used | Utilization | Notes |
|-------|--------|------|-------------|-------|
| "SqliteStore all public methods and their callers" | 8,000 | 1,094 | **14%** | Catastrophic. SqliteStore has 245 symbols. Capsule returned 1 SqliteStore method (refreshAllTaskReadiness as a reference). Filled with noise: proposeSemanticMerge, watch_atx_completion_and_sleep.sh:all_ok. |
| "complete execution loop from scheduler tick through worker adapter to task completion" | 8,000 | 3,403 | **43%** | Better. Found scheduler.tick, WorkerAdapter, CodexWorkerProvider, TmuxTransport methods. Still missed executor.ts (the central glue). |

**Verdict:** Budget utilization is severely broken for broad queries. The system finds a small number of relevant symbols, packs them, then stops — even when thousands of tokens of budget remain unused. cw_stats reported "Budget utilization healthy" at 53% session average, masking the 14% individual case.

### 2D: Flow Tracing

| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `evaluateModeDecision` | **Yes** — correctly traced: evaluateModeDecision ← resolveModeAudit ← callTool ← various callers | N/A (direct call) | No issues. Works as expected for direct calls. |
| `dispatch` (ambiguous) | **Yes** (for hooks.ts) | N/A | Resolved to hooks.ts dispatch, not scheduler dispatch. No disambiguation mechanism. |
| `registerAgentLifecycleTools` (callbacks) | N/A | **No** — only traced direct call to resolveWorkerAdapter and type imports. Anonymous tool handler callbacks (registered via `server.registerTool()`) were invisible. | Cannot trace through callback registration patterns — a fundamental limitation for this codebase's architecture. |

### 2E: Supporting Tools

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | "transport architecture" | **6** | Returned directory summary + 3 file matches. Useful for orientation. But no content — just file names with keyword-matched summaries. Doesn't explain architecture. |
| `cw_recall` | "architecture patterns" | **4** | Returned cached capsule summaries from prior sessions and doc heading snippets. Not genuine architectural insights. The "convention" observations are just query logs, not learned patterns. |
| `cw_impact` | "callTool" | **2** | Returned 558 affected symbols — every test case plus scripts. Technically correct but completely useless for decision-making. No filtering, no ranking, no grouping. A developer asking "what breaks if I change callTool?" gets a wall of 558 variable names. |
| `cw_stats` | (current session) | **5** | Reports "Budget utilization healthy" at 53% — misleading when individual capsules were as low as 14%. First-pass rate 100% and correction rate 0% provide no useful signal (they're always 100%/0%). |

---

## Flaws Found

### P0 (Critical — blocks adoption)

1. **Symbol ambiguity causes wrong-function retrieval:** When querying "dispatch method in scheduler," CW returned `hooks.ts:dispatch` at relevance 1.0 and `scheduler.ts:RuntimeScheduler` at 0.6. The user explicitly said "scheduler" but CW ranked the wrong file first. `cw_flow` then traced the wrong dispatch, compounding the error. **Root cause:** The retrieval pipeline doesn't weight the query context ("in scheduler") when ranking same-named symbols. Likely in the scoring/ranking stage where symbol name match outweighs file context. **Fix:** When a query mentions a file, class, or module name alongside a symbol, boost symbols whose container matches. Consider `file:SymbolName` disambiguation in capsule queries, not just in `cw_impact`.

2. **Budget severely underutilized on broad queries (14-43%):** An 8,000-token budget query about SqliteStore's 245 public methods returned 1,094 tokens (14%) with only 1 SqliteStore method. The system stops packing after finding a few symbols even when the query clearly needs more. **Root cause:** Likely the retrieval stage (stageA/stageB) caps the candidate set too aggressively. stageA returned only 29 candidates for the SqliteStore query — in a class with 245 symbols. **Fix:** When the query explicitly names a class/module, retrieve ALL symbols from that entity before applying budget limits. The budget exists to cap output, not to cap retrieval.

3. **CW used 2.1x MORE tokens than Grep+Read across 3 tasks:** Total CW: ~13,070 vs Grep+Read: ~6,220. The claimed 60-70% savings did not materialize — CW showed a 110% token increase. The overhead of capsule framing, noise symbols, follow-up reads of large classes, and skeleton/reference filler exceeds the savings from AST compression. **Root cause:** Capsule noise ratio is high (irrelevant files appearing in results), forcing follow-up reads. The `cw_read` of RuntimeScheduler (429 lines, ~5000 tokens) wiped out any savings from the 1849-token capsule. **Fix:** Reduce noise in capsules (see P1 flaws). Make follow-up reads more targeted (symbol-level, not class-level). Track net token cost (capsule + all follow-ups) as a first-class metric.

### P1 (Important — degrades quality)

1. **Noise pollution in capsules:** Every broad capsule contained irrelevant results: `watch_atx_completion_and_sleep.sh:all_ok` appeared in 3 different capsules, `tests/unit/v3-005.git-isolation.test.ts:alloc` and `gitShowFile` appeared in dispatcher results, `scripts/benchmark.sh:mode` and `scripts/smoke.sh:mode` appeared in permission policy results, `proposeSemanticMerge` appeared in SqliteStore results. **Root cause:** The packer fills remaining budget with low-relevance tail symbols instead of stopping. L3 noise metric was 68% in Task A's capsule. **Fix:** Set a minimum relevance threshold. If a symbol scores below 10% of the top symbol's relevance, exclude it even if budget remains. Better to return a 30% utilized capsule than a 46% utilized capsule where half is noise.

2. **Confidence is stuck at MEDIUM:** 10 of 11 capsules this session reported MEDIUM confidence. Never HIGH — not even for exact symbol lookups that returned the definition at #1 with 91% budget utilization. Coverage confidence ranged from 25% to 69% with no effect on the reported level. A 19% pivot coverage query still got MEDIUM. **Root cause:** The confidence thresholds are too lenient for MEDIUM and too strict for HIGH. Likely in a confidence calculation module where the bands are (LOW: <X%, MEDIUM: X-Y%, HIGH: >Y%) but Y is set unreachably high. **Fix:** Calibrate: if the definition is at #1, budget >80% utilized, and coverage >90% — that's HIGH. If pivot coverage is below 30%, that's LOW regardless of other metrics.

3. **Follow-up suggestions are wrong 2/3 of the time:** Across the 3 tasks: Task A suggested `ToolHandler` (irrelevant), `alloc` (irrelevant), `gitShowFile` (irrelevant). Task B suggested `readBackendName` (marginal), `MCPServer` 498 lines (wasteful), `HookHandlerResult` (irrelevant). Task C suggested `registerBuiltInPolicyHooks` (correct!), `updateExecutionAttempt` (wrong), `getExecutionAttempt` (wrong). Only 2 of 9 suggested reads were genuinely useful. **Root cause:** Follow-up suggestions appear to be ranked by compression score (how many tokens were saved) rather than by relevance to the query. `updateExecutionAttempt` had a high score (31.53) but zero relevance to permission gating. **Fix:** Filter follow-up suggestions through query relevance, not just compression score. A symbol that was compressed but isn't relevant to the query should not be suggested.

4. **`cw_flow` cannot trace through callbacks or dynamic dispatch:** In a codebase where all tool handlers are anonymous functions passed to `server.registerTool()`, and where `WorkerAdapter.spawn()` delegates to `this.provider.spawn()` via interface, `cw_flow` is blind to the most architecturally important connections. **Root cause:** Static AST analysis cannot follow runtime dispatch. This is a known limitation of any static tool, but it's particularly damaging in this callback-heavy codebase. **Fix:** Consider heuristic tracing: if a method is passed to a registration function (e.g., `registerTool(name, schema, handler)`), index the handler as a callable associated with `name`. For interface dispatch, trace all implementations of the interface method.

5. **`cw_impact` returns unusable result sets for high-centrality symbols:** `callTool` impact analysis returned 558 symbols — every test case, every script, every tool registration. No grouping, no ranking by proximity, no way to filter to "production code only." **Root cause:** Impact analysis is a flat traversal with no output budget or relevance ranking. **Fix:** Apply token budget to impact results like capsules. Group by file/module. Offer a `scope` parameter to filter (e.g., `scope: "mcp/"` to exclude tests). Show only depth-1 production callers by default, with deeper depths opt-in.

### P2 (Moderate — papercut)

1. **`cw_overview` query focus is shallow:** The "transport architecture" query returned 3 file names with keyword-matched summaries. No symbol listing, no relationship information, no architectural insight beyond "these files exist." For architectural questions, this is barely better than `ls | grep transport`. **Fix:** Include top 5 symbols per matched file and their 1-hop connections.

2. **`cw_recall` returns query logs, not learned patterns:** The "convention" observations are just formatted logs of prior capsule queries: "Query X resolved to Y files across Z symbols." These aren't architectural insights. The "documentation" observations are doc heading snippets. **Fix:** Only surface observations that were explicitly stored via `cw_remember`. Don't promote query logs to the same status as intentional observations.

3. **`cw_stats` "healthy" label is misleading:** Session stats reported 53% average utilization as "Budget utilization healthy" while individual capsules ranged from 14% to 91%. The average masks severe underperformance on broad queries. **Fix:** Report min/max alongside average. Flag any capsule below 30% as underutilized in the summary. Replace "healthy" with objective bands.

4. **Duplicate content across capsules:** `watch_atx_completion_and_sleep.sh:all_ok` (a bash variable assignment `all_ok=0`) appeared in capsules for "dispatch," "SqliteStore methods," and others. This single 1-line bash variable has no relevance to any TypeScript query. **Root cause:** Likely low centrality threshold allowing bash script symbols into TypeScript-focused results. **Fix:** Apply language affinity — if the query matches TypeScript-heavy results, deprioritize bash/markdown symbols.

5. **ContextWeave version not exposed:** `cw_status()` returns file/symbol/edge counts and session metrics but no version identifier. This makes it impossible to track which version produced which review results. **Fix:** Include `version` field in `cw_status` output.

---

## What Worked Well

1. **Exact symbol lookup is solid.** All 3 symbol ranking tests returned the definition at #1. When you know the exact function name, `cw_capsule` reliably finds it and shows it with context (callers, related types). This is genuinely faster than grep→read→grep for the definition+context pattern.

2. **Multi-level compression is clever.** The [full]/[skeleton]/[summary]/[reference] compression levels are a good idea. Showing the target symbol in full while showing its callers as skeletons gives you the "neighborhood" without reading 5 files. When it works (Task C's leaf functions), you get a useful architectural view.

3. **`cw_flow` direct call tracing is accurate.** For `evaluateModeDecision`, the incoming flow chain was correct and complete: evaluateModeDecision ← resolveModeAudit ← callTool ← multiple callers with full file:line references. This is genuinely useful for understanding call hierarchies that would take multiple grep rounds.

4. **Clustered output in capsules.** The `[Cluster: mcp/server]`, `[Cluster: mcp/runtime]` grouping in capsule output helps organize scattered results by module. Better than a flat list.

5. **Self-diagnostic quality notes.** The capsule honestly reports "low-relevance content exceeds 60%" and "overall coverage confidence below 60%." The diagnostic data is there — it just isn't reflected in the confidence level (see P1 flaw #2).

---

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | **7** — exact names work; ambiguous names fail badly |
| Broad recall (found all relevant files) | **4** — consistently missed 1-2 critical files per task |
| Budget utilization (% of budget used) | **3** — 14% to 91% range, 53% session average |
| Confidence calibration (honest scores) | **2** — MEDIUM for everything regardless of quality |
| Flow tracing (traces real call chains) | **6** — direct calls excellent, callbacks/interfaces blind |
| Follow-up quality (suggested reads were useful) | **3** — 2 of 9 suggestions were correct |
| Token savings vs grep+read (measured, not claimed) | **2** — used 2.1x MORE tokens, not 60-70% less |
| **Overall: Would replace Grep+Explore?** | **No** — supplement only. Use CW for symbol lookup + flow tracing. Use Grep+Read for everything else. |

---

## Evidence Snippets

### P0-1: Symbol ambiguity (wrong dispatch)

**Query:** `cw_capsule({ query: "dispatch method in scheduler and all its callers and callees", token_budget: 4000, mode: "review" })`

**Key response:**
```
Confidence: MEDIUM
Files:
  mcp/server/hooks.ts — relevance: 1.0 ← WRONG: this is hooks dispatch, not scheduler dispatch
  mcp/runtime/scheduler.ts — relevance: 0.6 ← CORRECT file, ranked #2
```
**Correct answer:** The scheduler's dispatch logic is in `RuntimeScheduler.dispatchTeam()` at scheduler.ts:297, called from `tick()` at scheduler.ts:245, which is called by `RuntimeExecutor.runOnce()` at executor.ts:145.

### P0-2: Budget underutilization (14%)

**Query:** `cw_capsule({ query: "SqliteStore all public methods and their callers", token_budget: 8000 })`

**Key response:**
```
Tokens: 1094/8000 (14%)
Confidence: LOW
Retrieval: stageA 29 -> stageB 51
```
SqliteStore has 245 indexed symbols. Only 1 was returned as a reference (`refreshAllTaskReadiness`). The capsule was filled with `proposeSemanticMerge`, `watch_atx_completion_and_sleep.sh:all_ok`, and git-isolation test variables.

### P0-3: Token cost comparison

```
Task A — CW: 7,449 tokens (3 calls, partial answer) vs Grep+Read: 1,450 tokens (4 calls, complete)
Task B — CW: 2,851 tokens (2 calls, partial answer) vs Grep+Read: 2,810 tokens (6 calls, complete)
Task C — CW: 2,770 tokens (1 call, partial answer)  vs Grep+Read: 1,960 tokens (4 calls, partial)
Total  — CW: 13,070 tokens                           vs Grep+Read: 6,220 tokens
```

### P1-2: Confidence stuck at MEDIUM

```
Capsule: "error handling"     — coverage_confidence: 69%, pivot: 57% → MEDIUM
Capsule: "state managed"      — coverage_confidence: 45%, pivot: 19% → MEDIUM
Capsule: "validatePermission"  — coverage_confidence: 50%, definition at #1, 91% util → MEDIUM
Capsule: "evaluateModeDecision" — coverage_confidence: 50%, definition at #1, 60% util → MEDIUM
```
All MEDIUM. The internal metrics vary wildly (19% to 69% coverage) but the output label doesn't change.

### P1-3: Follow-up suggestions wrong

**Task C capsule** suggested these follow-up reads:
```
cw_read(path: "mcp/server/policy-hooks.ts", symbol: "registerBuiltInPolicyHooks") — scored 34.99 ✓ CORRECT
cw_read(path: "mcp/store/sqlite-store.ts", symbol: "updateExecutionAttempt") — scored 31.53 ✗ WRONG
cw_read(path: "mcp/store/sqlite-store.ts", symbol: "getExecutionAttempt") — scored 29.83 ✗ WRONG
```
The two wrong suggestions are SQLite execution attempt CRUD methods with zero relevance to "how do permissions/policies/hooks gate tool execution."

### P1-5: cw_impact returns 558 symbols

**Query:** `cw_impact({ target: "callTool", depth: 2 })`

**Key response:** `Total: 558 affected symbols` — listing every test variable that calls `callTool`. First 10 results were test variables like `result`, `started`, `explicit`, `first`, `second`, `third`, `failed`. No production code prioritization, no grouping, no filtering.
