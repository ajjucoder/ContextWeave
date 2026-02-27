# ContextWeave End-to-End Implementation Plan (Ticketed)

Source reminder: root [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md)

## Wave 5 Grep/Explorer Replacement Plan (2026-02-27 Session)

Source reminder: [`docs/plans/2026-02-27-wave5-grep-explorer-replacement.md`](../docs/plans/2026-02-27-wave5-grep-explorer-replacement.md)

## Scope
Execute all remaining Wave 5 items end-to-end after the completed P0 foundation:
- recalibrate ratchet baseline for current code snapshot before scoring changes
- implement Stage A/B explosion control and broad/task budget utilization
- clarify quality label wording in capsule output
- add four MCP navigation tools (`cw_overview`, `cw_files`, `cw_search`, `cw_read`)
- validate behavior on real project `/path/to/project`

Session execution context:
- branch: `wave5-grep-explorer-replacement`
- mode: `superpowers:using-superpowers + executing-plans + dispatching-parallel-agents (native agent-team lanes)`

## Ticket Backlog (Wave 5)

### CWW5-P0-001
- owner: codex
- scope/files: `tests/integration/quality-baseline.json`, `tests/integration/threshold-ratchet.test.ts` (measurement workflow)
- acceptance criteria:
  - fresh baseline measurement is captured for current source snapshot before phase-3/4 scoring edits.
  - ratchet suite runs against refreshed baseline without stale-threshold false failures.
- linked tests:
  - `npx vitest run tests/integration/threshold-ratchet.test.ts`
  - `npx tsx tests/integration/update-baseline.ts`
- status: done

### CWW5-P1-001
- owner: codex
- scope/files: `src/capsule/generator.ts`, `tests/capsule/two-phase-retrieval.test.ts`, `tests/capsule/multi-pass-generator.test.ts`
- acceptance criteria:
  - stage A/B candidate explosion is bounded for broad/task queries.
  - non-test broad/task queries downweight test/spec files.
  - narrow confidence regression is prevented by integration gates.
- linked tests:
  - `npx vitest run tests/capsule/two-phase-retrieval.test.ts tests/capsule/multi-pass-generator.test.ts`
  - `npx vitest run tests/integration/task-query-quality.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

### CWW5-P1-002
- owner: codex
- scope/files: `src/capsule/generator.ts`, `tests/capsule/broad-task-utilization.test.ts`
- acceptance criteria:
  - broad/task packing applies adaptive refill when utilization is low and candidates remain.
  - broad/task queries use meaningful share of budget (>60%) when content is available.
- linked tests:
  - `npx vitest run tests/capsule/two-phase-retrieval.test.ts tests/integration/capsule.test.ts`
  - `npx vitest run tests/integration/task-query-quality.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

### CWW5-P1-003
- owner: codex
- scope/files: `src/capsule/formatter.ts`, `tests/capsule/formatter-multi-pass.test.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - ambiguous label wording is replaced with explicit confidence + uncertainty wording.
  - formatter tests assert the updated label format.
- linked tests:
  - `npx vitest run tests/capsule/formatter-multi-pass.test.ts tests/integration/capsule.test.ts`
- status: done

### CWW5-P1-004
- owner: codex
- scope/files: `src/mcp/tools/overview.ts`, `src/mcp/server.ts`, `tests/integration/mcp-tool-schema-compat.test.ts`
- acceptance criteria:
  - `cw_overview` tool is registered and returns compact index/module overview.
  - schema compatibility test covers the new tool.
- linked tests:
  - `npx vitest run tests/integration/mcp-tool-schema-compat.test.ts`
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: done

### CWW5-P1-005
- owner: codex
- scope/files: `src/mcp/tools/files.ts`, `src/mcp/server.ts`, `tests/integration/mcp-tool-schema-compat.test.ts`
- acceptance criteria:
  - `cw_files` supports path/glob style listing with metadata and bounded results.
  - schema + behavior tests validate result shape and bounds.
- linked tests:
  - `npx vitest run tests/integration/mcp-tool-schema-compat.test.ts`
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: done

### CWW5-P1-006
- owner: codex
- scope/files: `src/mcp/tools/search.ts`, `src/mcp/server.ts`, `tests/integration/mcp-tool-schema-compat.test.ts`
- acceptance criteria:
  - `cw_search` supports indexed content search with snippets and bounded result counts.
  - schema + behavior tests validate search scopes and snippet output.
- linked tests:
  - `npx vitest run tests/integration/mcp-tool-schema-compat.test.ts`
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: done

### CWW5-P1-007
- owner: codex
- scope/files: `src/mcp/tools/read.ts`, `src/mcp/server.ts`, `tests/integration/mcp-tool-schema-compat.test.ts`, `tests/security/mcp-read-path-guards.test.ts`
- acceptance criteria:
  - `cw_read` supports bounded line-range reads and path safety guards.
  - traversal/out-of-root attempts are blocked with explicit error output.
- linked tests:
  - `npx vitest run tests/integration/mcp-tool-schema-compat.test.ts`
  - `npx vitest run tests/security/mcp-read-path-guards.test.ts`
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: done

### CWW5-P0-002
- owner: codex
- scope/files: `bench/` and integration evidence (real project validation run output)
- acceptance criteria:
  - required polymarket broad queries run against indexed repo and return non-empty useful outputs.
  - evidence includes stageA/stageB counts, tokens used, and target entities found.
- linked tests:
  - `npx vitest run tests/integration/task-query-quality.test.ts tests/integration/threshold-ratchet.test.ts`
  - `npx tsx bench/wave5-polymarket-validation.ts`
- status: done

## Execution Order (Wave 5)
1. CWW5-P0-001
2. Parallel implementation lanes:
   - capsule lane: CWW5-P1-001, CWW5-P1-002, CWW5-P1-003
   - mcp lane: CWW5-P1-004, CWW5-P1-005, CWW5-P1-006, CWW5-P1-007
3. Final validation gate: CWW5-P0-002

## Wave 4 Explorer-Killer Plan (2026-02-27 Session)

Source reminder: [`docs/plans/2026-02-27-wave4-explorer-killer.md`](../docs/plans/2026-02-27-wave4-explorer-killer.md)

## Scope
Execute the full Wave 4 explorer-killer plan end-to-end with no regressions:
- Phase 1 self-improving QA harness and ratchet baseline
- Phase 2 query intent classification + strategy routing + story-complete packing + adaptive confidence
- Phase 3 multi-pass capsule decomposition, merge, and clustered output
- Phase 4 concurrent-agent-safe MCP behavior and stress validation

Session execution context:
- branch: `feat/wave4-explorer-killer`
- mode: `agent-team (native sub-agents) with parallel Phase 2/3 and Phase 4 after Phase 1`

## Ticket Backlog (Wave 4)

### CWW4-P0-001
- owner: codex
- scope/files: `tests/integration/task-query-quality.test.ts`
- acceptance criteria:
  - class-based suites exist for narrow/broad/task queries.
  - thresholds are enforced per class plus overall average.
- linked tests:
  - `npx vitest run tests/integration/task-query-quality.test.ts`
- status: done

### CWW4-P0-002
- owner: codex
- scope/files: `src/capsule/diagnostics.ts`, `tests/capsule/diagnostics.test.ts`
- acceptance criteria:
  - query class detection exists (`narrow|broad|task`).
  - diagnostics output includes bottleneck classification + suggestion.
- linked tests:
  - `npx vitest run tests/capsule/diagnostics.test.ts`
- status: done

### CWW4-P0-003
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/core/types.ts`, `src/capsule/formatter.ts`
- acceptance criteria:
  - metadata carries diagnostics payload.
  - low-confidence capsules render diagnostics section.
