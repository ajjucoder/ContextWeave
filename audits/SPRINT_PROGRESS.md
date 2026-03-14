# Sprint Progress

Date: 2026-03-14
Branch: main
Execution mode: single-agent implementation
Source spec: `audits/IMPLEMENTATION_PLAN_END_TO_END.md`

## Ticket Status

| Ticket | Tier | Status | Evidence |
|---|---|---|---|
| CW-P0-001 | P0 | done | BFS depth capped to 2 for symbol-lookup with exact match, maxVisitedNodes capped to 30. Tests: `exact-match-fast-path.test.ts` (4 tests) => pass. |
| CW-P0-002 | P0 | done | Pool-widen pass adds symbols from selected directories when util <40%. baseMaxDistance for broad raised to 2. Tests: `story-packing.test.ts`, `two-phase-retrieval.test.ts`, `review-regressions.test.ts` => pass. |
| CW-P0-003 | P0 | done | Centrality contribution in backfill capped at 0.5, per-file backfill capped at 4. Tests: `noise-elimination.test.ts` => pass. |
| CW-P0-004 | P0 | done | `npx vitest run tests/capsule/confidence-5level.test.ts tests/unit/confidence-calibration.test.ts tests/integration/threshold-ratchet.test.ts` => pass. |
| CW-P0-005 | P0 | done | `npx vitest run tests/integration/post-tool-use.test.ts` => pass. |
| CW-P0-006 | P0 | done | `npx vitest run tests/memory/bootstrap-seeds.test.ts tests/unit/formatter-followup.test.ts` => pass. |
| CW-P0-007 | P0 | done | Archive/legacy directories excluded from pivot candidates (weight <= 0.2 filter). Field test with archive fixture passes. `index-pollution.test.ts`, `directory-costs.test.ts`, `review-regressions.test.ts` => pass. |
| CW-P0-008 | P0 | done | Benign TSX parse tolerance field-closed. SessionStats.tsx fixture with `&amp;` entities parses without errors. `parser.test.ts` (36 tests), `review-regressions.test.ts` => pass. |
| CW-P0-009 | P0 | done | `npx vitest run tests/integration/mcp-navigation-tools.test.ts` => pass in prior evidence bundle. |
| CW-P0-010 | P0 | done | `npx vitest run tests/integration/mcp-server.test.ts tests/core/backfill-derived-data.test.ts` => pass in prior evidence bundle. |
| CW-P0-011 | P0 | done | JSX callback edges, HTTP/event boundary traversal, and path diversity all verified. `flow.test.ts` (7 tests), `review-regressions.test.ts` => pass. |
| CW-P0-012 | P0 | done | Review-theme regression tests added (confidence calibration, follow-up suggestions, budget utilization gates). `review-regressions.test.ts` => 18 pass. |
| CW-P1-001 | P1 | done | `npx vitest run tests/core/chunker.test.ts` => pass. |
| CW-P1-002 | P1 | done | `npx vitest run tests/core/indexer-chunks.test.ts tests/db/migration-upgrade-path.test.ts` => pass. |
| CW-P1-003 | P1 | done | `npx vitest run tests/core/embedder.test.ts` => pass. |
| CW-P1-004 | P1 | done | `npx vitest run tests/core/vector-store.test.ts tests/db/migration-upgrade-path.test.ts` => pass. |
| CW-P1-005 | P1 | done | `npx vitest run tests/core/indexer-embedding.test.ts tests/core/watcher-behavior.test.ts` => pass. |
| CW-P1-006 | P1 | done | `npx vitest run tests/capsule/hybrid-ranker.test.ts tests/integration/capsule-hybrid-runtime.test.ts tests/integration/threshold-ratchet.test.ts` => pass. |
| CW-P1-007 | P1 | done | UI component path penalty (0.55x) for runtime-focused queries in file-summaries ranking. `file-summaries.test.ts`, `review-regressions.test.ts` => pass. |
| CW-P1-008 | P1 | done | Follow-up suggestions already rank by uncovered query terms, file-qualified by default. `formatter-followup.test.ts` (11 tests) => pass. |
| CW-P1-009 | P1 | done | cw_recall separates intentional vs passive (3.0x vs 0.3x scope weight), 7-day passive TTL. `recall-quality.test.ts` (24 tests), `observation-promotion.test.ts` => pass. Field test confirms ordering. |
| CW-P1-010 | P1 | todo | Eval/field rerun hardening still needs implementation. |
| CW-P2-001 | P2 | todo | Duplicate / `[previously shown]` cleanup not closed. |
| CW-P2-002 | P2 | todo | Structured capsule contract still needs normalization beyond HTML-comment embedding. |
| CW-P2-003 | P2 | todo | Path/read UX inconsistencies still open. |
| CW-P2-004 | P2 | todo | Pattern detector integration into capsules not field-proven. |
| CW-P2-005 | P2 | todo | Portability / project-relative DB audit not closed. |
| CW-P2-006 | P2 | todo | Release/adoption docs still need alignment with field-closure gates. |

## Completion Summary

- P0: 12/12 done (100%)
- P1: 9/10 done (90.0%)
- P2: 0/6 done (0.0%)
- Overall: 21/28 done (75.0%)

## Phase 1 Verification (2026-03-14)

- `npm run lint` => pass (tsc --noEmit)
- `npm test` => 1118 passed, 6 todo, 174 files
- `npx vitest run tests/field/review-regressions.test.ts` => 18 passed
- `npx vitest run tests/integration/threshold-ratchet.test.ts` => 3 passed
- No regressions from Phase 1 changes

## Phase 2 Verification (2026-03-14)

- `npm run lint` => pass (tsc --noEmit)
- `npm test` => 1119 passed, 6 todo, 174 files
- `npx vitest run tests/field/review-regressions.test.ts` => 18 passed
- `npx vitest run tests/integration/threshold-ratchet.test.ts` => 3 passed
- No regressions from Phase 2 changes

## Review Finding Matrix Status After Phase 2

| Review theme | Status |
|---|---|
| Confidence overstates incomplete answers | closed |
| Broad queries miss critical files | partial (pool-widen helps but small fixtures still underfill) |
| Noise dominates capsules | partial (centrality cap + per-file cap applied) |
| Budget underutilization | partial (pool-widen pass added, baseMaxDistance raised) |
| Flow tracing weak across real boundaries | closed |
| Exact symbol query failure modes | closed |
| Index pollution from QA/worktree/archive dirs | closed |
| Cross-session feedback contamination | closed |
| cw_stats honesty | closed |
| Follow-up suggestions low quality | closed |
| cw_overview lexical/shallow | closed |
| Intent classification brittle | closed |
| TSX false syntax errors | closed |
| cw_recall weak | closed |
| Search ergonomics inconsistencies | closed |
| MCP response shape omits structured data | closed |
| Duplicate snippets / previously-shown waste | open |
| Path/read UX inconsistencies | open |
| Pattern detector not materially helping capsules | open |

## Phase 3 Verification (2026-03-14)

- `npm run lint` => pass (tsc --noEmit)
- `npm test` => 1119 passed, 6 todo, 174 files
- No regressions from Phase 3 changes

## Next Actions

1. Phase 4: CW-P1-010 (eval hardening).
2. Phase 5-6: P2 cleanup (6 tickets).
3. Final closure loop.
