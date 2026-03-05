# ContextWeave — Project Catalog

Complete record of everything built, as of **2026-03-05** (commit `850120c`).

---

## What It Is

Local-first MCP server for Claude Code. Parses your codebase into an AST dependency graph via tree-sitter, serves token-budgeted context capsules on demand, and maintains cross-session memory with staleness tracking. Zero network calls. Registered globally — auto-connects in every project.

**The goal:** Replace expensive Grep + Explorer agent patterns with a single `cw_capsule` call that returns the right code in < 2000 tokens.

---

## MCP Tools (10 total)

| Tool | Description |
|------|-------------|
| `cw_capsule` | Token-budgeted context capsule for a query. Core tool. |
| `cw_impact` | Dependency blast radius — what breaks if you change a symbol |
| `cw_flow` | Incoming/outgoing call flow around a symbol |
| `cw_recall` | BM25 search over cross-session memory observations |
| `cw_remember` | Store a cross-session observation (primary session only) |
| `cw_status` | Index health: file/symbol/edge counts, stale observations, recent capsules |
| `cw_stats` | Session savings: capsules generated, tokens used vs estimated raw reads |
| `cw_overview` | High-level project overview with staleness indicators |
| `cw_files` | List indexed files with metadata, optional glob/path filter |
| `cw_grep` | ripgrep-backed content search with enclosing symbol annotation |
| `cw_read` | Read a file or file:symbol with AST-aware symbol extraction |
| `cw_reindex` | Re-index a file or directory (primary session only) |

---

## Architecture

```
cw serve (stdio MCP server)
  |
  ├── AST Parser (tree-sitter, 12 languages)
  |     └── Symbols, edges (calls/imports/inheritance/JSX), doc comments
  |
  ├── Dependency Graph (SQLite WAL)
  |     ├── symbols, edges, files, file_clusters, file_summaries
  |     └── PageRank centrality (background worker thread)
  |
  ├── Capsule Pipeline (7 phases)
  |     1. Query intent classification (narrow/broad/task)
  |     2. Query decomposition (multi-pass sub-queries)
  |     3. Pivot resolution (FTS5 trigram + fuzzy symbol match)
  |     4. Weighted BFS (edge-type-aware traversal costs)
  |     5. Scoring (centrality, directory weight, session boost, file summary)
  |     6. Compression + packing (story-mode, 3 compression levels)
  |     7. Observations injection + formatter
  |
  ├── Memory Engine (BM25 over SQLite)
  |     ├── Three-layer fuzzy search: Porter stemming → trigram → Levenshtein
  |     ├── Scope weights (architecture 3x, decision 2x, passive 0.3x)
  |     ├── Confidence decay + staleness propagation
  |     └── Passive observation auto-capture (post-tool-use hooks)
  |
  └── File Watcher (@parcel/watcher, native OS APIs)
        └── Incremental indexing on file change (mtime-based)
```

---

## Languages Supported

TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, C#, Ruby, Bash, PHP

---

## Database Schema (v7)

| Table | Purpose |
|-------|---------|
| `files` | Indexed files with path, language, symbol count, mtime, hash |
| `symbols` | Parsed symbols: name, kind, signature, body, centrality, is_exported |
| `edges` | Dependency edges: calls, imports, inheritance, JSX, type_usage, re-exports |
| `observations` | Cross-session memory notes with confidence, scope, staleness |
| `sessions` | MCP server sessions |
| `capsule_log` | Every capsule call: query, tokens used/budgeted, files/symbols included |
| `session_context` | Symbols returned per session for dedup boosting |
| `file_summaries` | Pre-computed file-level summaries with FTS index |
| `file_clusters` | Graph-based module clustering for scoped BFS |
| `bm25_index` | Stemmed term frequencies for observation search |
| `bm25_doc_lengths` | Document lengths for BM25 avgdl calculation |
| `bm25_stats` | BM25 global statistics (doc_count, avg_dl) |
| `schema_migrations` | Applied migration versions |