- linked tests:
  - `npx vitest run tests/integration/task-query-quality.test.ts tests/integration/capsule.test.ts`
- status: done

### CWW4-P0-004
- owner: codex
- scope/files: `tests/integration/threshold-ratchet.test.ts`, `tests/integration/update-baseline.ts`, `tests/integration/quality-baseline.json`
- acceptance criteria:
  - ratchet test blocks confidence regressions per class.
  - baseline update script writes fresh measured baseline.
- linked tests:
  - `npx vitest run tests/integration/threshold-ratchet.test.ts`
  - `npx tsx tests/integration/update-baseline.ts`
- status: done

### CWW4-P0-005
- owner: codex
- scope/files: `src/capsule/intent-classifier.ts`, `tests/capsule/intent-classifier.test.ts`
- acceptance criteria:
  - classifier returns intent + normalized/focus/action/module fields.
  - required canonical queries classify correctly.
- linked tests:
  - `npx vitest run tests/capsule/intent-classifier.test.ts`
- status: done

### CWW4-P0-006
- owner: codex
- scope/files: `src/capsule/generator.ts`
- acceptance criteria:
  - generator routes strategy by intent for pivot/BFS/selection behavior.
  - task-query focus terms reduce pivot flood.
- linked tests:
  - `npx vitest run tests/capsule/intent-routing.test.ts`
- status: done

### CWW4-P1-001
- owner: codex
- scope/files: `src/capsule/packer.ts`, `tests/capsule/story-packing.test.ts`
- acceptance criteria:
  - story packing mode groups by cluster/file and improves local completeness.
  - narrow intent keeps standard packing path.
- linked tests:
  - `npx vitest run tests/capsule/story-packing.test.ts`
- status: done

### CWW4-P1-002
- owner: codex
- scope/files: `src/capsule/generator.ts`, `tests/capsule/confidence-formula.test.ts`
- acceptance criteria:
  - confidence formula adapts by intent and module/story metrics.
  - narrow query scoring remains stable.
- linked tests:
  - `npx vitest run tests/capsule/confidence-formula.test.ts`
- status: done

### CWW4-P1-003
- owner: codex
- scope/files: `tests/integration/task-query-quality.test.ts`, `tests/integration/quality-baseline.json`
- acceptance criteria:
  - phase-2 thresholds are raised and passing.
  - baseline ratchet is updated upward.
