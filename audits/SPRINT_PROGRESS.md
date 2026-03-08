# Sprint Progress

Date: 2026-03-08
Branch: main
Execution mode: single-agent
Source spec: `research/IMPLEMENTATION_PLAN.md`

## Ticket Status

| Ticket | Tier | Status | Evidence |
|---|---|---|---|
| CW-P0-001 | P0 | todo | No fresh evidence yet |
| CW-P0-002 | P0 | todo | No fresh evidence yet |
| CW-P0-003 | P0 | todo | No fresh evidence yet |
| CW-P0-004 | P0 | done | `npx vitest run tests/capsule/confidence-5level.test.ts tests/unit/confidence-calibration.test.ts` => pass; confidence recalibration also held under `npm test` => pass (710/710 tests) |
| CW-P0-005 | P0 | done | `npx vitest run tests/integration/post-tool-use.test.ts` => pass (2 tests) |
| CW-P0-006 | P0 | done | `npx vitest run tests/memory/bootstrap-seeds.test.ts tests/unit/formatter-followup.test.ts` => pass (13 tests) |
| CW-P0-007 | P0 | todo | No fresh evidence yet |
| CW-P0-008 | P0 | todo | No fresh evidence yet |
| CW-P0-009 | P0 | done | `npx vitest run tests/integration/mcp-navigation-tools.test.ts` => pass; whole suite remained green under `npm test` => pass (710/710 tests) |
| CW-P0-010 | P0 | done | `npx vitest run tests/integration/mcp-server.test.ts tests/core/backfill-derived-data.test.ts` => pass inside focused slice; `npm test` => pass (710/710 tests) |
| CW-P1-001 | P1 | done | `npx vitest run tests/core/chunker.test.ts` => pass (3 tests); `npm run lint` => pass; `npm test` => pass (710/710 tests) |
| CW-P1-002 | P1 | done | `npx vitest run tests/core/indexer-chunks.test.ts tests/db/migration-upgrade-path.test.ts tests/core/watcher-behavior.test.ts` => pass (19 tests); `npm test` => pass (710/710 tests) |
| CW-P1-003 | P1 | done | `npx vitest run tests/core/embedder.test.ts tests/core/vector-store.test.ts tests/db/migration-upgrade-path.test.ts` => pass (19 tests, includes `tests/core/embedder.test.ts`); `npm run lint` => pass; `npm test` => pass (146/146 files, 717/717 tests) |
| CW-P1-004 | P1 | done | `npx vitest run tests/core/embedder.test.ts tests/core/vector-store.test.ts tests/db/migration-upgrade-path.test.ts` => pass (19 tests, includes linked vector/migration files); `npm run lint` => pass; `npm test` => pass (146/146 files, 717/717 tests) |
| CW-P1-005 | P1 | done | `npx vitest run tests/core/indexer-embedding.test.ts tests/core/watcher-behavior.test.ts` => pass (11 tests); `npm run lint` => pass; `npm test` => pass (147/147 files, 720/720 tests) |
| CW-P1-006 | P1 | done | `npx vitest run tests/capsule/hybrid-ranker.test.ts tests/integration/capsule-hybrid-runtime.test.ts tests/integration/mcp-navigation-tools.test.ts` => pass (18 tests); `npx vitest run tests/integration/threshold-ratchet.test.ts` => pass (3 tests); `npm run lint` => pass; `npm test` => pass (149/149 files, 727/727 tests) |
| CW-P2-001 | P2 | todo | No fresh evidence yet |
| CW-P2-002 | P2 | todo | No fresh evidence yet |
| CW-P2-003 | P2 | todo | No fresh evidence yet |
| CW-P2-004 | P2 | todo | No fresh evidence yet |
| CW-P2-005 | P2 | todo | No fresh evidence yet |
| CW-P2-006 | P2 | todo | No fresh evidence yet |

## Completion Summary

- P0: 5/10 done (50.0%)
- P1: 6/6 done (100.0%)
- P2: 0/6 done (0.0%)
- Overall: 11/22 done (50.0%)

## Session Summary

- Replaced the older field-recovery/productization audit with a ticketed seven-phase plan tied directly to `research/IMPLEMENTATION_PLAN.md`.
- Closed two Phase 1 foundation tickets this session:
  - `CW-P1-001`: added `code-chunk`, introduced `src/core/chunker.ts`, normalized supported language mapping, and produced contextualized embedding chunks with scope/import/sibling metadata plus unsupported-language fallback.
  - `CW-P1-002`: added persistent SQLite `chunks` storage, migration `v11`, async chunk preparation in the indexer, backfill for legacy indexes, and chunk refresh on reindex.
