# Sprint Progress

Date: 2026-03-14
Branch: main
Source spec: `audits/IMPLEMENTATION_PLAN_END_TO_END.md` + `ContextWeave-Reviews/ANALYSIS-2026-03-10.md`

## Review Finding Resolution (17 findings from 8-project review)

| # | Finding | Severity | Fix | Evidence |
|---|---------|----------|-----|----------|
| 1 | Confidence miscalibration | P0 | Escape hatches removed, 3-tier labels (LOW/MEDIUM/HIGH), unconditional utilization caps | confidence.ts:144-154, field test: nonexistent symbol returns LOW |
| 2 | Noise domination | P0 | Backfill relevance scoring (name+sig+path), centrality capped 0.5, per-file cap 4, archive exclusion, UI penalty 0.55x | field test: noise ratio < 50% |
| 3 | Budget underutilization | P0 | hardCap 120→200/300, pool-widen pass, small-codebase expansion (<=100 symbols), multi-hop retrieval | tests pass |
| 4 | Flow tracing | P0 | JSX callback edges (parser), BFS weights for callback/server-action/route-handler, path diversity (first-hop grouping), cross-boundary synthesis (10+ patterns) | jsx-callback-edges.test.ts, cross-boundary-synthesis.test.ts, field flow tests |
| 5 | cw_stats inflated | P1 | Honest metrics: budget utilization, tokens used/budgeted, first-pass/correction rates, no fake savings claims | stats.ts verified |
| 6 | Broad queries miss files | P0 | Pool-widen, multi-hop, HyDE expansion for NL queries, body-aware FTS5 (qualified names, SQL, JSX text, string literals) | body-features-search.test.ts, hyde-expansion.test.ts |
| 7 | Follow-up irrelevant | P1 | Query-aware ranking in both text and structured output, edge-to-pivot relevance fallback, uncoveredHits primary sort | formatter-followup.test.ts (11 tests) |
| 8 | cw_recall weak | P1 | Architecture scope 3.0x weight, passive 0.3x, 7-day passive TTL, intentional before passive in output | field recall test |
| 9 | Test files rank above source | P1 | Test penalty 0.3x in backfill, test path penalty 0.35x in file-summaries ranking | existing tests |
| 10 | Target compressed while noise full | P0 | 40% code budget reservation for primary target at L0, packed first | target-protection.test.ts (7 tests) |
| 11 | Index pollution | P0 | BUILTIN_IGNORE_PATTERNS (.claude, .worktrees), .qa-temp-*, worktree detection, weight<=0.2 capsule filter | field test with archive fixture |
| 12 | Duplicate content | P2 | Packer dedup pass: removes symbols whose line range is contained within a larger rendering | packer.ts:468-497 |
| 13 | Symbol not found silent | P0 | symbolNotFound flag + "No symbol named X" note in capsule text | field test: uncertainty=critical for nonexistent |
| 14 | Path overrides content | P1 | UI penalty 0.55x for runtime queries, runtime boost 1.35x, archive exclusion | file-summaries.ts |
| 15 | [previously shown] waste | P2 | Minimal: shows count only, dedup only for L0/L1 recent symbols | formatter.ts:319-320 |
| 16 | cw_read path inconsistency | P2 | Suffix match, 3-candidate resolution, symlink safety, file-qualified format | field cw_read tests |
| 17 | cw_overview padding | P2 | Body-aware FTS5, summary snippet matching, UI penalty | body-features-search.test.ts |

## Fix Plan Resolution (10 fixes + 6 enhancements)

| Item | Status | Evidence |
|---|---|---|
| Fix 1: Confidence calibration | Done | No escape hatches in confidence.ts, unconditional caps |
| Fix 2: Budget filling | Done | hardCap raised, pool-widen, multi-hop retrieval |
| Fix 3: Noise elimination | Done | Relevance scoring with sig+path, centrality cap, per-file cap |
| Fix 4: Flow tracing | Done | JSX callbacks, BFS weights, path diversity, cross-boundary edges |
| Fix 5: Follow-up suggestions | Done | Query-aware in both paths, relevance floor |
| Fix 6: Honest stats | Done | No fake savings, honest utilization metrics |
| Fix 7: Index pollution | Done | Indexer exclusions + capsule weight filter |
| Fix 8: Target protection | Done | 40% reservation at L0 |
| Fix 9: Symbol not found | Done | symbolNotFound signal in capsule |
| Fix 10: Impact conflation | Done | Import/reexport filter at depth>=1, root file guard at depth>=2 |
| Enhancement 1: Cross-encoder | Done | CrossEncoderReranker (ms-marco-MiniLM-L-6-v2), wired into EmbeddingRuntime |
| Enhancement 2: Cross-boundary edges | Done | event-edge-synthesis.ts handles 10+ patterns |
| Enhancement 3: Query-type pipelines | Done | Intent-specific branching throughout generator |
| Enhancement 4: HyDE expansion | Done | Template-based NL→function signature expansion |
| Enhancement 5: Multi-hop retrieval | Done | Second BFS pass from packed results |
| Enhancement 6: Speculative retrieval | Not done | Latency optimization, not quality fix |

## Test Evidence

- `npm run lint` => pass
- `npm test` => **1147 passed**, 6 todo, 179 test files
- `tests/field/review-regressions.test.ts` => **24 passed** (covering all major review failure modes)
- New test files this session:
  - `tests/core/jsx-callback-edges.test.ts` (2) — JSX callback edge creation + flow
  - `tests/core/body-features-search.test.ts` (3) — body-aware FTS5 search
  - `tests/core/cross-boundary-synthesis.test.ts` (2) — event + HTTP synthesis
  - `tests/core/hyde-expansion.test.ts` (11) — HyDE NL query expansion
  - `tests/core/reranker.test.ts` (4) — cross-encoder reranking

## What Cannot Be Verified Without External Codebases

The 8 review projects (Kuvio, polymarket, FocusPact, lawn, EBPS, Nudgy, CW-Self, t3code) are external codebases not available in this repository. The field fixtures (sitecraft, claudometer, gravity-proxy, ebps, next-pages-router) simulate the same failure patterns and all pass. A definitive re-score requires re-running ContextWeave on the actual 8 review projects.