- linked tests:
  - `npx vitest run tests/integration/task-query-quality.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

### CWW4-P0-007
- owner: codex
- scope/files: `src/capsule/query-decomposer.ts`, `tests/capsule/smart-decomposer.test.ts`
- acceptance criteria:
  - broad/task decomposition emits focused sub-queries with cluster targeting.
  - verb-driven task decomposition maps to meaningful code-area clusters.
- linked tests:
  - `npx vitest run tests/capsule/smart-decomposer.test.ts`
- status: done

### CWW4-P0-008
- owner: codex
- scope/files: `src/capsule/generator.ts`
- acceptance criteria:
  - broad/task intents run multi-pass orchestration with budgeted sub-passes.
  - fallback to single-pass remains safe when decomposition yields no candidates.
- linked tests:
  - `npx vitest run tests/capsule/multi-pass-generator.test.ts`
- status: done

### CWW4-P0-009
- owner: codex
- scope/files: `src/capsule/merger.ts`, `tests/capsule/merger.test.ts`
- acceptance criteria:
  - merged output deduplicates symbols and respects budget.
  - merged result preserves story completeness ordering.
- linked tests:
  - `npx vitest run tests/capsule/merger.test.ts`
- status: done

### CWW4-P1-004
- owner: codex
- scope/files: `src/capsule/formatter.ts`
- acceptance criteria:
  - multi-pass capsule header and cluster-group sections render clearly.
  - single-pass capsule formatting remains unchanged.
- linked tests:
  - `npx vitest run tests/capsule/formatter-multi-pass.test.ts`
- status: done

### CWW4-P1-005
- owner: codex
- scope/files: `tests/integration/task-query-quality.test.ts`, `tests/integration/quality-baseline.json`
- acceptance criteria:
  - phase-3 thresholds are raised and passing.
  - ratchet baseline is updated with improved broad/task scores.
- linked tests:
  - `npx vitest run tests/integration/task-query-quality.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

### CWW4-P0-010
- owner: codex
- scope/files: `src/mcp/session-lock.ts`, `src/mcp/server.ts`, `tests/core/session-lock.test.ts`
- acceptance criteria:
  - lock acquisition supports `primary|secondary` modes.
  - secondary server start is non-blocking.
- linked tests:
  - `npx vitest run tests/core/session-lock.test.ts`
- status: done

### CWW4-P0-011
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/capsule/session-context.ts`
- acceptance criteria:
  - non-critical capsule writes degrade gracefully on `SQLITE_BUSY`.
  - capsule generation still returns successfully under contention.
- linked tests:
  - `npx vitest run tests/integration/concurrent-agents.test.ts`
- status: done

### CWW4-P0-012
- owner: codex
- scope/files: `tests/integration/concurrent-agents.test.ts`, `bench/concurrent-stress.ts`
- acceptance criteria:
  - concurrent capsule generation at 10 workers has 0 user-visible errors.
  - stress report includes p50/p95/p99 and error-rate summary.
- linked tests:
  - `npx vitest run tests/integration/concurrent-agents.test.ts`
  - `npx tsx bench/concurrent-stress.ts`
- status: done

### CWW4-P2-001
- owner: codex
- scope/files: `src/db/connection.ts` (conditional)
- acceptance criteria:
  - connection pool added only if stress evidence requires it.
  - if skipped, rationale is documented in code comments and sprint tracker.
- linked tests:
  - `npx vitest run tests/integration/concurrent-agents.test.ts`
  - `npx tsx bench/concurrent-stress.ts`
- status: done
- implementation note:
  - skipped by design after stress evidence met target without a read-pool (`p95 47.45ms`, `0%` errors); avoided unnecessary complexity in the DB layer.

### CWW4-P0-013
- owner: codex
- scope/files: `tests/integration/task-query-quality.test.ts`, `tests/integration/quality-baseline.json`, `bench/cross-project-qa.ts`
- acceptance criteria:
  - final thresholds met (narrow 75%, broad 75%, task 70%, overall 73%).
  - concurrency targets met (10 agents, 0 errors, p95 < 50ms).
  - cross-project QA remains green with broad/task coverage.
- linked tests:
  - `npx vitest run tests/integration/task-query-quality.test.ts tests/integration/threshold-ratchet.test.ts tests/integration/concurrent-agents.test.ts`
  - `npx tsx bench/concurrent-stress.ts`
  - `npx tsx bench/cross-project-qa.ts`
  - `npx vitest run`
  - `npm run lint`
  - `npm run build`
- status: done

## Execution Order (Wave 4)
1. CWW4-P0-001, CWW4-P0-002, CWW4-P0-003, CWW4-P0-004
2. Parallel lanes after phase-1 harness:
   - intelligence lane: CWW4-P0-005, CWW4-P0-006, CWW4-P1-001, CWW4-P1-002, CWW4-P1-003, CWW4-P0-007, CWW4-P0-008, CWW4-P0-009, CWW4-P1-004, CWW4-P1-005
   - concurrency lane: CWW4-P0-010, CWW4-P0-011, CWW4-P0-012, CWW4-P2-001
3. Final integration gate: CWW4-P0-013

## Production Readiness Follow-up (2026-02-26, `main`)

## Scope
Close final production blockers on `main`:
- deterministic dependency resolution with plain `npm install`
- security vulnerability remediation from `npm audit`
- MCP quality/performance validation evidence on real indexed project data

### CWREADY-P0-001
- owner: codex
- scope/files: `package.json`, `package-lock.json`
- acceptance criteria:
  - `npm install` succeeds without `--legacy-peer-deps`.
  - watcher/runtime dependencies resolve cleanly from lockfile.
- linked tests:
  - `npm install`
  - `npm run lint`
  - `npm test`
  - `npm run build`
- status: done

### CWREADY-P0-002
- owner: codex
- scope/files: `package.json`, `package-lock.json`
- acceptance criteria:
  - high-severity audit finding on `@modelcontextprotocol/sdk` is removed.
  - repo audit status is clean.
- linked tests:
  - `npm audit --json`
- status: done

### CWREADY-P1-001
- owner: codex
- scope/files: `src/core/parser.ts`
- acceptance criteria:
  - parser language loader typings remain compatible with pinned `tree-sitter` line.
  - lint/build stay green.
- linked tests:
  - `npm run lint`
  - `npm run build`
- status: done

### CWREADY-P1-002
- owner: codex
- scope/files: `bench/token-reduction-test.ts`, integration test verification
- acceptance criteria:
  - measured token reduction on real-project benchmark remains significant.
  - MCP integration schema/capsule tests pass.
- linked tests:
  - `npx tsx bench/token-reduction-test.ts`
  - `npx vitest run tests/integration/capsule.test.ts tests/integration/mcp-tool-schema-compat.test.ts`
- status: done

## 10M Line Scale Plan (2026-02-26 Session)

Source reminder: [`docs/plans/2026-02-26-10m-line-scale.md`](../docs/plans/2026-02-26-10m-line-scale.md)

## Scope
Execute the 10M+ line scale plan in ticket form with strict red/green verification and lint/build evidence before moving ticket status to `done`.

Session execution context:
- branch: `feat/10m-line-scale`
- worktree: `/path/to/worktree`
- mode: `single-agent with awaiter sub-agents for long-running commands`

Verification addendum (2026-02-26, `feat/verify-10m-scale-audit`):
- A 15-agent verification swarm was run specifically against the nine 10M fixes and MCP runtime behavior.
- Verified implemented after execution + re-verification: CW10M-P0-001..004, CW10M-P1-001..004, CW10M-P2-001.
- Additional runtime defect fixed in-session: MCP schema compatibility crash (`keyValidator._parse is not a function`) via bound MCP tool registration and `zod/v3` schema alignment.
- Additional correctness defects fixed in-session:
  - `createSchema` now installs FTS sync triggers + rebuild so non-migration bootstrap paths keep `symbols_fts` synchronized.
  - MCP startup/shutdown lifecycle now has guarded cleanup for watcher/database paths.
  - Parallel indexing now prunes deleted files and tolerates failed worker batches without aborting successful batches.
- End-to-end gate completed: `npx vitest run`, `npm run lint`, and `npm run build` all pass on this branch.

## Ticket Backlog (10M)

### CW10M-P0-001
- owner: codex
- scope/files: `src/db/schema.ts`, `src/db/migrations.ts`, `src/db/queries/files.ts`, `src/core/types.ts`, `src/core/indexer.ts`, `tests/db/migrations.test.ts`, `tests/unit/db.test.ts`, `tests/unit/graph.test.ts`
- acceptance criteria:
  - Migration v2 creates `symbols_fts`.
  - `files` table has `mtime`.
  - Covering indexes (`idx_symbols_name_cov`, `idx_edges_src_cov`, related indexes) exist.
  - `FileRecord` + file query paths handle `mtime`.
- linked tests:
  - `npx vitest run tests/db/migrations.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P0-002
