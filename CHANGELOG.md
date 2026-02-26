# Changelog

All notable changes to ContextWeave are documented in this file.

## [Unreleased]

### Security

- **Path traversal protection**: `cw_reindex` and `indexSingleFile` now validate all paths against the project root via `isPathWithinRoot()`. Symlinks that resolve outside the project root are rejected.
- **File size guard**: Files larger than 5MB are skipped during indexing to prevent memory exhaustion.
- **.gitignore filtering**: `discoverFiles()` now parses the project's `.gitignore` and excludes matching files from indexing.
- **Sensitive file exclusion**: `.env*`, `credentials.json`, `secrets/`, `.pem`, and `.key` files are always excluded from indexing regardless of `.gitignore` configuration.
- **Input bounds validation**: All numeric MCP tool parameters are now bounded — `token_budget` (100–100,000), `depth` (1–20), `max_hops` (1–20), `limit` (1–500), `scope` (max 100 chars), `note` (max 10,000 chars).

### Fixed

- **BM25 TF normalization**: BM25 index now stores raw term frequency counts instead of pre-normalized values. Added separate `bm25_doc_lengths` table for accurate document length tracking. Fixed `avgdl` recalculation on observation removal. Search now uses the correct BM25 formula with actual document lengths.
- **Passive observations searchable**: Passive observations now route through `ObservationStore.create()` instead of raw SQL insert, ensuring they are indexed in BM25 and searchable via `cw_recall`.
- **DB corruption recovery**: On database corruption, the server now renames the corrupt file to `.corrupt.<timestamp>`, removes WAL/SHM files, and creates a fresh database instead of crashing.
- **Process crash handlers**: Added `uncaughtException` handler with graceful shutdown and `unhandledRejection` handler with logging to prevent silent process termination.
- **Per-tool error handling**: All 7 MCP tool callbacks are wrapped in try/catch with structured `isError: true` MCP responses instead of crashing the server.
- **Parser logging**: Silent `catch {}` blocks in `parseSymbols`, `parseImports`, and `parseCalls` now log debug-level warnings.
- **CLAUDE.md parameter names**: Fixed generated CLAUDE.md to use correct parameter names — `cw_impact({ target })`, `cw_flow({ source })`, `cw_reindex({ path })`.
- **symbolMap collision**: Changed from last-wins to first-wins deduplication for symbol name collisions during indexing.
- **config.ignore wiring**: `config.ignore` from `.contextweave/config.json` is now passed through to `discoverFiles()` and `indexProject()` in all callers (MCP reindex tool, CLI reindex, CLI init, auto-init). Previously it only applied to the file watcher.

### Added

- **`.cwignore` support**: Place a `.cwignore` file at the project root to exclude files and directories from indexing. Uses the same pattern syntax as `.gitignore` (glob patterns, negation with `!`, directory patterns with trailing `/`).

### Performance

- **Batch degree queries**: Added `getBatchSymbolDegrees()` using `json_each()` for O(2) SQL queries instead of O(2N) individual queries during capsule scoring.
- **Prepared statement caching**: `getSymbolDegree()` now caches prepared statements via WeakMap keyed on the database instance.

### Tests

- Added 38 new tests across 8 new test files:
  - `tests/security/path-traversal.test.ts` — path containment validation
  - `tests/security/gitignore-filtering.test.ts` — .gitignore and .env exclusion
  - `tests/security/input-bounds.test.ts` — Zod schema bound validation
  - `tests/unit/bm25-correctness.test.ts` — TF storage, doc length, avgdl, ranking
  - `tests/unit/db-corruption-recovery.test.ts` — corruption detection and recovery
  - `tests/unit/file-size-guard.test.ts` — file size limit enforcement
  - `tests/unit/batch-degree.test.ts` — batch vs individual degree consistency
  - `tests/integration/passive-observation-recall.test.ts` — passive observation searchability
