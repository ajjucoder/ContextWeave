# Sprint Progress

Date: 2026-03-17
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

- P0: 8 / 8 in review (all code landed, all linked tests green)
- P1: 4 / 5 in review, 1 / 5 in progress (CW-P1-015 — closure reporting)
- Overall: 12 / 13 locally verified and in review, 1 in progress
- Blocker to `done`: external field reruns on reviewed codebases not yet executed

## Session Evidence

- All sprint commits landed on `codex/review-closure-sprint`:
  - `fix(capsule): hard-exclude noise, add layer-aware retrieval, deepen refill (CW-P0-014)`
  - `fix(impact): add fallback edge lookup for false-negative dependents (CW-P0-017)`
  - `fix(capsule): expand broad signals for concept queries like state management (CW-P1-011)`
  - `fix(capsule): diversify follow-up read hints (CW-P1-012)`
  - `fix(mcp): rank grep definitions and pin file-qualified impacts (CW-P0-019, CW-P1-014)`
- New regression fixtures added under `tests/fixtures/` for grep ordering and file-qualified impact pinning.
- No ticket is marked `done` because the sprint still lacks external rerun artifacts against the reviewed codebases.

## Overhaul Waves (2026-03-17)

Based on 45-angle research from 3 agent teams, implementing systematic overhaul:

| Wave | Focus | Status | Key Changes |
|---|---|---|---|
| Wave 1 | Confidence + noise | done | Removed escape hatches, noise ratio hard caps, tightened utilization caps, reduced centrality weight in backfill |
| Wave 2 | Budget utilization | done | Raised BFS caps, aligned refill target 0.6->0.85, multi-pivot L0 packing, expanded maxPrimaryGroups |
| Wave 3 | Broad query supply | done | Score-floor filter for broad (replaces locality requirement), raised file diversity limits |
| Wave 4 | Eval infrastructure | done | Added budgetUtilization and noiseRatio to eval metrics, tightened thresholds |
| Wave 5 | Intelligence layer | planned | Cross-encoder reranking, multi-hop retrieval, HyDE improvements |
| Wave 6 | Polish | planned | Honest cw_stats, body-aware summaries, observation auto-promotion |

### Eval Baseline (2026-03-17, post-Wave 3)

| Metric | Fixture Eval | Target |
|---|---|---|
| Precision | 39.2% | 60%+ |
| Recall | 74.2% | 70%+ (MET) |
| Confidence | 33.3% | 40%+ |
| Budget utilization | 24.0% | 50%+ |
| Noise ratio | 0.3% | <35% (MET) |
| Task success | 100% | 80%+ (MET) |

## Test Evidence

| Check | State | Evidence |
|---|---|---|
| Overhaul verification (2026-03-17) | pass | 10 files, 134 tests passed: confidence, story-packing, formatter, review-regressions, navigation, threshold-ratchet, eval |
| Eval suite (2026-03-17) | pass | 3 codebases, 20 queries, 7 tasks — precision 39.2%, recall 74.2%, 100% task success |
| Prior batch verification | pass | 9 files, 142 tests passed on 2026-03-14 |
| Product baseline | fail | `npm test` remains red outside sprint scope |

## Blockers

- External field reruns against reviewed codebases still needed for final ticket closure.
- Budget utilization on eval fixtures is 24% — needs Wave 5 cross-encoder + multi-hop to improve on real broad queries.

## Next Actions

1. Continue Wave 5: cross-encoder reranking integration
2. Add more diverse eval fixtures (broad queries, architectural queries)
3. Run external field reruns against reviewed codebases