- owner: codex
- scope/files: `src/db/queries/symbols.ts`, `src/capsule/generator.ts`, `tests/db/symbols-fts.test.ts`
- acceptance criteria:
  - `symbolQueries.searchFTS()` exists and returns ranked matches.
  - Capsule pivot resolution removes global symbol-name scan (`getAllNames` + fuzzy loop) and uses FTS for 3+ char terms.
  - Short terms still resolve via exact-name fallback.
- linked tests:
  - `npx vitest run tests/db/symbols-fts.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P0-003
- owner: codex
- scope/files: `src/core/graph.ts`, `src/capsule/generator.ts`, `tests/core/lazy-bfs.test.ts`
- acceptance criteria:
  - `lazyBfsTraversal()` is exported and traverses via per-node edge queries.
  - Capsule phase-2 traversal uses lazy BFS rather than preloading full adjacency map.
  - Degree lookup in ranking no longer reads `adjacency.degree` from a full graph preload.
- linked tests:
  - `npx vitest run tests/core/lazy-bfs.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P0-004
- owner: codex
- scope/files: `src/core/watcher.ts`, `src/mcp/server.ts` (and call sites), `package.json`, `package-lock.json`, `tests/core/watcher-smoke.test.ts`
- acceptance criteria:
  - Watcher backend migrated to `@parcel/watcher`.
  - `startWatcher`/`stopWatcher` async contract adopted at call sites.
  - Smoke import test + typecheck/build pass.
- linked tests:
  - `npx vitest run tests/core/watcher-smoke.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P1-001
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/db/queries/files.ts`, `tests/core/incremental-index.test.ts`
- acceptance criteria:
  - Unchanged `mtime` path skips file read/parse.
  - Hash-equal with mtime drift updates mtime only.
  - Test validates unchanged-file fast path.
- linked tests:
  - `npx vitest run tests/core/incremental-index.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P1-002
- owner: codex
- scope/files: `src/core/parser-worker.ts`, `src/core/indexer.ts`, `tests/core/parallel-index.test.ts`
- acceptance criteria:
  - Parsing parallelized using worker threads.
  - SQLite writes remain on main thread.
  - Parallel index test passes.
- linked tests:
  - `npx vitest run tests/core/parallel-index.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P1-003
