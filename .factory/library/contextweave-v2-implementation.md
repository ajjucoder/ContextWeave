# ContextWeave v2: Comprehensive Implementation Plan

**What belongs here:** The full 50-item implementation plan for ContextWeave v2.

---

## Context

ContextWeave is a local-first MCP server for AST-aware context capsules with cross-session memory. A 3-agent code review identified 42 findings across security (all 7 fixed), architecture (5 open), code quality (9 open), and test coverage (8 open). Research into 3 external repos (code-graph-mcp, Dual-Graph/Codex-CLI-Compact, context-mode) and Augment Code's context engine revealed significant feature gaps that, if addressed, would put ContextWeave's retrieval quality in the same tier as commercial tools.

This plan covers: (1) fixing the 22 remaining audit findings, (2) adopting proven patterns from the 3 researched repos, and (3) building Augment-level capabilities within ContextWeave's local-first constraint.

---

## Part 1: Fix Open Audit Findings (22 items)

### Wave 1A — Architecture Fixes

**1. Decompose `generator.ts` (Finding #8)**
- File: `src/capsule/generator.ts` (2798 lines, 91+ nested closures)
- Extract into staged pipeline:
  - `src/capsule/pipeline/pivot-resolver.ts` — Phase 1: FTS/path/hybrid pivot resolution
  - `src/capsule/pipeline/graph-expander.ts` — Phase 2: BFS traversal + graph seeding
  - `src/capsule/pipeline/candidate-scorer.ts` — Phase 3: scoreNode, pruning, diversity
  - `src/capsule/pipeline/budget-filler.ts` — Phase 4: fallback cascade, refill, story-complete
  - `src/capsule/pipeline/types.ts` — shared `CapsuleContext` struct passed between stages
- `generateCapsule` becomes a thin orchestrator calling each stage in sequence
- Each stage is independently testable with a `CapsuleContext` fixture
- Move nested closures (`batchFetchOutgoingEdges`, `buildScoredNodes`, `pruneUiNoise`, `ensureBroadFileSpread`, etc.) to named exports in their respective stage files, taking `db` and `params` as explicit parameters

**2. Extract shared constants (Finding #9)**
- File: `src/capsule/signals.ts` (already exists, 43 lines)
- Move `RUNTIME_QUERY_TERMS`, `TYPE_DECLARATION_RE`, `TYPE_DECLARATION_PATH_RE`, `RUNTIME_CODE_PATH_RE` here
- Import in `generator.ts`, `pivot-scorer.ts`, `file-summaries.ts`
- Delete the 3 duplicate definitions

**3. Cache dynamic SQL statements (Findings #10, #11)**
- `batchFetchOutgoingEdges` (generator.ts:1666): Add `Map<number, Statement>` keyed on chunk size
- `getBatchSymbolDegrees` (graph.ts:236): Same pattern — `Map<number, Statement>` for outStmt/incStmt
- `getConnectedSymbols` (generator.ts:477): Move to WeakMap-cached pattern in `src/db/queries/edges.ts`
- Alternative: migrate all IN-list queries to `json_each(?)` with a single JSON parameter (eliminates variable placeholder counts entirely)

**4. Name remaining fallback thresholds (Finding #14 — partial)**
- In `generator.ts` fallback cascade (lines 1932-2200), replace remaining inline literals with named constants:
  ```
  const MULTI_PASS_FILL_THRESHOLD = 0.50;
  const DEEP_EXPAND_THRESHOLD = 0.75;
  const POOL_EXTRAS_THRESHOLD = 0.40;
  ```

**5. Add per-file parse timeout (Finding #16)**
- In `src/core/indexer.ts`, wrap tree-sitter `parser.parse()` calls with a timeout guard
- Use `setTimeout` + `Promise.race` pattern for async paths
- For sync paths in worker threads: tree-sitter supports `parser.setTimeoutMicros()` — use 5s default
- Skip file on timeout, log warning, continue indexing

**6. Migration rollback capability (Finding #17)**
- Add optional `down` function to `Migration` interface in `src/db/migrations.ts`
- Implement `rollbackMigration(db, targetVersion)` that runs `down()` in reverse order
- Not all migrations need `down` — only new ones going forward

### Wave 1B — Code Quality Fixes

**7. Token cache: proper LRU eviction (Finding #18)**
- File: `src/utils/tokens.ts`
- Replace FIFO eviction with batch eviction: when `size > limit`, delete oldest 10% (200 entries)
- Or switch to a proper LRU using Map's insertion-order property + move-to-end on access

**8. Add `observations(file_id)` index (Finding #19)**
- New migration v20 in `src/db/migrations.ts`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_observations_file ON observations(file_id);
  ```

**9. Extract `isSafeProjectPath` to shared utility (Finding #21)**
- Move to `src/mcp/tools/path-filters.ts` (already exists with `isPathWithinRoot`)
- Import in `read.ts` and `search.ts`, delete duplicate definitions

**10. Add debug logging to swallowed FTS catches (Finding #22)**
- `src/db/queries/symbols.ts:199-201`: Add `logger.debug("FTS search failed", { error })`
- `src/core/file-summaries.ts:379`: Same treatment

**11. Passive observation deduplication (Finding #23 — partial)**
- In `src/memory/passive.ts`, before `store.create()`:
  ```ts
  const existing = db.prepare("SELECT id FROM observations WHERE note = ? AND scope = ? AND archived = 0 LIMIT 1").get(note, scope);
  if (existing) return;
  ```

**12. Make passive TTL configurable (Finding #24)**
- In `src/utils/config.ts`, add `passiveTtlDays` to `ProjectConfig` with default 7
- In `src/memory/search.ts`, read from config instead of hardcoded `PASSIVE_TTL_MS`

**13. Derive `ParsedCall.edgeKind` from `EdgeKind` (Finding #27)**
- In `src/core/types.ts`, define `ParsedCallEdgeKind` as:
  ```ts
  type ParsedCallEdgeKind = Exclude<EdgeKind, "import" | "reexport" | "reference" | "event">;
  ```
- Use in `ParsedCall` interface

**14. Add automatic GC scheduling (Finding #28)**
- In `src/db/connection.ts`, after `maybeRunMaintenance`, set a `setInterval` for incremental vacuum every 30 minutes when the server is running as primary
- Guard with a flag to skip if maintenance is already running

**15. `mapRow` runtime validation helper (Finding #20)**
- Add `src/db/queries/row-validator.ts` with a `validateRow<T>(row, schema)` helper
- Apply to critical hot-path queries (symbol lookups, observation queries)
- Use lightweight runtime checks (`typeof field === "number"`) not full Zod

### Wave 1C — Test Coverage

**16. Framework plugin tests (Finding #30)**
- Create `tests/core/framework-plugins.test.ts`
- For each of the 10 untested plugins (django, spring, axum, rails, flask, fastapi, gin, convex, aspnet, celery-sidekiq, laravel):
  - Write a minimal fixture file with a known framework pattern
  - Index it
  - Assert the expected synthetic edge exists in DB
- ~15-20 lines per plugin, single test file

**17. `packer.ts` direct tests (Finding #32)**
- Create `tests/capsule/packer.test.ts`
- Test cases: budget exactly full, single oversized symbol, empty candidate list, all L0 fits, forced L3 degradation, promotion pass behavior

**18. `signals.ts` and `modes.ts` tests (Finding #33)**
- Create `tests/capsule/signals.test.ts` — verify signal term sets are non-empty, `isUiLikePath` returns expected results
- Create `tests/capsule/modes.test.ts` — verify mode weights exist for all 4 modes, weights sum correctly

**19. Fix misleading budget assertion (Finding #36)**
- In `tests/capsule/budget-filling.test.ts`, change the 0.85 test assertion from `> 0` to `>= 0.50` minimum

**20. FTS failure graceful degradation test (Finding #37)**
- Create test that corrupts/drops the FTS table, calls `searchFTS`, verifies it returns `[]` without throwing

**21. Re-index idempotency test (Finding #38)**
- Create `tests/core/reindex-idempotency.test.ts`
- Index a fixture project twice, assert identical symbol count, no duplicate symbol IDs

**22. Utils coverage (Finding #39)**
- `tests/utils/config.test.ts` — test `loadConfig` with valid, invalid, missing, and adversarial configs
- `tests/utils/directory-weights.test.ts` — test weight calculation for known directory patterns
- `tests/utils/project-profile.test.ts` — test profile detection for different project types
- `tests/utils/hash.test.ts` — test hash functions with known inputs

---

## Part 2: Adopt Patterns from External Repos

### Wave 2A — From code-graph-mcp: Graph Algorithm Expansion

**23. Betweenness centrality for impact scoring**
- File: `src/core/graph.ts`
- Implement Brandes' algorithm on the CSR adjacency (O(V*E), acceptable for <100k symbols)
- Store in `symbols` table: `ALTER TABLE symbols ADD COLUMN betweenness REAL DEFAULT 0`
- Use in `cw_impact` scoring: symbols with high betweenness are "bridge" nodes whose modification has outsized blast radius
- Run alongside PageRank in `runPageRankInBackground`

**24. Topological sort for `cw_flow`**
- File: `src/core/graph.ts`
- Implement Kahn's algorithm on the CSR adjacency
- Use in `cw_flow` to order callee chains correctly (dependency order, not discovery order)
- Expose as sorting option: `cw_flow({ source: "handleRequest", order: "topological" })`

**25. SCC detection for circular dependency warnings**
- File: `src/core/graph.ts`
- Implement Tarjan's algorithm for strongly connected components
- Surface circular dependencies as observations in `cw_capsule` output
- Add to `cw_stats` output: "N circular dependency clusters detected"

**26. Graph visualization export (`cw_export` tool)**
- New file: `src/mcp/tools/export.ts`
- Register `cw_export` MCP tool with format options: `dot`, `graphml`, `json`
- Query symbol/edge tables, emit formatted graph for external visualization (Gephi, VS Code)
- Support scope filtering by path/directory

**27. Code quality metrics in `cw_stats`**
- Extend `src/mcp/tools/stats.ts`
- Add composite quality score: `max(0, 100 - avgComplexity*5 - totalLines/1000)`
- Add dead code detection: `SELECT name FROM symbols WHERE is_exported = 0 AND id NOT IN (SELECT target_symbol_id FROM edges WHERE kind IN ('call', 'reference'))`
- Add large function warnings: symbols with `body_end - body_start > 100`

**28. Edge strength/weight field**
- New migration v21: `ALTER TABLE edges ADD COLUMN strength REAL DEFAULT 1.0`
- Set strength based on edge kind: `call` = 1.0, `import` = 0.8, `reference` = 0.6, `type_usage` = 0.4
- Use in BFS scoring: multiply BFS distance penalty by edge strength for more nuanced traversal

**29. Symbol visibility metadata**
- New migration v22: `ALTER TABLE symbols ADD COLUMN visibility TEXT DEFAULT 'public'`
- In `src/core/parser.ts`, detect `private`/`protected`/`internal` keywords per language
- Use in capsule scoring: deprioritize private symbols in cross-file expansion

### Wave 2B — From Dual-Graph: Budget & Confidence Controls

**30. Per-turn read budget enforcement**
- In `src/mcp/tools/read.ts`, add session-level character tracking
- Track cumulative characters returned per session via `session_context` table
- Default budget: 20,000 chars/turn (configurable)
- When budget exceeded, return truncated result with warning

**31. Confidence-tiered exploration caps**
- In `cw_capsule` structured output, include `confidence: "high" | "medium" | "low"` based on pivot match quality
- Include `recommended_supplementary_reads: N` in the output
- High confidence (10+ pivot score): 2 supplementary reads max
- Medium (4-9): 5 reads max
- Low (<4): 10 reads max + suggest broader query

**32. Symbol-level `cw_read` with `file::symbol` notation**
- Enhance `src/mcp/tools/read.ts` to accept `file_path::SymbolName` format
- Look up symbol's line range from DB, return only those lines
- Dramatically reduces token cost for reading specific functions from large files

### Wave 2C — From context-mode: Search & Truncation

**33. Reciprocal Rank Fusion for multi-index search**
- In `src/memory/search.ts`, when both Porter stemming and trigram results are available:
  ```
  RRF_score(doc) = 1/(K + rank_porter(doc)) + 1/(K + rank_trigram(doc))
  ```
  where K=60
- Replace current priority waterfall with RRF merge

**34. Proximity reranking**
- After BM25 scoring in capsule pivot resolution, add a proximity boost:
  - For each candidate, check if multiple query terms appear within 50 characters of each other
  - Apply 1.5x boost for co-located terms
- Cheap post-processing step, high precision impact for multi-term queries

**35. Smart truncation (60/40 head+tail split)**
- In `src/capsule/packer.ts`, for L1 compression (truncated bodies):
  - Keep first 60% of lines and last 40% of lines
  - Snap to line boundaries
  - Preserves return statements, error handling, and closing logic that current truncation loses

**36. Session resume snapshots (`cw_snapshot` tool)**
- New file: `src/mcp/tools/snapshot.ts`
- Register `cw_snapshot` MCP tool
- Queries recent session events (files read, symbols accessed, observations created)
- Returns a budget-capped (2048 token) structured summary:
  - Active files (last 10 with access counts)
  - Recent observations (top 5 by confidence)
  - Decisions made this session
- Useful for context restoration after compaction

### Wave 2D — Auto-Reindexing

**37. Debounced file watching with chokidar**
- New file: `src/core/watcher-v2.ts` (enhance existing `src/core/watcher.ts`)
- Use `chokidar` for cross-platform file watching
- Debounce: 2-second delay, cancel pending on new event, double-check elapsed before firing
- On file change: call `indexSingleFile` for the changed file
- On file delete: remove symbols and edges for that file
- Duplicate suppression: Set of recently processed files, cleared after 10s
- Auto-start when running as primary session

---

## Part 3: Augment-Level Capabilities

### Wave 3A — Hybrid Retrieval (BM25 + Embeddings) — THE HIGHEST-IMPACT CHANGE

**Why**: BM25 requires query terms to literally appear in the code. If a developer asks "where do we handle payment failures?" and the code has `catch (ChargeDeclinedException e)`, BM25 misses it. Embeddings find it because "payment failure" and `ChargeDeclinedException` are semantically close in a code-trained vector space. Augment's core advantage is here. Anthropic's own research shows BM25 + embeddings reduces retrieval failure rate by 67%.

**38. Embedding storage schema**
- New migration v23:
  ```sql
  CREATE TABLE symbol_embeddings (
    symbol_id INTEGER PRIMARY KEY REFERENCES symbols(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    model_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE chunk_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    text_hash TEXT NOT NULL,
    embedding BLOB NOT NULL,
    model_name TEXT NOT NULL
  );
  ```

**39. Local embedding runtime**
- New file: `src/core/embedding-models.ts`
- Support two modes:
  - **Local ONNX**: Use `@xenova/transformers` (runs in Node.js) with `nomic-embed-code` or `jina-embeddings-v3` (50-150M params, runs on CPU)
  - **Remote API**: OpenAI `text-embedding-3-small`, Jina, Voyage — for users who prefer faster/higher quality
- Config in `.contextweave/config.json`: `embeddingModel: "local:nomic-embed-code" | "openai:text-embedding-3-small" | "none"`
- Default: `"none"` (opt-in, preserves local-first philosophy)
- Batch embedding: process symbols in chunks of 64 during indexing

**40. Hybrid scoring in capsule pipeline**
- In the new `candidate-scorer.ts` (from Wave 1A decomposition):
  - After BM25 pivot selection generates N candidates
  - Embed the query
  - Compute cosine similarity against pre-computed embeddings for the candidate set
  - `final_score = 0.6 * bm25_score + 0.4 * cosine_similarity` (tunable per intent)
- For narrow/symbol-lookup queries: BM25 weight 0.8 (exact matches matter)
- For broad/task queries: embedding weight 0.6 (semantic relevance matters)

**41. Quantized vector storage (for scale)**
- For codebases with >50k symbols, implement 8-bit scalar quantization:
  - Store `Int8Array` instead of `Float32Array` in BLOB column
  - 4x storage reduction, <1% accuracy loss
  - Manual dot-product scan with SIMD-friendly layout

### Wave 3B — Commit History Indexing

**Why**: This answers "why" questions that no static analysis tool can handle. Local-first tools have an advantage here: full git history is available on-device with no data leaving the machine.

**42. Git commit storage schema**
- New migration v24:
  ```sql
  CREATE TABLE git_commits (
    hash TEXT PRIMARY KEY,
    author TEXT,
    timestamp INTEGER,
    message TEXT NOT NULL,
    summary TEXT,
    files_changed TEXT -- JSON array
  );
  CREATE INDEX idx_git_commits_ts ON git_commits(timestamp);

  CREATE TABLE git_commit_files (
    commit_hash TEXT NOT NULL REFERENCES git_commits(hash),
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL, -- 'A', 'M', 'D', 'R'
    PRIMARY KEY (commit_hash, file_path)
  );
  ```

**43. Git lineage indexer**
- New file: `src/core/git-lineage.ts`
- On index: run `git log --oneline --name-status` (fast, no diffs)
- Store each commit in `git_commits` table
- For commit summarization: use a template-based approach (no LLM dependency):
  - Extract: files changed, functions added/modified (from symbol diffs), conventional commit type
  - Generate: `"[type] Changed [functions] in [files] — [message first line]"`
- Optional: if user configures an LLM endpoint, use it for richer summaries

**44. Integrate git context into capsules**
- When query contains temporal/causal keywords ("why", "when", "history", "changed", "broke", "deprecated", "introduced", "who"):
  - Search `git_commits.summary` with BM25
  - Include top-3 relevant commits as observations in capsule output
- New `cw_history` tool: `cw_history({ file: "src/auth.ts", symbol: "handleLogin" })` returns commit history for that file/symbol

### Wave 3C — Cross-Encoder Reranking

**Why**: The current `scoreNode` formula is a multiplicative heuristic. A learned cross-encoder jointly reads (query, candidate) pairs and captures semantic relationships that heuristics cannot. This is the second-highest-impact retrieval improvement after embeddings.

**45. Cross-encoder integration**
- New file: `src/core/reranker.ts`
- Use `@xenova/transformers` with `bge-reranker-base` (ONNX, ~125M params, CPU-friendly)
- After stage-A retrieval (BM25 + graph BFS) produces N candidates:
  - Take top-80 candidates
  - Score each (query, candidate_text) pair with the cross-encoder
  - `final_score = alpha * stage_a_score + (1-alpha) * cross_encoder_score`
  - alpha = 0.4 for broad queries, 0.7 for narrow queries
- Config: `rerankerModel: "local:bge-reranker-base" | "none"` (opt-in)

### Wave 3D — Iterative Retrieval API

**Why**: Top retrieval systems (RepoCoder, RRR) use the LLM's partial output to re-query. ContextWeave can support this pattern with a simple API enhancement.

**46. `anchor_symbols` parameter for `cw_capsule`**
- Add to `cw_capsule` input schema: `anchor_symbols: z.array(z.string()).max(20).optional()`
- These become additional BFS seeds at distance=0 alongside query pivots, with 1.5x weight boost
- Enables agents to call `cw_capsule` iteratively: first call discovers symbols, second call anchors from them

**47. `discoveredSymbols` in structured output**
- In capsule structured output (`<!-- structured_output ... -->`), include:
  ```json
  { "discoveredSymbols": ["UserService", "validateEmail", "AuthMiddleware"], "confidence": "high", "recommended_reads": 2 }
  ```
- Agents can feed `discoveredSymbols` back as `anchor_symbols` in follow-up calls

### Wave 3E — Advanced Features

**48. Auto-suggest `cw_remember` calls**
- At the end of each capsule generation, if the query involves architectural patterns or decisions:
  - Include a suggested `cw_remember` call in the capsule observations
  - `"Consider: cw_remember({ scope: 'architecture', note: 'Auth uses JWT refresh tokens stored in HttpOnly cookies' })"`

**49. Markdown/doc auto-ingestion**
- During indexing, detect `*.md`, `docs/`, `ADR/` files
- Parse headings as "symbols", paragraphs as "bodies"
- Store in symbols table with `kind = 'documentation'`
- Include in BM25 search + embedding search
- Answers questions about project decisions without requiring explicit `cw_remember`

**50. Multi-repo symbol resolution**
- Allow `cw_reindex({ paths: ["../service-a", "../service-b"] })` to index multiple roots
- Merge symbol graphs under a shared edge table
- Cross-repo import resolution via framework plugins (API endpoint → handler mapping)
- Add `repo` column to `files` table to track source

---

## Execution Order

### Phase 1: Foundation (Waves 1A + 1B + 1C) — Audit Fixes
- Fix all 22 open findings
- Decompose generator.ts (prerequisite for all Wave 3 work)
- Add missing tests
- **DB migrations**: v20 (observations.file_id index)
- **Verification**: `npm test` all pass, `npm run eval` baseline maintained

### Phase 2: Graph & Search (Waves 2A + 2C) — External Repo Patterns
- Graph algorithm expansion (betweenness, SCC, topo sort)
- RRF search merge, proximity reranking, smart truncation
- New tools: `cw_export`, quality metrics in `cw_stats`
- **DB migrations**: v21 (edge strength), v22 (symbol visibility)
- **Verification**: New tests for each algorithm, eval baseline improvement

### Phase 3: UX & Control (Waves 2B + 2D) — Budget & Watching
- Per-turn budgets, confidence tiers, symbol-level reads
- Session snapshots, auto-reindexing
- **Verification**: Integration tests with budget enforcement

### Phase 4: Hybrid Retrieval (Wave 3A) — THE BIG LEAP
- Embedding storage, local ONNX runtime, hybrid scoring
- Quantized vectors for scale
- **DB migrations**: v23 (embedding tables)
- **Verification**: Retrieval quality eval comparing BM25-only vs hybrid

### Phase 5: History & Reranking (Waves 3B + 3C)
- Git commit indexing, `cw_history` tool
- Cross-encoder reranking
- **DB migrations**: v24 (git tables)
- **Verification**: Eval with "why" queries, precision improvement measurement

### Phase 6: Advanced (Waves 3D + 3E)
- Iterative retrieval API, auto-suggest memory, doc ingestion, multi-repo
- **Verification**: End-to-end eval across all features

---

## Verification Plan

After each phase:

1. **Unit tests**: `npm test` — all existing + new tests pass
2. **Eval suite**: `npm run eval` — quality baseline maintained or improved
3. **Field regressions**: `npm run test:field` — 5 fixture projects pass
4. **Scale benchmarks**: `npm run bench` — no regression at 100k file scale
5. **Manual QA**: Run ContextWeave against ContextWeave's own codebase, verify:
   - `cw_capsule("generator pipeline")` returns decomposed modules
   - `cw_impact("generateCapsule")` shows correct blast radius
   - `cw_flow("handleRequest")` shows topologically ordered chain
   - `cw_stats()` shows quality metrics
   - New tools (`cw_export`, `cw_history`, `cw_snapshot`) return expected output

---

## Key Files to Modify

### Core Pipeline (Phase 1)
- `src/capsule/generator.ts` — decompose into pipeline/
- `src/capsule/signals.ts` — consolidate constants
- `src/capsule/packer.ts` — smart truncation
- `src/core/graph.ts` — statement caching, new algorithms
- `src/core/indexer.ts` — parse timeout
- `src/core/types.ts` — ParsedCallEdgeKind derivation
- `src/db/migrations.ts` — v20-v24
- `src/db/connection.ts` — GC scheduling
- `src/db/queries/symbols.ts` — FTS error logging
- `src/utils/tokens.ts` — LRU fix
- `src/utils/config.ts` — passive TTL config
- `src/memory/passive.ts` — dedup check
- `src/memory/search.ts` — RRF, configurable TTL
- `src/mcp/tools/path-filters.ts` — shared isSafeProjectPath
- `src/mcp/tools/read.ts` — symbol-level reads, budget tracking
- `src/mcp/tools/stats.ts` — quality metrics

### New Files
- `src/capsule/pipeline/pivot-resolver.ts`
- `src/capsule/pipeline/graph-expander.ts`
- `src/capsule/pipeline/candidate-scorer.ts`
- `src/capsule/pipeline/budget-filler.ts`
- `src/capsule/pipeline/types.ts`
- `src/core/embedding-models.ts`
- `src/core/reranker.ts`
- `src/core/git-lineage.ts`
- `src/core/watcher-v2.ts`
- `src/db/queries/row-validator.ts`
- `src/mcp/tools/export.ts`
- `src/mcp/tools/snapshot.ts`
- `src/mcp/tools/history.ts`

### New Test Files
- `tests/core/framework-plugins.test.ts`
- `tests/core/reindex-idempotency.test.ts`
- `tests/capsule/packer.test.ts`
- `tests/capsule/signals.test.ts`
- `tests/capsule/modes.test.ts`
- `tests/capsule/pipeline/*.test.ts` (per-stage tests)
- `tests/utils/config.test.ts`
- `tests/utils/directory-weights.test.ts`
- `tests/utils/project-profile.test.ts`
- `tests/utils/hash.test.ts`
- `tests/core/graph-algorithms.test.ts`
- `tests/core/embedding-models.test.ts`
- `tests/core/git-lineage.test.ts`
- `tests/mcp/export.test.ts`
- `tests/mcp/snapshot.test.ts`
- `tests/mcp/history.test.ts`
- `tests/security/fts-degradation.test.ts`

---

## Summary: 50 Items Across 6 Phases

| Phase | Items | Focus |
|-------|-------|-------|
| 1 — Foundation | #1-#22 | Fix 22 open audit findings |
| 2 — Graph & Search | #23-#29 | Graph algorithms + search improvements |
| 3 — UX & Control | #30-#37 | Budgets, confidence, watching |
| 4 — Hybrid Retrieval | #38-#41 | Embeddings (highest impact feature) |
| 5 — History & Reranking | #42-#45 | Git lineage + cross-encoder |
| 6 — Advanced | #46-#50 | Iterative retrieval, docs, multi-repo |

**Expected outcome**: ContextWeave moves from a strong AST-graph + BM25 retrieval tool to a hybrid retrieval engine with graph analytics, embeddings, reranking, and commit history — matching Augment's architecture within the local-first constraint.
