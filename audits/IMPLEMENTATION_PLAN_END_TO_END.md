# ContextWeave Augment-Parity Implementation Plan

Date: 2026-03-08
Project code: CW
Owner: codex
Execution mode: single-agent

## Source Of Truth
- Primary spec and standing reminder: `research/IMPLEMENTATION_PLAN.md`
- This file is the ticketed execution plan required by the repo policy.
- `audits/SPRINT_PROGRESS.md` is the only source for completion math.

## Goal
Turn ContextWeave into a local-first, agent-grade context engine that closes the reviewed quality gaps and adds the missing semantic stack: AST-aware chunking, local embeddings, hybrid BM25+vector retrieval, stronger capsule orchestration, and production-grade benchmark/reporting.

## Architecture Summary
- Keep SQLite as the single local system of record for symbols, file summaries, chunks, embeddings, and retrieval telemetry.
- Add semantic capabilities in layers: chunking first, embeddings second, hybrid ranking third, then rework capsule orchestration on top of the stronger retrieval substrate.
- Ship bug fixes and operational gates before claiming parity. No ticket closes without linked verification evidence.

## Tech Stack
- Existing runtime: TypeScript, Node.js 22+, `better-sqlite3`, tree-sitter, MCP SDK, Vitest, tsup.
- New required libraries from the source spec:
  - `code-chunk`
  - `@huggingface/transformers`
  - `sqlite-vec`

## Verified Repo State On 2026-03-08
- The remaining semantic stack gaps are now narrower:
  - `code-chunk`, `@huggingface/transformers`, and `sqlite-vec` are installed.
  - `src/core/chunker.ts`, `src/core/embedder.ts`, `src/core/vector-store.ts`, and `src/core/embedding-runtime.ts` now exist.
  - `src/core/hybrid-ranker.ts` still does not exist.
  - Chunk embedding integration into the indexer and watcher is now complete; hybrid rank fusion remains open under `CW-P1-006`.
- Phase 0 was only partially complete before this session:
  - `src/core/indexer.ts` already had `backfillSummariesIfNeeded` and `backfillClustersIfNeeded`, but `src/mcp/server.ts` did not call them on startup.
  - `src/mcp/tools/search.ts` accepted `use_regex`, but `/pattern/` queries still went through literal ripgrep and brace globs were not expanded.
  - `src/hooks/post-tool-use.ts` still updated the globally latest capsule row rather than the active session row.
  - Bootstrap observations still seeded documentation-derived notes at high confidence and narrow capsules still rendered them.
- Newly completed in this session:
  - Session-scoped post-tool-use feedback.
  - Startup self-healing for derived artifacts.
  - Honest confidence caps using token utilization and pivot coverage.
  - Bootstrap documentation/convention separation in formatter output.
  - `cw_grep` regex normalization and brace-glob expansion.
  - Local MiniLM embedding wrapper via `src/core/embedder.ts`.
  - Same-database vector storage and cosine search via `src/core/vector-store.ts`.
  - Migration `v12` adding persistent `chunk_embeddings` storage.
  - Indexer and watcher embedding integration, including incremental re-embedding of changed chunks.
  - Project-configurable embedding model loading via `.contextweave/config.json`.

## Execution Rules
- Keep `research/IMPLEMENTATION_PLAN.md` in the active todo ledger until every ticket below is closed.
- Do not mark any ticket `done` without linked test evidence in `audits/SPRINT_PROGRESS.md`.
- Prefer bounded Phase 0 tickets first, then build the semantic stack in dependency order.
- Do not replace deterministic retrieval with semantic ranking until chunk persistence, embeddings, and vector search are verified.
- Preserve existing narrow-query wins while broadening retrieval quality.

## Active Todo Ledger
- Keep `research/IMPLEMENTATION_PLAN.md` open as the standing checklist.
- Finish the remaining Phase 0 gaps before moving deeper into the semantic stack.
- Keep the new semantic dependencies paired with their ticketed verification evidence.
- Keep new schema changes paired with migrations and focused tests.
- Keep benchmark and docs claims aligned with what actually ships.

