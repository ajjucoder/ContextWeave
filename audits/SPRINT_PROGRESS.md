# Sprint Progress

Date: 2026-03-15
Branch: codex/review-closure-sprint
Execution mode: single-agent
Source spec: `audits/IMPLEMENTATION_PLAN_END_TO_END.md` + `audits/IMPLEMENTATION_PLAN_REVIEW_REMEDIATION_V2.md`

## Ticket Status

| Ticket | Severity | Status | Summary | Evidence |
|---|---|---|---|---|
| `CW-P0-013` | P0 | review | exact whole-symbol bonus, HTTP method boost, and same-name disambiguation now prioritize the intended pivot | automated: `pivot-scorer.test.ts` (15) + `review-regressions.test.ts` (24) passed on 2026-03-14; field note: local harness green, external rerun pending |
| `CW-P0-014` | P0 | review | broad retrieval now hard-excludes test/doc/vendor noise, uses layer-aware recovery, and refills with coherent file context | automated: `story-packing.test.ts` (10) + `threshold-ratchet.test.ts` (3) + `review-regressions.test.ts` (24) passed on 2026-03-15; field note: local harness green, external rerun pending |
| `CW-P0-015` | P0 | review | confidence is gated by layer coverage, ambiguity dispersion, and budget-underutilization warnings | automated: `confidence-calibration.test.ts` (38) + `threshold-ratchet.test.ts` (3) + `review-regressions.test.ts` (24) passed on 2026-03-14; field note: local harness green, external rerun pending |
| `CW-P0-016` | P0 | review | session-scoped post-tool updates and stats accounting are fixed locally | automated: `post-tool-use.test.ts` + `mcp-navigation-tools.test.ts` passed on 2026-03-14; field note: local harness green, external rerun pending |
| `CW-P0-017` | P0 | review | flow now prioritizes executable edges and impact falls back to direct dependent lookup when graph traversal would miss callers | automated: `flow.test.ts` (7) + `review-regressions.test.ts` (24) passed on 2026-03-15; field note: local harness green, external rerun pending |
| `CW-P0-018` | P0 | review | worktree-root indexing no longer collapses fixture and field repos under `.worktrees/...` | automated: `index-pollution.test.ts` + `bootstrap-seeds.test.ts` + `review-regressions.test.ts` passed on 2026-03-14; field note: local harness green, external rerun pending |
| `CW-P0-019` | P0 | review | file-qualified read and impact stay pinned to the requested file, and follow-up commands consistently use `path:` | automated: `formatter-followup.test.ts` (11) + `mcp-navigation-tools.test.ts` (15) + `review-regressions.test.ts` (24) passed on 2026-03-15; field note: local harness green, external rerun pending |
| `CW-P0-020` | P0 | review | parser/status/reindex trust-surface fixes remain locally verified | automated: `parser.test.ts` + `mcp-server.test.ts` passed on 2026-03-14; field note: local harness green, external rerun pending |
| `CW-P1-011` | P1 | review | intent classification now recognizes concept queries such as authentication and state management instead of forcing narrow-symbol handling | automated: `file-summaries.test.ts` (10) + `review-regressions.test.ts` (24) passed on 2026-03-15; field note: local harness green, external rerun pending |
| `CW-P1-012` | P1 | review | follow-up hints are capped at 3 entries and spill into a second file instead of stacking one file with low-value reads | automated: `formatter-followup.test.ts` (11) + `review-regressions.test.ts` (24) passed on 2026-03-15; field note: local harness green, external rerun pending |
| `CW-P1-013` | P1 | review | recall excludes passive telemetry by default and sharply demotes passive hits when explicitly included | automated: `recall-quality.test.ts` (24) + `observation-promotion.test.ts` (7) + `review-regressions.test.ts` (24) passed on 2026-03-14; field note: local harness green, external rerun pending |
| `CW-P1-014` | P1 | review | `cw_grep` now ranks definition sites first, marks them with `[def]`, and keeps regex/glob behavior intact | automated: `mcp-navigation-tools.test.ts` (15) passed on 2026-03-15; field note: local fixture harness green, external rerun pending |
| `CW-P1-015` | P1 | in_progress | closure reporting is honest again, but external reruns are still missing so no ticket can move to `done` | automated: `review-regressions.test.ts` (24) passed on 2026-03-15; blocker: reviewed external repos are not present in this workspace |

## Completion Summary

- P0: 0 / 8 done = 0.0%; 8 / 8 in review
- P1: 0 / 5 done = 0.0%; 4 / 5 in review, 1 / 5 in progress
- P2: 0 / 0 done = 0.0%
- Overall: 0 / 13 done = 0.0%; 12 / 13 locally verified and in review

## Session Evidence

- Branch work since `origin/codex/review-closure-sprint` now includes:
  - `fix(capsule): hard-exclude noise, add layer-aware retrieval, deepen refill (CW-P0-014)`
  - `fix(impact): add fallback edge lookup for false-negative dependents (CW-P0-017)`
  - `fix(capsule): expand broad signals for concept queries like state management (CW-P1-011)`
  - `fix(capsule): diversify follow-up read hints (CW-P1-012)`
  - the current uncommitted `CW-P0-019` + `CW-P1-014` work for file-qualified impact pinning and definition-first grep ranking
- New regression fixtures were added under `tests/fixtures/` to make grep ordering and file-qualified impact pinning observable in integration coverage.
- No ticket is marked `done` because the sprint still lacks external rerun artifacts against the reviewed codebases.

## Test Evidence

| Check | State | Evidence |
|---|---|---|
| Closure verification bundle | pass | `npx vitest run tests/capsule/story-packing.test.ts tests/integration/threshold-ratchet.test.ts tests/core/file-summaries.test.ts tests/unit/flow.test.ts tests/unit/formatter-followup.test.ts tests/integration/mcp-navigation-tools.test.ts tests/field/review-regressions.test.ts` -> 7 files, 80 tests passed on 2026-03-15 |
| Focused formatter regression | pass | `npx vitest run tests/unit/formatter-followup.test.ts` -> 1 file, 11 tests passed on 2026-03-15 |
| Focused navigation regression | pass | `npx vitest run tests/integration/mcp-navigation-tools.test.ts` -> 1 file, 15 tests passed on 2026-03-15 |
| Focused field regression | pass | `npx vitest run tests/field/review-regressions.test.ts` -> 1 file, 24 tests passed on 2026-03-15 |
| Prior batch verification | pass | 9 files, 142 tests passed, 0 failures on 2026-03-14 |
| Product baseline | fail | `npm test` remains red outside sprint scope with a pre-existing baseline of 27 failing files / 105 failing tests |
| External field reruns | not run | required before any ticket can move from `review` to `done` |

## Blockers

- The reviewed external repositories are not present in this workspace, so the sprint still lacks the field-evidence artifacts required for `done`.
- `npm test` remains red for unrelated pre-existing failures, so repo-wide green cannot be used as sprint closure evidence.

## Next Actions

1. Commit the remaining `CW-P0-019` and `CW-P1-014` code + audit updates.
2. Push `codex/review-closure-sprint` to `origin`.
3. Open the PR with explicit note that all remediation tickets are locally verified but still blocked on external rerun evidence for `done`.
