# ContextWeave Overhaul — Design Spec

Date: 2026-03-17
Goal: Make ContextWeave competitive with Augment's Context Engine — find context instantly, save tokens, earn trust.

## Current State (8-project field review)

| Metric | Current | Target |
|--------|---------|--------|
| Narrow precision | 7.8/10 | 9.0/10 |
| Broad recall | 3.4/10 | 7.0/10 |
| Budget utilization | 3.8/10 | 7.0/10 |
| Confidence calibration | 3.8/10 | 8.0/10 |
| Flow tracing | 3.4/10 | 6.0/10 |
| Follow-up quality | 3.4/10 | 7.0/10 |
| Token savings (quality-adjusted) | ~0% | >30% |
| Would replace grep+read | 0/8 | 5/8 |

## Root Cause Chain

BFS candidate cap (72-200) -> Stage-B over-filtering -> Noise backfill (centrality-based) -> Packer starved -> Budget wasted (14-33%) -> Confidence lies (HIGH on garbage) -> Follow-ups from noise pool -> User wastes tokens on corrections -> Net savings: 0%

## Architecture: 6-Wave Implementation

### Wave 1: Foundation Fixes (confidence + noise)
1. Remove confidence escape hatches (compactButGrounded, intent gate, thinRetrieval)
2. Add MEDIUM confidence tier to text formatter
3. Per-symbol relevance filtering in backfill (replace centrality with query relevance)
4. Hard-exclude test/doc/vendor/worktree files in non-debug modes

### Wave 2: Budget Utilization (supply chain)
5. Raise BFS candidate cap for broad queries (200->400, maxVisited 500->800)
6. Relax stage-B filtering for broad (score-floor instead of locality requirement)
7. Align generator refill target with packer (0.60->0.85 outer gate)
8. Multi-pivot reservation in packer (top 3-5 pivots at L0)
9. Emergency refill when utilization < 30%
10. Noise ratio self-measurement during packing (stop accepting noise at 40%)

### Wave 3: Intelligence Layer
11. Cross-encoder reranking at generator.ts:1213 (ms-marco-MiniLM via ONNX)
12. Follow-up suggestion fix (purge noise from candidate pool, rank by query gaps)
13. Symbol-not-found signaling
14. Flow path diversity (per-branch visited sets)
15. cw_impact file-qualified pinning

### Wave 4: Parser & Edge Improvements
16. JSX prop callback edge detection
17. "use server" directive detection
18. Cross-boundary edge synthesis (emit->listen, fetch->route)

### Wave 5: Advanced Retrieval
19. Multi-hop retrieval for broad queries
20. HyDE improvements (language-aware stubs, relaxed NL detection)
21. Intent classifier concept intent
22. Query-type-specific pipeline branching

### Wave 6: Eval Harness + Polish
23. Automated eval harness (CW vs grep+read)
24. Regression gate in CI
25. Honest cw_stats metrics
26. Body-aware file summaries
27. Observation auto-promotion

## Key Design Decisions

1. Fix noise BEFORE expanding supply — wider BFS + noise = worse, not better
2. Cross-encoder slots in after BFS scoring, before packer — reranks top 50
3. Confidence caps are UNCONDITIONAL — no escape hatches, no intent gates
4. Eval harness uses frozen fixture repos with labeled ground truth
5. Composite quality score: 0.3*P@5 + 0.25*R@5 + 0.20*utilization + 0.15*(1-noise) + 0.10*followup_hit
