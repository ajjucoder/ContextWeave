# Sprint Progress

Date: 2026-03-14
Branch: codex/review-closure-sprint
Execution mode: single-agent
Source spec: `audits/IMPLEMENTATION_PLAN_END_TO_END.md` + `audits/IMPLEMENTATION_PLAN_REVIEW_REMEDIATION_V2.md`

## Ticket Status

| Ticket | Severity | Status | Summary | Evidence |
|---|---|---|---|---|
| `CW-P0-013` | P0 | todo | reopen exact-match dominance and same-name disambiguation failures | March 14 reviews still fail on `GET`, `ProductModel`, `main` |
| `CW-P0-014` | P0 | todo | reopen broad retrieval and budget-fill logic from field regressions | March 14 broad recall and utilization worsened versus March 10 |
| `CW-P0-015` | P0 | todo | reopen confidence calibration with ambiguity and layer-coverage gates | March 14 reviews still show HIGH confidence on wrong answers |
| `CW-P0-016` | P0 | review | linked session-scope and stats tests pass locally; external rerun evidence still missing | automated: `npx vitest run tests/integration/post-tool-use.test.ts tests/integration/mcp-navigation-tools.test.ts` passed on 2026-03-14; field note: local harness green, external reviewed repos not rerun in this session |
| `CW-P0-017` | P0 | todo | close runtime-edge gaps for `cw_flow` and `cw_impact` | March 14 reviews still fail on HTTP, Convex, Tauri, callback, WebSocket, artifact flow |
| `CW-P0-018` | P0 | review | fixed worktree-root ignore pollution so indexed fixtures and field harness no longer collapse to zero files | code: `src/core/indexer.ts`, `tests/core/index-pollution.test.ts`; automated: `npx vitest run tests/core/index-pollution.test.ts tests/memory/bootstrap-seeds.test.ts tests/field/review-regressions.test.ts` passed on 2026-03-14; field note: internal fixture harness green, external reviewed repos not rerun in this session |
| `CW-P0-019` | P0 | review | navigation/read/overview paths now verify cleanly after indexer fix; external rerun evidence still missing | automated: `npx vitest run tests/integration/mcp-navigation-tools.test.ts tests/unit/formatter-followup.test.ts tests/field/review-regressions.test.ts` passed on 2026-03-14; field note: internal fixture harness green, external reviewed repos not rerun in this session |
| `CW-P0-020` | P0 | review | parser and MCP server trust-surface tests pass locally; external rerun evidence still missing | automated: `npx vitest run tests/unit/parser.test.ts tests/integration/mcp-server.test.ts` passed on 2026-03-14; field note: no external parser/status/reindex rerun captured in this session |
| `CW-P1-011` | P1 | todo | fix overview semantics and intent classification | semantic architecture queries still drift or misclassify |
| `CW-P1-012` | P1 | todo | fix follow-up utility and text/structured parity | visible and structured follow-up suggestions still diverge or mislead |
| `CW-P1-013` | P1 | todo | make recall useful and demote passive telemetry | March 14 recall output is still mostly passive or empty |
| `CW-P1-014` | P1 | todo | add exact-symbol grep behavior and definition-first ranking | common-token grep still ranks imports and substrings ahead of definitions |
| `CW-P1-015` | P1 | in_progress | expand the field harness and keep closure reporting honest | plan and tracker rewritten around reopened sprint; external reruns still pending |

## Completion Summary

- P0: 0 / 8 done = 0.0%
- P1: 0 / 5 done = 0.0%
- P2: 0 / 0 done = 0.0%
- Overall: 0 / 13 done = 0.0%

## Session Evidence

- Planning docs updated:
  - `audits/IMPLEMENTATION_PLAN_END_TO_END.md`
  - `audits/IMPLEMENTATION_PLAN_REVIEW_REMEDIATION_V2.md`
  - `audits/SPRINT_PROGRESS.md`
- Code changes executed in the isolated worktree:
  - `src/core/indexer.ts`
  - `tests/core/index-pollution.test.ts`
- Root cause closed locally for the first batch:
  - ignore evaluation was treating ancestor `.worktrees` path segments as in-project pollution, causing worktree-rooted fixture repos to index `0` files
  - added a regression test proving a project rooted under `.worktrees/...` still indexes its own files
- Historical implementation evidence exists in git and prior tests, but it is not counted as sprint completion because the March 14 field reruns contradicted those closure claims.
- Full-suite baseline note:
  - `npm test` was already red before targeted fixes in this worktree (`27` failing files / `105` failing tests), so batch progress is tracked against linked ticket suites, not the unrelated full-suite baseline.

## Test Evidence

| Check | State | Evidence |
|---|---|---|
| First batch linked verification bundle | pass | `npx vitest run tests/integration/post-tool-use.test.ts tests/integration/mcp-navigation-tools.test.ts tests/core/index-pollution.test.ts tests/memory/bootstrap-seeds.test.ts tests/field/review-regressions.test.ts tests/unit/formatter-followup.test.ts tests/unit/parser.test.ts tests/integration/mcp-server.test.ts` -> 8 files passed, 99 tests passed on 2026-03-14 |
| Worktree-root regression | pass | `npx vitest run tests/core/index-pollution.test.ts` passed after adding the `.worktrees` root regression |
| Product tests | fail | `npm test` run at session start failed before targeted fixes (`27` failing files / `105` failing tests); not used as proof of first-batch completion |
| External field reruns | not run | required by `CW-P1-015` before any ticket can move to `done` |

## Blockers

- The active sprint cannot claim any remediation ticket as `done` until the matching external field reruns exist.
- The current repository does not contain the external review repos; field closure depends on re-running against those codebases or equivalent framework-matching repos.
- `CW-P0-016`, `CW-P0-018`, `CW-P0-019`, and `CW-P0-020` have fresh local automated evidence, but they remain `review` because this session did not produce external field-evidence artifacts.
- The repo-wide `npm test` baseline is still red outside the linked first-batch suites and must be handled separately from this sprint batch.

## Next Actions

1. Keep `CW-P1-015` open and capture external rerun evidence for the first-batch tickets before any move to `done`.
2. Start the next execution block with `CW-P0-013`, `CW-P0-014`, and `CW-P0-015`, preserving the rule that retrieval widening cannot land before tightening and confidence gating.
3. Re-run the repo-wide verification bundle after the next batch to see which non-batch failures remain unrelated versus newly addressed.
4. Only update completion math from ticket counts when a ticket reaches `done` with both automated evidence and external field evidence.
