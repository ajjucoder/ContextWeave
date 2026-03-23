# Work Log: PR #1 Review Fixes

**Date:** 2026-03-13
**Branch:** feat/language-universal-v2
**Commit:** f536de5

## What was done

Resolved all 20 code review findings from the PR #1 review of the language-universal architecture v2.

## Bugs fixed

1. Removed unreachable dead guard in `src/capsule/generator.ts` (backfill loop)
2. Fixed double-counting of LSP fallback stats in `src/core/lsp-bridge.ts`
3. Wired `chanNames` filter into Rust tokio sender extraction in `src/core/event-edge-synthesis.ts`
4. Replaced fragile `indexOf` with index-based loop in `src/core/lsp-bridge.ts`

## Correctness improvements

5. Wired `meetsScoreThreshold` into followup/suggestedReads filters in `src/capsule/formatter.ts`
6. Removed `intent === "task"` guard so semantic validation fires for all intents in `src/capsule/generator.ts`
7. Filtered `importedClassIds` to class/interface symbols only in `src/core/indexer.ts`
8. Removed dead inner condition in `assignParentNames` in `src/core/parser.ts`

## Performance improvements

9. Cached LSP bridge in `src/mcp/tools/status.ts` to avoid `spawnSync` on every `cw_status` call
10. Lazy-initialized prepared statements in `src/memory/search.ts` (`autoPopulateFromCapsule`)

## Test quality improvements

11. Tightened confidence calibration thresholds (0.62/0.90) with implementation fix in `src/capsule/confidence.ts`
12. Added LSP stats accounting test verifying `lspHits + fallbacks + errors === totalRequests`
13. Fixed tautological noise-elimination test with distinct broad vs narrow queries
14. Added edge resolution assertions for qualified-name disambiguation
15. Replaced silent conditional with `expect().toBeDefined()` in Python decorator test
16. Added meaningful bounds assertion for camelCase recall test

## Style/DRY improvements

17. Extracted `lineNumberForOffset` to `src/frameworks/utils.ts` (removed from 10 plugins)
18. Removed code comments from `src/capsule/query-classifier.ts`
19. Removed unnecessary `as number` cast in `src/mcp/tools/stats.ts`
20. Separated `actix_route` from `axum_route` labels in `src/frameworks/plugins/axum.ts`

## Files created (new)

- `src/frameworks/utils.ts`
- `docs/work-logs/2026-03-13-pr1-review-fixes.md`

## Files modified (28)

- `src/capsule/confidence.ts`, `formatter.ts`, `generator.ts`, `query-classifier.ts`
- `src/core/event-edge-synthesis.ts`, `indexer.ts`, `lsp-bridge.ts`, `parser.ts`, `types.ts`
- `src/frameworks/plugins/` — all 10 plugins
- `src/mcp/tools/stats.ts`, `status.ts`
- `src/memory/search.ts`
- `tests/capsule/noise-elimination.test.ts`
- `tests/core/decorator-extraction.test.ts`, `lsp-bridge.test.ts`, `qualified-name-disambiguation.test.ts`
- `tests/memory/recall-quality.test.ts`
- `tests/unit/confidence-calibration.test.ts`

## Verification

- TypeScript: `tsc --noEmit` clean, 0 errors
- Tests: 172 files, 1050 passed, 0 failures
- Net diff: +93 / -126 lines (code got smaller)
