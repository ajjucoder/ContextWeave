# ContextWeave Field Review: ContextWeave

**Date:** 2026-03-14
**ContextWeave Version:** `contextweave v0.1.0`

## Project Profile

| Metric | Value |
|--------|-------|
| Project | ContextWeave |
| Stack | Node.js, TypeScript ESM, SQLite, tree-sitter, MCP |
| Lines of Code | 372,810 |
| Source Files | 2,173 code files on disk; 449 files indexed by ContextWeave |
| Symbols Indexed | 3,134 |
| Languages | TypeScript, TSX, JavaScript, Python, Go, Rust, Java, Ruby, C, C++, PHP, Markdown, YAML, JSON |
| Index Time | 1.06s incremental reindex (`449` discovered, `20` changed, `383` symbols reprocessed) |
| Architecture | Local-first MCP server with layered indexing/retrieval pipeline: CLI/MCP entrypoints -> capsule/core logic -> SQLite graph/memory/hooks |
| Key Directories | `src/`, `tests/`, `bench/`, `docs/`, `audits/` |

Token counting method: capsule counts use ContextWeave's own `tokensUsed`; all non-capsule tool outputs and grep/read outputs were counted with the repo's `gpt-tokenizer`.

## Task-Based Results

### Task A: Find and understand `classifyQueryIntent` and its runtime effects

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 2,135 | 1,834 |
| Tool calls | 5 | 4 |
| Completeness | Complete | Complete |
| Time to correct answer | ~8s | <1s |

**What ContextWeave found:** The function body in `src/capsule/intent-classifier.ts`, plus callers via `cw_impact` showing usage in `src/capsule/generator.ts` and `src/mcp/tools/overview.ts`.
**What ContextWeave missed:** The initial capsule did not show the actual call sites and injected irrelevant neighbors (`QueryRow`, `computeQueryOverlap`) before I forced more tools.
**Follow-up suggestions useful?** No. The capsule suggested `cw_overview`, `cw_grep`, and path narrowing; the real next step was just reading the two call sites.
**Winner:** Grep+Read

### Task B: Trace a `cw_capsule` request from MCP tool handler to generator and session stats logging

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 4,085 | 1,315 |
| Tool calls | 13 | 5 |
| Completeness | Partial | Complete |
| Time to correct answer | ~20s | <1s |

**What ContextWeave found:** After multiple retries, it exposed the handler in `src/mcp/tools/capsule.ts`, the capsule log insert in `src/capsule/generator.ts`, and the stats aggregation path in `src/mcp/tools/stats.ts`.
**What ContextWeave missed:** The primary broad capsule missed the actual MCP entry file and the stats file, `cw_flow` could not trace the real path, and `cw_impact` falsely claimed `generateCapsuleWithRuntime` had no dependents.
**Follow-up suggestions useful?** No. It tried to send me to `SessionContext` and `session` instead of the handler/logging path I asked for.
**Winner:** Grep+Read

### Task C: How are capsule confidence and budget utilization calibrated?

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 6,943 | 3,789 |
| Tool calls | 9 | 4 |
| Completeness | Complete | Complete |
| Time to correct answer | ~11s | <1s |

**What ContextWeave found:** `cw_overview` plus a path-scoped capsule eventually surfaced `src/capsule/confidence.ts`, `src/capsule/generator.ts`, `src/capsule/diagnostics.ts`, `src/capsule/formatter.ts`, and `src/mcp/tools/stats.ts`.
**What ContextWeave missed:** It still suggested weak follow-ups (`confidence`, `NARROW_MIN_UTILIZATION`) and omitted `stats.ts` until I explicitly read it.
**Follow-up suggestions useful?** Mostly no. The useful files came from manual targeting, not from the suggested reads.
**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 13,163
- Total Grep+Read tokens across 3 tasks: 6,938
- Actual savings: `-89.7%` (ContextWeave used 1.90x the baseline tokens)

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `loadConfig` | No (verification grep) | Four import/caller hits before the definition |
| `computeSessionStats` | Yes | Nothing |
| `registerSearchTool` | No (verification grep) | `src/mcp/server.ts` import outranked the definition |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `architecture` | `LOW` / `CRITICAL` | `1909/2000` | Yes, roughly. The answer was mostly garbage and the tool admitted it was weak. |
| `session` | `HIGH` / `VERY_LOW` | `1648/2000` | No. It mixed DB helpers, watcher shutdown, hooks, test fixtures, and unrelated session-ish code, then called that high-confidence. |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `cw_capsule request flow tool handler generator session stats logging` | 8000 | 288 | 4% |
| `capsule confidence budget utilization calibration` | 8000 | 804 | 10% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `runServe` | No | No | Never reached `startMcpServer`; got stuck on logger and local helper noise |
| `startMcpServer` | No | No | Missed the `process.once(... -> shutdown)` callback path and returned import/type-usage clutter instead |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `capsule confidence budget utilization calibration` | 5 | Useful candidate files, but noisy directory summary, stale count, `.tmp` pollution, and weak entry-point ranking |
| `cw_recall` | `confidence calibration` | 2 | Almost entirely passive telemetry and doc fragments; no learned architectural synthesis |
| `cw_impact` | `generateCapsuleWithRuntime` | 1 | False negative: it said "No dependents found" even though `src/mcp/tools/capsule.ts` calls it directly |
| `cw_stats` | current session | 3 | Claimed `100%` first-pass and `0.00` follow-up reads after a session dominated by `cw_read`/`cw_grep` corrections |