- owner: codex
- scope/files: `src/core/graph.ts`, `src/core/pagerank-worker.ts`, DB connection setup, post-index call site, `tests/core/background-pagerank.test.ts`
- acceptance criteria:
  - Centrality updates run in background worker.
  - DB connection supports WAL-mode concurrency.
  - Sync index path is no longer blocked by PageRank.
- linked tests:
  - `npx vitest run tests/core/background-pagerank.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P1-004
- owner: codex
- scope/files: `src/core/graph.ts`, `src/capsule/generator.ts`, `tests/core/scoped-bfs.test.ts`
- acceptance criteria:
  - Scoped lazy BFS can restrict traversal to pivot directory set.
  - Capsule traversal uses scoped mode when pivot directories are available.
- linked tests:
  - `npx vitest run tests/core/scoped-bfs.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P2-001
- owner: codex
- scope/files: `src/core/types.ts`, `src/db/queries/symbols.ts`, `src/capsule/generator.ts`, `tests/capsule/light-symbol.test.ts`
- acceptance criteria:
  - Light symbol record/query exists and omits full source in traversal-stage fetches.
  - Full source is fetched only for packed/rendered nodes.
  - Light-symbol tests pass.
- linked tests:
  - `npx vitest run tests/capsule/light-symbol.test.ts`
  - `npm run lint`
  - `npm run build`
- status: done

### CW10M-P2-002
- owner: codex
- scope/files: repo-wide verification and smoke checks
- acceptance criteria:
  - Full test suite passes.
  - Lint and build pass.
  - Migration path check for existing DBs succeeds.
  - Functional smoke verification recorded.
- linked tests:
  - `npx vitest run`
  - `npm run lint`
  - `npm run build`
- status: done

## Execution Order (10M)
1. CW10M-P0-001
2. CW10M-P0-002
3. CW10M-P0-003
4. CW10M-P0-004
5. CW10M-P1-001
6. CW10M-P1-002
7. CW10M-P1-003
8. CW10M-P1-004
9. CW10M-P2-001
10. CW10M-P2-002

---

## Scope
Execute Sprints 1-4 in `IMPLEMENTATION_PLAN.md` without shortcuts, with test evidence attached before any ticket is marked `done`.

Compatibility note: the runtime-stable parser versions for this environment are `tree-sitter@0.21.1`, `tree-sitter-c@0.23.2`, `tree-sitter-python@0.23.4`, `tree-sitter-rust@0.23.1`, `tree-sitter-javascript@0.23.1`, and `tree-sitter-php@0.23.11`.

## Ticket Backlog

### CW-P0-001
- owner: codex
- scope/files: `package.json`, `package-lock.json`, `src/core/queries/{go,rust,java,c,cpp,csharp,ruby,bash,php}.ts`
- acceptance criteria:
  - Exact parser dependencies installed for all planned languages.
  - All planned query files exist and export the required query constants.
- linked tests:
  - `npm test -- tests/unit/parser.test.ts`
  - `npm run build`
- status: done

### CW-P0-002
- owner: codex
- scope/files: `src/core/parser.ts`, `src/core/queries/index.ts`, `src/core/indexer.ts`, `tsup.config.ts`
- acceptance criteria:
  - New languages are fully registered in parser modules, extension map, query registry, index glob, and bundle externals.
  - `detectLanguage()` resolves all new extensions.
- linked tests:
  - `npm test -- tests/unit/parser.test.ts`
  - `npm run build`
- status: done

### CW-P0-003
- owner: codex
- scope/files: `tests/fixtures/sample.{go,rs,java,c,cpp,cs,rb,sh,php}`, `tests/unit/parser.test.ts`
- acceptance criteria:
  - Fixtures exist for every added language.
  - Parser unit tests cover language detection and non-empty symbols/imports/calls for each fixture.
- linked tests:
  - `npm test -- tests/unit/parser.test.ts`
- status: done

### CW-P0-004
- owner: codex
- scope/files: `src/core/graph.ts`, `src/db/queries/symbols.ts`, `tests/unit/graph.test.ts`
- acceptance criteria:
  - PageRank dangling node contribution is O(n) per iteration.
  - PageRank loads symbol IDs via projection, not full symbol rows.
- linked tests:
  - `npm test -- tests/unit/graph.test.ts`
- status: done

### CW-P0-005
- owner: codex
- scope/files: `src/core/graph.ts`, `src/capsule/generator.ts`, `tests/{unit/graph.test.ts,integration/capsule.test.ts}`
- acceptance criteria:
  - BFS traversal paths in graph/generator use a preloaded adjacency map from one edge scan.
  - No per-node edge DB query loop remains in BFS hot path.
- linked tests:
  - `npm test -- tests/unit/graph.test.ts tests/integration/capsule.test.ts`
- status: done

