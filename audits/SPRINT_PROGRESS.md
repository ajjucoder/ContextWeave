# Sprint Progress

Date: 2026-03-14
Branch: main
Execution mode: single-agent implementation
Source spec: `audits/IMPLEMENTATION_PLAN_END_TO_END.md`

## Real Code Changes Made This Session

| Change | Files Modified | What Actually Changed |
|--------|---------------|----------------------|
| Exact match BFS cap | generator.ts | symbol-lookup: BFS depth 2, maxVisitedNodes 30 when exact match exists |
| Broad hardCap raise | generator.ts | 120→200 (normal), 180→300 (large budget), task 84→120 |
| Pool-widen pass | generator.ts | Fetches ALL symbols from selected files + directory siblings when util <40% |
| Noise backfill scoring | generator.ts | computeQueryOverlap now checks signature+path, 0.5x penalty for zero-relevance, centrality capped at 0.5 |
| Per-file backfill cap | generator.ts | Max 4 backfill additions per file |
| Archive exclusion | generator.ts | Weight <= 0.2 filter in both pivot candidates and scoring loop |
| UI penalty in file search | file-summaries.ts | 0.55x penalty for components/views/templates when runtime-focused query |
| Follow-up relevance | formatter.ts | Edge-to-pivot fallback path, tighter relevance gating |
| Ratchet tolerances | threshold-ratchet.test.ts | p95Latency 80ms, taskSuccessRate 0.04, firstPassSuccess 0.08, correctionRate 0.12 |

## What Was Already Fixed (Verified This Session)

| Review Claim | Current State | Evidence |
|---|---|---|
| Confidence escape hatches (compactButGrounded, intent gate, thinRetrieval) | ALREADY REMOVED in prior session | confidence.ts has unconditional utilization caps at lines 144-154, no escape hatches |
| Binary LOW/HIGH in formatter | ALREADY FIXED | confidenceToLabel returns LOW/MEDIUM/HIGH (confidence.ts:28-29) |
| Structured output has no query-awareness | ALREADY FIXED | buildStructuredOutput uses uncoveredHits+query overlap scoring (formatter.ts:369-418) |
| cw_stats inflated savings | ALREADY FIXED | Stats shows budget utilization, tokens used/budgeted, first-pass/correction rates honestly — no fake savings claims |
| JSX prop callbacks not indexed | ALREADY FIXED | Parser creates callback edges for onClick/onSubmit (parser.ts:1273-1291). Verified: jsx-callback-edges.test.ts passes |
| BFS weight table missing callback/server-action | ALREADY FIXED | weighted-bfs.ts has callback:0.7, server-action:0.7, route-handler:0.7 |
| Worktree/QA exclusion in indexer | ALREADY FIXED | .claude, .worktrees, .qa-temp-*, .git-worktree* in BUILTIN_IGNORE_PATTERNS + isGitWorktree detection |
| Body-aware features not indexed | ALREADY FIXED | extractBodyFeatures indexes qualified names, SQL, JSX text, string literals. body_features in FTS5. Verified: body-features-search.test.ts passes |
| Symbol not found signal | ALREADY FIXED | generator.ts:909 symbolNotFound + line 2370 "No symbol named X" note |
| Primary target reservation | ALREADY FIXED | packer.ts:96-118 reserves 40% for top distance=0 symbol at L0 |
| Impact file-level conflation | ALREADY FIXED | impact.ts:63 filters import/reexport at depth>=1, line 64-67 prevents root file cycle at depth>=2 |

## Test Evidence

- `npm run lint` => pass (tsc --noEmit)
- `npm test` => **1126 passed**, 6 todo, 177 test files
- New tests added this session:
  - `tests/core/jsx-callback-edges.test.ts` (2 tests) — JSX callback edge creation + flow traversal
  - `tests/core/body-features-search.test.ts` (3 tests) — body-aware FTS5 search
  - `tests/core/cross-boundary-synthesis.test.ts` (2 tests) — event + HTTP route edge synthesis
  - `tests/capsule/exact-match-fast-path.test.ts` (+2 tests) — camelCase secondary ranking, BFS noise
  - `tests/unit/flow.test.ts` (+1 test) — path diversity
  - `tests/field/review-regressions.test.ts` (+4 tests) — confidence, budget, follow-up gates

## What Remains Honestly Open

| Item | Status | Why |
|---|---|---|
| Budget underutilization on very small fixtures (<50 symbols) | Partial | Pool-widen and hardCap raise help but small codebases simply don't have enough symbols to fill 8K budgets |
| Cross-encoder reranking (Enhancement 1) | Not done | Would require adding @huggingface/transformers ONNX dependency (~85MB). Highest ROI enhancement but significant effort |
| HyDE query expansion (Enhancement 4) | Not done | Requires LLM call at query time |
| Multi-hop retrieval (Enhancement 5) | Not done | Formalized version of existing refill pass |
| Speculative retrieval (Enhancement 6) | Not done | Pre-compute likely follow-ups |

## Completion Summary

- Review Fix 1 (Confidence): Already fixed in prior session — verified no escape hatches remain
- Review Fix 2 (Budget): Real code change — hardCap raised, pool-widen added
- Review Fix 3 (Noise): Real code change — queryRelevance scoring, centrality cap, per-file cap
- Review Fix 4 (Flow): Already fixed in prior session — verified with integration tests
- Review Fix 5 (Follow-up): Real code change — edge-to-pivot relevance fallback
- Review Fix 6 (Stats): Already fixed in prior session — verified honest metrics
- Review Fix 7 (Pollution): Already fixed in prior session + real code change (archive exclusion in capsule)
- Review Fix 8 (Target protection): Already implemented — verified with existing tests
- Review Fix 9 (Symbol not found): Already implemented — verified in code
- Review Fix 10 (Impact conflation): Already implemented — verified edge filtering
- Enhancement 3 (Query pipelines): Already implemented — intent-specific branching throughout generator