## Flaws Found

Ordered by severity. Each flaw is intentionally single-issue and actionable.

### P0 (Critical — blocks adoption)
1. **Broad/task capsules do not reliably retrieve the real end-to-end path**: Task B's core query missed `src/mcp/tools/capsule.ts` and `src/mcp/tools/stats.ts`, pulled in bench/UI junk, and still cost 3.1x the grep baseline. Likely root cause: ranking and packing in `src/capsule/generator.ts`, `src/capsule/pivot-scorer.ts`, and `src/core/file-summaries.ts` still over-reward lexical/adjacent matches and under-penalize docs, benches, tests, fixtures, and marketing artifacts for review-mode runtime queries. **Fix:** add stronger review-mode source scoping, inferred-layer coverage requirements, and hard penalties for bench/docs/test/UI files unless the query explicitly asks for them. |
2. **`cw_flow` is not trustworthy for real execution paths**: On `runServe`, `runReindex`, `startMcpServer`, and `generateCapsuleWithRuntime`, it preferred import/type-usage detours, leaked test fixtures, and missed the meaningful cross-file path. Likely root cause: traversal in `src/mcp/tools/flow.ts` treats import and call edges too similarly, does not default-filter test/fixture files, and groups paths before proving they represent runtime flow. **Fix:** prioritize executable `call`/`callback`/framework edges over import/type edges, exclude tests/fixtures by default, and require at least one runtime edge before calling a path "flow." |
3. **`cw_stats` overstates success for actual ContextWeave usage**: My session needed heavy follow-up via `cw_read`, `cw_grep`, `cw_overview`, and `cw_flow`, yet `cw_stats` still reported `100.0%` first-pass, `0.0%` correction, and `0.00` follow-up reads. Likely root cause: `src/hooks/post-tool-use.ts` only marks follow-up for native `Read`/`Write`/`Edit` tools, not for ContextWeave-native navigation tools, while capsule logs are inserted with `followedUp: false` in `src/capsule/generator.ts` and never corrected for CW follow-ups. **Fix:** treat `cw_read`, `cw_grep`, `cw_overview`, `cw_flow`, and `cw_impact` as first-class correction signals and make stats distinguish "native-tool follow-up" vs "CW-tool follow-up." |

### P1 (Important — degrades quality)
1. **Large budgets are catastrophically underused**: With an `8000` token budget, two broad queries used only `288` and `804` tokens. That is not just suboptimal; it means the packer gave up while the answer was still obviously incomplete. Likely root cause: refill/widen passes in `src/capsule/generator.ts` and packing logic in `src/capsule/packer.ts` stop early after low-value reference packing instead of escalating to denser file-level expansion. **Fix:** enforce a minimum utilization floor for broad/task queries and keep widening until either the floor is reached or the tool emits an explicit "I cannot fill this budget meaningfully" reason. |
2. **Confidence is miscalibrated on polysemous queries**: Querying `session` produced `HIGH` confidence even though the result mixed DB queries, watcher shutdown, hooks, test fixtures, and unrelated symbols. Likely root cause: `src/capsule/confidence.ts` rewards structural breadth and token utilization but does not penalize ambiguous-term spread, test/fixture contamination, or concept drift strongly enough. **Fix:** add a dispersion penalty for ambiguous queries and reduce confidence when top files span unrelated subsystems or test-only directories. |
3. **Suggested follow-up reads often chase the wrong thing**: On broad/architectural tasks, suggestions like `SessionContext`, `confidence`, `decayConfidence`, and one-line utilization constants were rarely the file I actually needed next. Likely root cause: follow-up ranking in `src/capsule/formatter.ts` uses local overlap and compression score rather than "missing information needed to answer the task." **Fix:** rank follow-ups by unresolved query gaps, missing layer coverage, and whether the symbol closes a known diagnostic reason. |