**FTS virtual tables:** `symbols_fts` (trigram), `file_summaries_fts` (trigram)

---

## Source Files

### Core (`src/core/`)
| File | Purpose |
|------|---------|
| `types.ts` | All shared TypeScript types |
| `parser.ts` | tree-sitter parser with pooling and statement caching |
| `indexer.ts` | File discovery, parallel indexing (worker_threads), incremental mtime check |
| `graph.ts` | Dependency graph queries: adjacency, PageRank, degree |
| `weighted-bfs.ts` | BFS with edge-type-aware traversal costs and maxHops cap |
| `clusters.ts` | Module clustering for file-scoped capsule retrieval |
| `file-summaries.ts` | Pre-computed file-level summary index |
| `watcher.ts` | @parcel/watcher integration for incremental indexing |
| `queries/` | Tree-sitter query strings for all 12 languages |

### Capsule Pipeline (`src/capsule/`)
| File | Purpose |
|------|---------|
| `generator.ts` | Orchestrates the 7-phase capsule pipeline |
| `generator-helpers.ts` | BFS scoping, cluster selection, fallback heuristics |
| `intent-classifier.ts` | Classifies query as narrow/broad/task |
| `query-decomposer.ts` | Breaks complex queries into focused sub-queries |
| `pivot-scorer.ts` | Multi-term pivot relevance scoring |
| `scorer.ts` | BFS node scoring: centrality, directory weight, session boost |
| `compressor.ts` | 3-level compression: full → trimmed → signature-only |
| `packer.ts` | Story-mode packing: fill by file cluster coherence |
| `merger.ts` | Merges sub-capsule results with dedup and priority |
| `session-context.ts` | Session-aware symbol dedup (previously-shown boosting) |
| `confidence.ts` | 5-level confidence formula from pivot quality |
| `diagnostics.ts` | Capsule quality diagnostics and bottleneck detection |
| `formatter.ts` | Renders final capsule text with observations |
| `modes.ts` | Mode-specific scoring weights (debug/refactor/feature/review) |

### Memory (`src/memory/`)
| File | Purpose |
|------|---------|
| `bm25.ts` | BM25 index with Porter stemming, trigram fallback, Levenshtein correction |
| `observations.ts` | ObservationStore: create/update/search with BM25 |
| `search.ts` | MemorySearch: scope weights + confidence blending over BM25 |
| `staleness.ts` | Confidence decay and staleness propagation |
| `passive.ts` | Auto-capture observations from post-tool-use hooks |

### Database (`src/db/`)
| File | Purpose |
|------|---------|
| `schema.ts` | Full schema DDL (tables, indexes, FTS, triggers) |
| `migrations.ts` | 7 versioned migrations with rollout safety |
| `connection.ts` | SQLite connection management (WAL mode, foreign keys) |
| `queries/files.ts` | File CRUD queries |
| `queries/symbols.ts` | Symbol queries including FTS, light queries |
| `queries/edges.ts` | Edge queries with covering indexes |
| `queries/observations.ts` | Observation CRUD, scope/stale queries |
| `queries/capsule-log.ts` | Capsule log insert and retrieval |
| `queries/sessions.ts` | Session lifecycle queries |

### MCP Tools (`src/mcp/tools/`)
| File | Tool |
|------|------|
| `capsule.ts` | `cw_capsule` |
| `impact.ts` | `cw_impact` |
| `flow.ts` | `cw_flow` |
| `recall.ts` | `cw_recall` |
| `remember.ts` | `cw_remember` |
| `status.ts` | `cw_status` |
| `stats.ts` | `cw_stats` |
| `overview.ts` | `cw_overview` |
| `files.ts` | `cw_files` |
| `ripgrep.ts` | `cw_grep` |
| `read.ts` | `cw_read` |
| `reindex.ts` | `cw_reindex` |
| `path-filters.ts` | Shared path/glob filtering for tools |
| `search.ts` | Symbol FTS search (used internally) |