### CW-P1-001
- owner: codex
- scope/files: `src/utils/synonyms.ts`, `src/capsule/generator.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - Query expansion includes configured synonyms/aliases.
  - Lexical matching preserves stronger weight for original query terms.
- linked tests:
  - `npm test -- tests/integration/capsule.test.ts`
- status: done

### CW-P1-002
- owner: codex
- scope/files: `src/utils/directory-weights.ts`, `src/capsule/generator.ts`
- acceptance criteria:
  - Directory weight downranking is applied during ranking.
  - Default directory weight remains neutral (`1.0`).
- linked tests:
  - `npm test`
- status: done

### CW-P1-003
- owner: codex
- scope/files: `src/utils/tokens.ts`, `src/memory/search.ts`, `package.json`, `package-lock.json`, `tests/unit/tokens.test.ts`
- acceptance criteria:
  - Token counting uses `gpt-tokenizer` instead of char heuristics.
  - Token tests reflect deterministic behavior and budget checks.
- linked tests:
  - `npm test -- tests/unit/tokens.test.ts`
- status: done

### CW-P1-004
- owner: codex
- scope/files: `src/cli/commands/init.ts`
- acceptance criteria:
  - `cw init` creates `.claude/CLAUDE.md` when absent.
  - Existing `.claude/CLAUDE.md` is not overwritten.
- linked tests:
  - `npm test`
- status: done

### CW-P1-005
- owner: codex
- scope/files: `src/mcp/server.ts`, `src/mcp/tools/remember.ts`
- acceptance criteria:
  - `cw_remember` uses server session ID, not hardcoded `"current"`.
  - Session record exists before observation insert.
- linked tests:
  - `npm test`
- status: done

### CW-P2-001
- owner: codex
- scope/files: `src/index.ts`, `src/cli/commands/serve.ts`, `src/cli/commands/stop.ts` (new), docs/help text
- acceptance criteria:
  - `cw serve --daemon` starts detached process and writes PID file.
  - `cw stop` reads PID file and terminates daemon.
  - Foreground serve behavior remains unchanged.
- linked tests:
  - `npm test`
- status: done

## Execution Order
1. CW-P0-001
2. CW-P0-002
3. CW-P0-003
4. CW-P0-004
5. CW-P0-005
6. CW-P1-001
7. CW-P1-002
8. CW-P1-003
9. CW-P1-004
10. CW-P1-005
11. CW-P2-001

## Production Hardening Plan (2026-02-27, `feat/prod-hardening-2026-02-27`)

## Scope
Resolve the reported production blockers and long-tail quality gaps across indexing, graph computation, reindex tooling, watcher behavior, parser coverage, and DB lifecycle safety.

Execution rules:
- all fixes are test-first (red/green) with linked evidence before `done`.
- no ticket moves to `done` without command output evidence or explicit blocker note.
- ticket mapping source: reported issues C1-C5, I1-I11, N1-N11.

## Ticket Backlog

### CWHARDEN-P0-001
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/db/queries/symbols.ts`, `src/db/queries/files.ts`, `tests/core/indexer-edge-resolution.test.ts` (new)
- acceptance criteria:
  - `resolveEdges` no longer does unscoped global name fan-out for imports/calls.
  - import edges are resolved using file/module-local candidates first, with bounded fallback behavior.
  - edge count growth is near-linear on common-name imports.
- linked tests:
  - `npx vitest run tests/core/indexer-edge-resolution.test.ts`
  - `npx vitest run tests/core/parallel-index.test.ts`
- status: done

### CWHARDEN-P0-002
- owner: codex
- scope/files: `src/core/graph.ts`, `src/db/queries/edges.ts`, `tests/core/graph-streaming.test.ts` (new)
- acceptance criteria:
  - PageRank and adjacency builders avoid `edgeQueries(db).getAll()` materialization on hot paths.
  - graph operations stream/batch edges from SQLite with bounded memory.
  - no behavior regression in ranking outputs for existing tests.
- linked tests:
  - `npx vitest run tests/core/graph-streaming.test.ts`
  - `npx vitest run tests/integration/capsule.test.ts`
- status: done

### CWHARDEN-P0-003
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/db/queries/files.ts`, `tests/integration/capsule-pivot-filepath.test.ts` (new)
- acceptance criteria:
  - capsule pivot path matching no longer scans all file rows via `files.getAll()` on each query.
  - file-path lookup uses indexed prefiltering or bounded candidates.
  - ranking behavior for representative queries remains stable.
- linked tests:
  - `npx vitest run tests/integration/capsule-pivot-filepath.test.ts`
  - `npx vitest run tests/integration/capsule.test.ts`
- status: done

### CWHARDEN-P0-004
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/core/parser-worker.js`, `tests/core/parallel-index.test.ts`, `tests/unit/file-size-guard.test.ts`
- acceptance criteria:
  - worker fallback and worker-thread paths enforce `MAX_FILE_SIZE`.
  - oversized files produce explicit indexed error entries instead of crashes/oom.
  - normal files continue indexing unchanged.
- linked tests:
  - `npx vitest run tests/unit/file-size-guard.test.ts`
  - `npx vitest run tests/core/parallel-index.test.ts`
- status: done

### CWHARDEN-P0-005
- owner: codex
- scope/files: `src/db/connection.ts`, `src/core/watcher.ts`, `src/mcp/server.ts`, `src/mcp/session-lock.ts`, `tests/core/session-lock.test.ts`, `tests/unit/db-connection-isolation.test.ts`
- acceptance criteria:
  - DB/watcher lifecycle is safely isolated per project/session (no unsafe global singleton collisions).
  - concurrent server/session attempts do not corrupt or race symbol/edge writes.
  - explicit lock/guard behavior is documented and tested.
- linked tests:
  - `npx vitest run tests/core/session-lock.test.ts tests/unit/db-connection-isolation.test.ts`
  - `npx vitest run tests/integration/mcp-tool-schema-compat.test.ts`
- status: done