- Closed the next two Phase 1 semantic-foundation tickets this session:
  - `CW-P1-003`: added `src/core/embedder.ts` with a local `Xenova/all-MiniLM-L6-v2` wrapper, stable 384-dimension validation, batch embedding support, and test injection hooks that avoid network dependence in the suite.
  - `CW-P1-004`: added `src/core/vector-store.ts`, migration `v12`, and persistent `chunk_embeddings` storage with `sqlite-vec`-powered cosine search in the same SQLite database.
- Closed the next Phase 1 integration ticket this session:
  - `CW-P1-005`: added `src/core/embedding-runtime.ts`, wired embedding generation into `src/core/indexer.ts`, `src/core/watcher.ts`, the CLI reindex path, and the MCP reindex/server flows, and made the embedding model configurable from project config for incremental changed-file re-embedding.
- Closed the final Phase 1 retrieval ticket this session:
  - `CW-P1-006`: added `src/core/hybrid-ranker.ts`, fused exact symbol matches + BM25 + vector similarity with RRF, wired hybrid retrieval into capsule and overview MCP flows, preserved lexical overview tail hits, seeded vector-only chunk matches back into symbol pivots, and added runtime-path regression coverage.
- Preserved the earlier five closed Phase 0 tickets and kept them green under the newer full-suite verification pass.
- Fixed two regressions uncovered by repo-wide verification:
  - updated the concurrent reindex worker to await async single-file indexing before DB shutdown.
  - broadened the eval fixture for database-query diagnostics to include the new `db/queries/chunks.ts` surface added by Phase 1.
- Fixed the remaining full-suite regression before closing `CW-P1-006`:
  - recalibrated confidence floors for structurally grounded broad/task capsules so the eval ratchet passes without weakening low-signal cases.

## Test Evidence

- `npx vitest run tests/integration/post-tool-use.test.ts tests/integration/mcp-server.test.ts tests/integration/mcp-navigation-tools.test.ts` => pass
  - 3 files, 16 tests
- `npx vitest run tests/capsule/confidence-5level.test.ts tests/unit/confidence-calibration.test.ts` => pass
  - 2 files, 21 tests
- `npx vitest run tests/unit/formatter-followup.test.ts tests/memory/bootstrap-seeds.test.ts` => pass
  - 2 files, 13 tests
- `npx vitest run tests/capsule/semantic-reranker.test.ts tests/field/review-regressions.test.ts tests/capsule/two-phase-retrieval.test.ts` => pass
  - 3 files, 24 tests
- `npx vitest run tests/core/chunker.test.ts tests/core/indexer-chunks.test.ts tests/db/migration-upgrade-path.test.ts tests/core/watcher-behavior.test.ts` => pass
  - 4 files, 22 tests
- `npx vitest run tests/core/embedder.test.ts tests/core/vector-store.test.ts tests/db/migration-upgrade-path.test.ts` => pass
  - 3 files, 19 tests
- `npx vitest run tests/core/indexer-embedding.test.ts tests/core/watcher-behavior.test.ts` => pass
  - 2 files, 11 tests
- `npx vitest run tests/capsule/hybrid-ranker.test.ts tests/integration/capsule-hybrid-runtime.test.ts tests/integration/mcp-navigation-tools.test.ts` => pass
  - 3 files, 18 tests
- `npx vitest run tests/integration/threshold-ratchet.test.ts` => pass
  - 1 file, 3 tests
- `npx vitest run tests/integration/concurrent-agents.test.ts` => pass
  - 1 file, 2 tests
- `npm run lint` => pass
  - `tsc --noEmit`
- `npm test` => pass
  - 149 files, 727 tests

## Pass/Fail State

- Ticket-slice verification for `CW-P1-001` through `CW-P1-006`: pass
- Whole-repo verification:
  - `npm run lint`: pass
  - `npm test`: pass
  - threshold ratchet: pass

## Blockers

- The repository contains many unrelated in-flight modifications outside the tickets completed here. They were not reverted and were treated as existing workspace state.
- Phase 0 is still incomplete; exact-match ranking, fallback suppression, directory weighting config, and TSX tolerance remain open.
- No open blockers for `CW-P1-006`; Phase 1 is now complete.

## Next Actions

1. Return to the remaining open Phase 0 tickets for exact-match prioritization, fallback suppression, directory weighting, and TSX tolerance.
2. Start `CW-P2-001` now that the hybrid ranker is stable under full-suite and retrieval-focused checks.
3. Keep future eval claims tied to `threshold-ratchet` and whole-suite evidence instead of isolated retrieval slices.