### Utils (`src/utils/`)
| File | Purpose |
|------|---------|
| `stemmer.ts` | Porter Stemmer (5-step algorithm, pure TS) |
| `levenshtein.ts` | Levenshtein distance + nearest-term correction |
| `fuzzy.ts` | Trigram similarity and fuzzy symbol matching |
| `synonyms.ts` | Static synonym expansion map (14 entries) |
| `tokens.ts` | Exact cl100k_base token counting via gpt-tokenizer |
| `hash.ts` | File content hashing for mtime-based dedup |
| `logger.ts` | Structured logger |
| `config.ts` | `.contextweave/config.json` read/write |
| `directory-weights.ts` | Path-segment traversal cost weights |
| `path-retrieval.ts` | Project-relative path utilities |
| `tsconfig-paths.ts` | TypeScript path alias resolution from tsconfig.json |

---

## Test Suite (108 files, 471 tests)

### Security
- `tests/security/path-traversal.test.ts` — path containment validation
- `tests/security/gitignore-filtering.test.ts` — .gitignore / .env exclusion
- `tests/security/input-bounds.test.ts` — Zod schema bound validation
- `tests/security/mcp-read-path-guards.test.ts` — cw_read path guards
- `tests/security/cwignore-negation.test.ts` — .cwignore negation patterns

### Unit
- `tests/unit/stemmer.test.ts` — Porter Stemmer (idempotency, -ing/-ed/-tion/-ment/-ly)
- `tests/unit/levenshtein.test.ts` — Levenshtein distance + term correction
- `tests/unit/bm25.test.ts` — BM25 index, stemmed search, trigram/Levenshtein fallback
- `tests/unit/bm25-correctness.test.ts` — TF storage, avgdl correctness, ranking
- `tests/unit/stats.test.ts` — cw_stats aggregation, savings estimation, dedup
- `tests/unit/fuzzy.test.ts` — trigram similarity, fuzzy symbol matching
- `tests/unit/tokens.test.ts` / `tokens-estimate.test.ts` — token counting
- `tests/unit/scorer.test.ts` — capsule node scorer
- `tests/unit/graph.test.ts` — dependency graph queries
- `tests/unit/impact.test.ts` — blast radius analysis
- `tests/unit/flow.test.ts` — call flow tracing
- `tests/unit/parser.test.ts` — tree-sitter parsing
- `tests/unit/db.test.ts` / `db-connection-isolation.test.ts` / `db-corruption-recovery.test.ts`
- `tests/unit/batch-degree.test.ts` — batch degree query correctness
- `tests/unit/file-size-guard.test.ts` — file size limit enforcement
- `tests/unit/directory-costs.test.ts` — path weight scoring
- `tests/unit/confidence-calibration.test.ts` — confidence formula
- `tests/unit/overview-staleness.test.ts` / `read-file-symbol.test.ts` / `search-symbol-context.test.ts`
- `tests/unit/capsule-path-retrieval.test.ts`

### Capsule Pipeline
- `tests/capsule/generator.test.ts` — end-to-end capsule generation
- `tests/capsule/intent-classifier.test.ts` — query classification
- `tests/capsule/query-decomposer.test.ts` / `smart-decomposer.test.ts`
- `tests/capsule/pivot-scorer.test.ts` / `pivot-quality.test.ts`
- `tests/capsule/compressor.test.ts` / `packer.test.ts` / `story-packing.test.ts`
- `tests/capsule/merger.test.ts`
- `tests/capsule/session-context.test.ts` / `session-boost.test.ts`
- `tests/capsule/confidence-formula.test.ts` / `confidence-5level.test.ts`
- `tests/capsule/diagnostics.test.ts`
- `tests/capsule/formatter-multi-pass.test.ts` / `multi-pass-generator.test.ts`
- `tests/capsule/bounded-query.test.ts` / `dedup.test.ts` / `file-summary.test.ts`
- `tests/capsule/two-phase-retrieval.test.ts` / `intent-routing.test.ts`
- `tests/capsule/capsule-path-filter.test.ts` / `light-symbol.test.ts`