### P2 (Moderate — papercut)
1. **Path presentation is inconsistent and mildly confusing**: A `path: "src/capsule"` scoped capsule reported files like `confidence.ts` and `generator.ts` without the `src/capsule/` prefix, while other surfaces used full repo-relative paths. Likely root cause: display-path shortening in formatter/generator helper code (`src/capsule/generator-helpers.ts`, `src/capsule/formatter.ts`) is not aligned with follow-up command ergonomics. **Fix:** keep repo-relative paths in structured output and only shorten for the human-readable header if the full path is preserved elsewhere. |
2. **`cw_recall` still feels like telemetry search, not memory**: On `confidence calibration`, recall mostly returned passive query logs and file-change noise. Likely root cause: `src/mcp/tools/recall.ts` includes passive observations and `src/memory/search.ts` is not promoting durable architecture/decision notes strongly enough. **Fix:** default to intentional observations first, demote passive query telemetry harder, and surface passive items only behind an explicit flag or separate section after useful notes. |

## What Worked Well

- Exact-symbol `cw_capsule` queries usually did put the definition itself into the capsule, even when the broader retrieval story around it was mediocre.
- `cw_read` is the most dependable part of the stack. File and line-bounded reads were consistently useful once I already knew where to look.
- The capsule output format is transparent about `tokensUsed`, coverage confidence, uncertainty, and retrieval counts. That visibility made the failures easier to diagnose.
- Low-confidence cases are not always overconfident. The `architecture` query was bad, but the tool at least admitted that it was bad.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 7 |
| Broad recall (found all relevant files) | 2 |
| Budget utilization (% of budget used) | 1 |
| Confidence calibration (honest scores) | 3 |
| Flow tracing (traces real call chains) | 2 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 1 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

- **Broad-flow miss**
  Query: `cw_capsule("cw_capsule request flow tool handler generator session stats logging", budget=2600)`
  Response: `Tokens 779/2600`, `Confidence LOW`, top files included `src/capsule/generator.ts`, `src/capsule/generator-helpers.ts`, `src/mcp/server.ts`, benches, and a landing page.
  Correct answer should have centered `src/mcp/tools/capsule.ts`, `src/capsule/generator.ts`, `src/db/queries/capsule-log.ts`, and `src/mcp/tools/stats.ts`.

- **Flow tracing false path**
  Query: `cw_flow({ source: "runServe" })`
  Response: logger helpers and `pidIsRunning`; no `startMcpServer`.
  Correct answer should have shown the cross-file call from `src/cli/commands/serve.ts` into `src/mcp/server.ts:startMcpServer`.

- **Impact false negative**
  Query: `cw_impact({ target: "generateCapsuleWithRuntime" })`
  Response: `No dependents found`.
  Correct answer should have included `src/mcp/tools/capsule.ts`, which directly calls `generateCapsuleWithRuntime`.

- **Dishonest stats**
  Query: `cw_stats()`
  Response: `First-pass rate 100.0%`, `Correction rate 0.0%`, `Avg follow-up reads 0.00`.
  Correct answer should have reflected the many `cw_read`/`cw_grep`/`cw_overview` corrections required in this session.

- **Confidence misfire**
  Query: `cw_capsule("session", budget=2000)`
  Response: `Confidence HIGH`, `Coverage confidence 100%`, with mixed DB helpers, watcher shutdown, hooks, server boot, and test fixture session code.
  Correct answer should have either scoped to one session subsystem or reported low confidence because the term is too ambiguous.

- **Budget underutilization**
  Query: `cw_capsule("cw_capsule request flow tool handler generator session stats logging", budget=8000)`
  Response: `Tokens 288/8000`.
  Correct answer should have used far more of the budget or explicitly said why meaningful expansion was impossible.
