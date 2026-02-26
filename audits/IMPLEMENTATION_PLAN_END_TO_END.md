# ContextWeave End-to-End Implementation Plan (Ticketed)

Source reminder: root [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md)

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