### Core
- `tests/core/lazy-bfs.test.ts` / `scoped-bfs.test.ts` / `bfs-maxhops.test.ts`
- `tests/core/incremental-index.test.ts` / `reindex-prune.test.ts` / `reindex-directory.test.ts` / `reindex-directory-prune.test.ts`
- `tests/core/parallel-index.test.ts` / `parser-pool.test.ts`
- `tests/core/background-pagerank.test.ts` / `centrality-transaction.test.ts`
- `tests/core/watcher-smoke.test.ts` / `watcher-behavior.test.ts`
- `tests/core/indexer-edge-resolution.test.ts` / `indexer-unsupported-language.test.ts`
- `tests/core/jsx-edges.test.ts` / `edge-kinds.test.ts` / `path-alias.test.ts`
- `tests/core/barrel-reexports.test.ts` / `framework-entry-edges.test.ts`
- `tests/core/clusters.test.ts` / `file-summaries.test.ts`
- `tests/core/backfill-derived-data.test.ts`
- `tests/core/graph-streaming.test.ts` / `is-exported-lang.test.ts`
- `tests/core/discover-symlink-loop.test.ts`
- `tests/core/session-lock.test.ts`

### Database
- `tests/db/migrations.test.ts` — all 7 migrations + upgrade path safety
- `tests/db/schema-fts-sync.test.ts` — FTS trigger correctness
- `tests/db/symbols-fts.test.ts` / `symbol-search-ci.test.ts` / `symbol-queries-light.test.ts`
- `tests/db/file-queries.test.ts` / `connection-maintenance.test.ts` / `query-cache.test.ts`

### Memory
- `tests/memory/observations-update.test.ts`
- `tests/memory/recall-scope-weight.test.ts`

### Integration
- `tests/integration/capsule.test.ts` — full pipeline integration
- `tests/integration/self-confidence.test.ts` — capsule quality on ContextWeave itself
- `tests/integration/session-intelligence.test.ts` — multi-query session awareness
- `tests/integration/task-query-quality.test.ts` — real task query acceptance tests
- `tests/integration/passive-observation-recall.test.ts`
- `tests/integration/capsule-pivot-filepath.test.ts`
- `tests/integration/reindex-directory.test.ts`
- `tests/integration/concurrent-agents.test.ts` — multi-session concurrency
- `tests/integration/mcp-navigation-tools.test.ts` / `mcp-tool-schema-compat.test.ts`

### MCP
- `tests/mcp/concurrent-lock.test.ts` — session lock correctness
- `tests/mcp/ripgrep-search.test.ts` — cw_grep output

### CLI
- `tests/cli/init-close-db.test.ts` / `cwignore-template.test.ts`

---

## Feature Waves

### Foundation (commits: `8d58e91` → `4d3f474`)
Initial scaffolding: core types, SQLite schema, tree-sitter parser (TS/JS), indexer, dependency graph, file watcher (chokidar), 7 MCP tools, CLI commands, BM25 memory engine, passive observation capture, capsule pipeline with 4-level compression. 49 tests.

### Wave 1 — Scale + Performance (`3f70269` → `089bf30`)
- Replaced chokidar with @parcel/watcher (native OS APIs, handles 500k+ files)
- mtime-based incremental indexing — skip unchanged files on re-index
- Parallel file indexing via worker_threads
- Background PageRank via worker thread — index no longer blocks
- Lazy BFS edge loading — per-node queries instead of full adjacency map preload
- FTS5 trigram search for symbol pivot resolution (replaced getAllNames+fuzzyMatch)
- Migration v2: FTS5 table, mtime column, covering indexes