## Dependency Order
- Phase 0 tickets can run immediately.
- `CW-P1-001` and `CW-P1-002` unblock all semantic work.
- `CW-P1-003` and `CW-P1-004` depend on chunk persistence.
- `CW-P1-006` depends on embeddings and vector search.
- `CW-P2-001` and `CW-P2-002` depend on the hybrid ranker.
- `CW-P2-003` through `CW-P2-006` depend on stable chunk/search primitives.

## Tickets

### P0 Blocking Bug Fixes

#### CW-P0-001
- owner: codex
- scope/files: `src/capsule/pivot-scorer.ts`, `src/capsule/generator.ts`, `tests/capsule/pivot-scorer.test.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - Exact symbol-name matches get a dominant boost.
  - CamelCase-equivalent matches and path-segment matches receive explicit secondary boosts.
  - Queries like `useDataLayer` return the exact symbol definition first.
- linked tests:
  - `npx vitest run tests/capsule/pivot-scorer.test.ts tests/integration/capsule.test.ts`
- status: todo

#### CW-P0-002
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/capsule/content-fallback.ts`, `tests/unit/content-fallback.test.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - Narrow exact-match queries skip the fallback explosion path.
  - Exact-match capsules stay constrained to the definition plus direct callers/callees.
- linked tests:
  - `npx vitest run tests/unit/content-fallback.test.ts tests/integration/capsule.test.ts`
- status: todo

#### CW-P0-003
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/capsule/packer.ts`, `tests/capsule/story-packing.test.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - Capsules refill when utilization is below 60% and target roughly 85% budget usage.
  - Skeletonized top-ranked symbols are expanded before unrelated filler is added.
- linked tests:
  - `npx vitest run tests/capsule/story-packing.test.ts tests/integration/capsule.test.ts`
- status: todo

#### CW-P0-004
- owner: codex
- scope/files: `src/capsule/confidence.ts`, `src/capsule/generator.ts`, `tests/capsule/confidence-5level.test.ts`, `tests/unit/confidence-calibration.test.ts`
- acceptance criteria:
  - Confidence is capped by token utilization, broad-query pivot count, and pivot coverage.
  - Confidence never exceeds `0.90` unless utilization and pivot coverage are both strong.
- linked tests:
  - `npx vitest run tests/capsule/confidence-5level.test.ts tests/unit/confidence-calibration.test.ts`
- status: done

#### CW-P0-005
- owner: codex
- scope/files: `src/db/queries/capsule-log.ts`, `src/hooks/post-tool-use.ts`, `tests/integration/post-tool-use.test.ts`
- acceptance criteria:
  - `post-tool-use` updates the active session capsule row when `session_id` is present.
  - Fallback lookup uses the latest row for the current `project_root`, not the global latest row.
- linked tests:
  - `npx vitest run tests/integration/post-tool-use.test.ts`
- status: done

#### CW-P0-006
- owner: codex
- scope/files: `src/memory/bootstrap.ts`, `src/capsule/formatter.ts`, `tests/memory/bootstrap-seeds.test.ts`, `tests/unit/formatter-followup.test.ts`
- acceptance criteria:
  - Bootstrap documentation/convention notes seed at low confidence.
  - Narrow code capsules suppress documentation and convention observations unless the query is explicitly documentation-focused.
  - Documentation/convention output is bounded when included.
- linked tests:
  - `npx vitest run tests/memory/bootstrap-seeds.test.ts tests/unit/formatter-followup.test.ts`
- status: done

#### CW-P0-007
- owner: codex
- scope/files: `src/utils/directory-weights.ts`, `src/utils/config.ts`, `src/core/file-summaries.ts`, `src/capsule/generator.ts`, `tests/unit/directory-costs.test.ts`
- acceptance criteria:
  - Runtime directories are upweighted and legacy/static/archive directories are downweighted per the source spec.
  - `.contextweave/config.json` supports `primaryDirs` and `archiveDirs`.
- linked tests:
  - `npx vitest run tests/unit/directory-costs.test.ts tests/core/file-summaries.test.ts`
- status: todo

#### CW-P0-008
- owner: codex
- scope/files: `src/core/parser.ts`, `tests/unit/parser.test.ts`
- acceptance criteria:
  - TSX files with benign JSX text parse errors are indexed as warnings instead of hard file errors.
  - Symbol extraction still succeeds for valid TSX with harmless JSX text edge cases.
- linked tests:
  - `npx vitest run tests/unit/parser.test.ts`
- status: todo

#### CW-P0-009
- owner: codex
- scope/files: `src/mcp/tools/search.ts`, `src/mcp/tools/path-filters.ts`, `tests/integration/mcp-navigation-tools.test.ts`
- acceptance criteria:
  - `/pattern/flags` queries are treated as regex consistently across backends.
  - Brace glob patterns like `**/*.{ts,tsx}` expand correctly.
- linked tests:
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: done

#### CW-P0-010
- owner: codex
- scope/files: `src/mcp/server.ts`, `src/core/file-summaries.ts`, `src/core/clusters.ts`, `tests/integration/mcp-server.test.ts`, `tests/core/backfill-derived-data.test.ts`
- acceptance criteria:
  - MCP startup schedules derived-data backfill for existing indexes after migrations.
  - Existing repos with empty `file_summaries` or `file_clusters` self-heal without a manual full reindex.
- linked tests:
  - `npx vitest run tests/integration/mcp-server.test.ts tests/core/backfill-derived-data.test.ts`
- status: done

### P1 Stabilization And Retrieval Foundation

#### CW-P1-001
- owner: codex
- scope/files: `package.json`, `src/core/chunker.ts`, `src/core/types.ts`, `tests/core/chunker.test.ts`
- acceptance criteria:
  - Add `code-chunk`.
  - Build AST-aware chunk generation with scope-chain and import-aware enrichment for supported languages.
  - Provide fallback chunking for unsupported languages still covered by ContextWeave.
- linked tests:
  - `npx vitest run tests/core/chunker.test.ts`
- status: done

#### CW-P1-002
- owner: codex
- scope/files: `src/db/schema.ts`, `src/db/migrations.ts`, `src/core/indexer.ts`, `src/core/chunker.ts`, `tests/core/indexer-chunks.test.ts`
- acceptance criteria:
  - Add a persistent `chunks` table in SQLite.
  - Indexing populates and refreshes chunk rows alongside symbols and file summaries.
- linked tests:
  - `npx vitest run tests/core/indexer-chunks.test.ts tests/db/migration-upgrade-path.test.ts`
- status: done

#### CW-P1-003
- owner: codex
- scope/files: `package.json`, `src/core/embedder.ts`, `src/core/types.ts`, `tests/core/embedder.test.ts`
- acceptance criteria:
  - Add `@huggingface/transformers`.
  - Local embedding pipeline runs `all-MiniLM-L6-v2` without API keys.
  - Embedding output is stable at 384 dimensions.
- linked tests:
  - `npx vitest run tests/core/embedder.test.ts`
- status: done

#### CW-P1-004
- owner: codex
- scope/files: `package.json`, `src/core/vector-store.ts`, `src/db/schema.ts`, `src/db/migrations.ts`, `tests/core/vector-store.test.ts`
- acceptance criteria:
  - Add `sqlite-vec`.
  - Vector storage and nearest-neighbor search live in the same SQLite database.
  - Schema and migration paths are upgrade-safe.
- linked tests:
  - `npx vitest run tests/core/vector-store.test.ts tests/db/migration-upgrade-path.test.ts`
- status: done

#### CW-P1-005
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/core/watcher.ts`, `src/core/embedder.ts`, `src/core/vector-store.ts`, `tests/core/indexer-embedding.test.ts`, `tests/core/watcher-behavior.test.ts`
- acceptance criteria:
  - Indexing embeds pending chunks after persistence.
  - Watcher updates re-embed only changed chunks incrementally.
  - Embedding model becomes configurable from project config.
- linked tests:
  - `npx vitest run tests/core/indexer-embedding.test.ts tests/core/watcher-behavior.test.ts`
- status: done

#### CW-P1-006
- owner: codex
- scope/files: `src/core/hybrid-ranker.ts`, `src/capsule/generator.ts`, `src/capsule/semantic-reranker.ts`, `src/mcp/tools/capsule.ts`, `tests/capsule/hybrid-ranker.test.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - Replace the lexical-only semantic reranker with BM25 + vector similarity + exact symbol match fused through RRF.
  - Capsule retrieval quality improves without breaking narrow exact reads.
- linked tests:
  - `npx vitest run tests/capsule/hybrid-ranker.test.ts tests/integration/capsule.test.ts`
- status: todo

### P2 Future-Proofing And Productization

#### CW-P2-001
- owner: codex
- scope/files: `src/capsule/intent-classifier.ts`, `src/capsule/generator.ts`, `src/capsule/formatter.ts`, `src/mcp/tools/capsule.ts`, `src/core/types.ts`, `tests/capsule/*.test.ts`
- acceptance criteria:
  - Capsule routing uses a rewritten intent classifier and structured output contract.
  - Follow-up reads are file-qualified and ranked per active query intent.
- linked tests:
  - `npx vitest run tests/capsule/*.test.ts`
- status: todo

#### CW-P2-002
- owner: codex
- scope/files: `src/core/weighted-bfs.ts`, `src/capsule/generator.ts`, `src/capsule/formatter.ts`, `tests/capsule/multi-pass-generator.test.ts`
- acceptance criteria:
  - Graph expansion happens after search, not before.
  - Query-aware follow-up ranking prefers the highest-value unresolved runtime surfaces.
- linked tests:
  - `npx vitest run tests/capsule/multi-pass-generator.test.ts tests/integration/capsule.test.ts`
- status: todo

#### CW-P2-003
- owner: codex
- scope/files: `src/core/file-summaries.ts`, `src/db/schema.ts`, `src/db/migrations.ts`, `tests/core/file-summaries.test.ts`
- acceptance criteria:
  - File summaries index body-aware features such as JSX text, SQL names, and API calls.
  - IDF suppression reduces repetitive low-signal terms in summaries and retrieval.
- linked tests:
  - `npx vitest run tests/core/file-summaries.test.ts`
- status: todo

#### CW-P2-004
- owner: codex
- scope/files: `src/core/pattern-detector.ts`, `src/memory/observations.ts`, `src/memory/search.ts`, `tests/core/pattern-detector.test.ts`, `tests/memory/*.test.ts`
- acceptance criteria:
  - Structural pattern detection identifies repeated conventions across files.
  - Repeated high-signal findings are promoted into reusable observations.
- linked tests:
  - `npx vitest run tests/core/pattern-detector.test.ts tests/memory/*.test.ts`
- status: todo

#### CW-P2-005
- owner: codex
- scope/files: `src/core/parser.ts`, `src/core/indexer.ts`, `src/mcp/tools/flow.ts`, `tests/core/dynamic-dispatch-edges.test.ts`, `tests/unit/flow.test.ts`
- acceptance criteria:
  - Flow tracing handles callbacks, dynamic dispatch, server actions, and import resolution more accurately.
  - Cross-boundary traces remain deduplicated and useful.
- linked tests:
  - `npx vitest run tests/core/dynamic-dispatch-edges.test.ts tests/unit/flow.test.ts`
- status: todo

#### CW-P2-006
- owner: codex
- scope/files: `bench/cross-project-qa.ts`, `bench/harness.ts`, `bench/run-project-qa.ts`, `bench/100k-harness.ts`, `README.md`, `CATALOG.md`, `CHANGELOG.md`, `research/augment-vs-contextweave.md`, `audits/PRODUCT_GRADE_RELEASE_CHECKLIST.md`
- acceptance criteria:
  - Benchmarks cover the five field reviews plus the new semantic stack honestly.
  - Token savings metrics are reported alongside first-pass correctness, not instead of it.
  - Public docs and the Augment comparison match the actual shipped capabilities.
- linked tests:
  - `npm run eval`
  - `npm run bench:product`
  - `npm run lint`
- status: todo

## Current Completion Snapshot
- P0 complete in this plan: 5/10
- P1 complete in this plan: 0/6
- P2 complete in this plan: 0/6
- Overall complete in this plan: 5/22

## Immediate Next Tickets
1. `CW-P0-001` exact-match boost in pivot ranking.
2. `CW-P0-002` exact-match fast path to suppress fallback explosion.
3. `CW-P0-003` token budget refill and late-stage expansion.
4. `CW-P0-007` directory weighting config knobs.
5. `CW-P0-008` TSX benign-error tolerance.