### CWHARDEN-P1-001
- owner: codex
- scope/files: `src/db/queries/observations.ts`, `tests/memory/observations-update.test.ts` (new)
- acceptance criteria:
  - observation `UPDATE` persists `note`.
  - reloaded observations keep modified note after restart.
- linked tests:
  - `npx vitest run tests/memory/observations-update.test.ts`
- status: done

### CWHARDEN-P1-002
- owner: codex
- scope/files: `src/mcp/tools/reindex.ts`, `src/cli/commands/reindex.ts`, `src/core/indexer.ts`, `tests/integration/reindex-directory.test.ts` (new)
- acceptance criteria:
  - MCP and CLI reindex accept file, directory, and whole-project paths.
  - directory inputs reindex all supported files under that directory.
  - invalid/out-of-root paths return explicit error.
- linked tests:
  - `npx vitest run tests/integration/reindex-directory.test.ts`
- status: done

### CWHARDEN-P1-003
- owner: codex
- scope/files: `src/core/parser.ts`, `src/core/indexer.ts`, `tests/unit/parser.test.ts`
- acceptance criteria:
  - `.mts` and `.cts` are recognized and indexed.
  - parser language mapping and discover glob include these extensions.
- linked tests:
  - `npx vitest run tests/unit/parser.test.ts`
- status: done

### CWHARDEN-P1-004
- owner: codex
- scope/files: `src/core/indexer.ts`, `tests/security/gitignore-filtering.test.ts`, `tests/security/cwignore-negation.test.ts` (new)
- acceptance criteria:
  - negated `!` entries in `.cwignore`/`.gitignore` re-include files correctly.
  - slash-containing negated patterns behave correctly.
- linked tests:
  - `npx vitest run tests/security/gitignore-filtering.test.ts tests/security/cwignore-negation.test.ts`
- status: done

### CWHARDEN-P1-005
- owner: codex
- scope/files: `src/core/indexer.ts`, `tests/core/discover-symlink-loop.test.ts` (new)
- acceptance criteria:
  - file discovery cannot hang on symlink cycles.
  - out-of-root symlinks remain excluded.
- linked tests:
  - `npx vitest run tests/core/discover-symlink-loop.test.ts`
- status: done

### CWHARDEN-P1-006
- owner: codex
- scope/files: `src/core/graph.ts`, `tests/integration/capsule.test.ts`, `tests/core/centrality-transaction.test.ts` (new)
- acceptance criteria:
  - centrality updates execute in a single transaction per run.
  - write lock duration is reduced and update behavior remains consistent.
- linked tests:
  - `npx vitest run tests/core/centrality-transaction.test.ts`
- status: done

### CWHARDEN-P1-007
- owner: codex
- scope/files: `src/core/graph.ts`, `tests/unit/batch-degree.test.ts`
- acceptance criteria:
  - `getBatchSymbolDegrees` avoids giant JSON payload approach.
  - large symbol-id batches are chunked/temporary-table based with stable output.
- linked tests:
  - `npx vitest run tests/unit/batch-degree.test.ts`
- status: done

### CWHARDEN-P1-008
- owner: codex
- scope/files: `src/db/connection.ts`, `src/cli/commands/status.ts`, `tests/db/connection-maintenance.test.ts` (new)
- acceptance criteria:
  - DB maintenance mode includes `auto_vacuum` and bounded vacuum strategy.
  - configurable max DB size guard reports warnings/errors before uncontrolled growth.
- linked tests:
  - `npx vitest run tests/db/connection-maintenance.test.ts`
- status: done

### CWHARDEN-P1-009
- owner: codex
- scope/files: `src/capsule/compressor.ts`, `src/utils/tokens.ts`, `tests/unit/tokens.test.ts`, `tests/capsule/compressor.test.ts` (new)
- acceptance criteria:
  - `estimateTokens` uses tokenizer-backed counting path.
  - token estimates better align with actual tokenization on TS/TSX snippets.
- linked tests:
  - `npx vitest run tests/unit/tokens.test.ts tests/capsule/compressor.test.ts`
- status: done

### CWHARDEN-P1-010
- owner: codex
- scope/files: `src/core/indexer.ts`, `tests/core/parallel-index.test.ts`
- acceptance criteria:
  - parse worker results with `parseResult=null` and no explicit error are surfaced in index errors.
  - silent drops are eliminated.
- linked tests:
  - `npx vitest run tests/core/parallel-index.test.ts`
- status: done