### Wave 2 — Production Hardening (`546da01` → `5e7cffd`)
- Path traversal protection, file size guard, .gitignore filtering, sensitive file exclusion
- Input bounds validation on all MCP parameters
- BM25 TF normalization fix, avgdl recalculation fix
- DB corruption detection and automatic recovery
- uncaughtException / unhandledRejection handlers
- Per-tool error handling with structured MCP error responses
- `.cwignore` file support

### Wave 3 — Capsule Quality (`7bb75c8` → `38ee6a5`)
- Multi-term pivot relevance scorer
- Weighted BFS with edge-type-aware traversal costs (calls 1x, imports 1.5x, etc.)
- File-level summary index with FTS for two-phase retrieval
- Module clustering for file-scoped BFS
- Session-aware pivot boosting for follow-up queries
- Query decomposition for complex multi-term queries
- Symbol dedup across session (previously-shown suppression)
- Confidence formula rewrite with relevant pivot quality weighting
- `maxQueryTimeMs` bounded early termination
- barrel file re-export edge tracking

### Wave 4 — Explorer Killer (`1ef8c7e` → `abda3de`)
- Query intent classification (narrow/broad/task)
- Smart query decomposer with sub-query merging (story-complete packing)
- Multi-pass capsule strategy: sub-capsule generation + merger
- Concurrency: WAL-based multi-session with non-blocking lock
- Navigation tools: `cw_overview`, `cw_files`, `cw_grep` (ripgrep-backed), `cw_read`
- TypeScript path alias resolution from tsconfig.json
- Staleness indicators in `cw_overview`, file:symbol format in `cw_read`
- End-to-end quality harness with ratchet baseline
- `cw_grep` annotates results with enclosing symbol name/kind
- Path/glob capsule filters (`path`, `glob` params on `cw_capsule`)
- Language-aware `isExported` detection

### Wave 5 — Fuzzy Search + Stats (`d99f7e6` → `850120c`)
Inspired by [claude-context-mode](https://github.com/mksglu/claude-context-mode).
- Porter Stemmer (pure TS, 5-step, `src/utils/stemmer.ts`) — "caching"/"cached"/"caches" all resolve to same stem
- Levenshtein distance + term correction (`src/utils/levenshtein.ts`) — typos like "kuberntes" → "kubernetes"
- Three-layer BM25 fallback in `searchWithFallback()`:
  - Layer 1: Stemmed BM25 (always runs)
  - Layer 2: Trigram substring expansion (on < minResults)
  - Layer 3: Levenshtein correction (on < minResults after Layer 2)
- Refactored to clean linear cascade (no duplicated logic)
- `reindexAll()` wrapped in transaction for crash safety
- Migration v7: re-indexes all existing observations with stemmed tokens
- New `cw_stats` MCP tool: session capsule count, tokens used vs budgeted, unique files/symbols, estimated context savings vs raw file reads
- 13 new commits, 471 tests passing

---

## Open-Source Readiness

- License: MIT (`LICENSE`)
- `SECURITY.md`, `CODE_OF_CONDUCT.md`
- No personal identifiers in source or commit messages
- No hardcoded paths or project-specific values
- `.contextweave/` is `.gitignore`d (per-project DB, never committed)
- Global registration in `~/.claude/settings.json` — documented in README

---

## Performance Benchmarks

| Project | Language | Files | Symbols | Index time |
|---------|----------|-------|---------|-----------|
| ebps | Python | 55 | 844 | 719ms |
| Nudgy | Rust+TSX | 16 | 65 | 1152ms |
| codex-team-orchestrator | TypeScript | 237 | 3148 | 4238ms |
| polymarket | TypeScript | 100 | 717 | 1866ms |

Token reduction: 78%+ in benchmarks vs raw file read approach.

---

## Global Setup

```bash
# Binary
/Users/aejjusingh/Developer/ContextWeave/dist/index.js

# Registered in
~/.claude/settings.json  (mcpServers.contextweave)

# Per-project DB
<projectRoot>/.contextweave/contextweave.db

# Auto-init on first serve
runServe() → autoInit() if .contextweave/ missing
```
