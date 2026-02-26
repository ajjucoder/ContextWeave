# ContextWeave End-to-End Implementation Plan (Ticketed)

Source reminder: root [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md)

## 10M Line Scale Plan (2026-02-26 Session)

Source reminder: [`docs/plans/2026-02-26-10m-line-scale.md`](../docs/plans/2026-02-26-10m-line-scale.md)

## Scope
Execute the 10M+ line scale plan in ticket form with strict red/green verification and lint/build evidence before moving ticket status to `done`.

Session execution context:
- branch: `feat/10m-line-scale`
- worktree: `/path/to/worktree`
- mode: `single-agent with awaiter sub-agents for long-running commands`

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
- status: todo

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
- status: todo

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
- status: todo

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
- status: todo

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
- status: todo

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
- status: todo

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
- status: todo

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

Compatibility note: the runtime-stable parser versions for this environment are `tree-sitter-c@0.23.6`, `tree-sitter-javascript@0.23.1`, and `tree-sitter-php@0.23.11`.

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