### CWHARDEN-P1-011
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/core/watcher.ts`, `tests/security/gitignore-filtering.test.ts`
- acceptance criteria:
  - broad `"env"` directory ignore is narrowed to avoid dropping legitimate `/src/env` paths.
  - ignore behavior is deterministic across OS path separators.
- linked tests:
  - `npx vitest run tests/security/gitignore-filtering.test.ts`
- status: done

### CWHARDEN-P2-001
- owner: codex
- scope/files: `src/core/watcher.ts`, `src/core/indexer.ts`, `tests/core/watcher-behavior.test.ts`
- acceptance criteria:
  - watcher reacts to `.gitignore`/`.cwignore` changes by triggering a re-filter/reindex pass.
  - files newly ignored are pruned from DB.
- linked tests:
  - `npx vitest run tests/core/watcher-behavior.test.ts tests/core/watcher-smoke.test.ts`
- status: done

### CWHARDEN-P2-002
- owner: codex
- scope/files: `src/core/watcher.ts`, `src/core/indexer.ts`, shared ignore constants export, `tests/core/watcher-behavior.test.ts`, `tests/security/gitignore-filtering.test.ts`
- acceptance criteria:
  - watcher/indexer built-in ignore patterns come from one shared source.
  - `.turbo`, `.tox`, and other patterns stay in parity.
- linked tests:
  - `npx vitest run tests/core/watcher-behavior.test.ts`
  - `npx vitest run tests/security/gitignore-filtering.test.ts`
- status: done

### CWHARDEN-P2-003
- owner: codex
- scope/files: `src/cli/commands/init.ts`, `tests/cli/init-close-db.test.ts` (new)
- acceptance criteria:
  - `runInit` always closes DB handle.
  - behavior matches other CLI commands.
- linked tests:
  - `npx vitest run tests/cli/init-close-db.test.ts`
- status: done

### CWHARDEN-P2-004
- owner: codex
- scope/files: `tests/unit/parser.test.ts`
- acceptance criteria:
  - parser tests cover empty file and malformed code behavior.
  - non-UTF8 input handling is tested and documented.
- linked tests:
  - `npx vitest run tests/unit/parser.test.ts`
- status: done

### CWHARDEN-P2-005
- owner: codex
- scope/files: `tests/unit/parser.test.ts`, `tests/fixtures/sample.{py,go,rs}`
- acceptance criteria:
  - fixtures include richer Python decorator, Go interface embedding, and Rust macro cases.
  - parser behavior over unusual AST shapes is asserted.
- linked tests:
  - `npx vitest run tests/unit/parser.test.ts`
- status: done

### CWHARDEN-P2-006
- owner: codex
- scope/files: `src/cli/commands/reindex.ts`, `tests/integration/reindex-directory.test.ts`
- acceptance criteria:
  - CLI `cw reindex <directory>` parity with MCP reindex directory behavior.
  - clear output for directory runs and error paths.
- linked tests:
  - `npx vitest run tests/integration/reindex-directory.test.ts`
- status: done

### CWHARDEN-P2-007
- owner: codex
- scope/files: `src/db/connection.ts`, `tests/unit/db-connection-isolation.test.ts`
- acceptance criteria:
  - DB singleton is isolated by path and resettable in tests.
  - test teardown cannot leak DB handle into subsequent test cases.
- linked tests:
  - `npx vitest run tests/unit/db-connection-isolation.test.ts`
- status: done

### CWHARDEN-P2-008
- owner: codex
- scope/files: `src/core/watcher.ts`, `tests/core/watcher-behavior.test.ts` (new)
- acceptance criteria:
  - watcher tests cover change->reindex, diff callback, stale propagation, and delete->remove.
  - existing smoke test remains green.
- linked tests:
  - `npx vitest run tests/core/watcher-smoke.test.ts tests/core/watcher-behavior.test.ts`
- status: done

### CWHARDEN-P2-009
- owner: codex
- scope/files: `src/core/indexer.ts`, `tests/core/discover-symlink-loop.test.ts`, `tests/integration/reindex-directory.test.ts`
- acceptance criteria:
  - file discovery avoids excessive memory/main-thread syscall overhead on large trees.
  - implementation remains deterministic and cancellation-safe.
- linked tests:
  - `npx vitest run tests/core/discover-symlink-loop.test.ts`
  - `npx vitest run tests/integration/reindex-directory.test.ts`
- status: done

### CWHARDEN-P2-010
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/core/parser-worker.js`, `tests/core/indexer-unsupported-language.test.ts`, parser extension checks in `tests/unit/parser.test.ts`
- acceptance criteria:
  - Swift/Kotlin support path is implemented or explicitly gated with deterministic diagnostics.
  - unsupported-language behavior is no longer silent.
- linked tests:
  - `npx vitest run tests/core/indexer-unsupported-language.test.ts tests/unit/parser.test.ts`
- status: done

### CWHARDEN-P2-011
- owner: codex
- scope/files: `src/core/indexer.ts`, `tests/security/gitignore-filtering.test.ts`
- acceptance criteria:
  - `shouldIgnore` handles root-level directories and cross-platform separators robustly.
  - false negatives/positives from fragile substring checks are eliminated.
- linked tests:
  - `npx vitest run tests/security/gitignore-filtering.test.ts`
- status: done

## Execution Order (CWHARDEN)
1. CWHARDEN-P0-001
2. CWHARDEN-P0-002
3. CWHARDEN-P0-003
4. CWHARDEN-P0-004
5. CWHARDEN-P0-005
6. CWHARDEN-P1-001
7. CWHARDEN-P1-002
8. CWHARDEN-P1-003
9. CWHARDEN-P1-004
10. CWHARDEN-P1-005
11. CWHARDEN-P1-006
12. CWHARDEN-P1-007
13. CWHARDEN-P1-008
14. CWHARDEN-P1-009
15. CWHARDEN-P1-010
16. CWHARDEN-P1-011
17. CWHARDEN-P2-001
18. CWHARDEN-P2-002
19. CWHARDEN-P2-003
20. CWHARDEN-P2-004
21. CWHARDEN-P2-005
22. CWHARDEN-P2-006
23. CWHARDEN-P2-007
24. CWHARDEN-P2-008
25. CWHARDEN-P2-009
26. CWHARDEN-P2-010
27. CWHARDEN-P2-011
