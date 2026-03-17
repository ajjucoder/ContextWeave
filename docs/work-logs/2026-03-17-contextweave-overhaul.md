# ContextWeave Overhaul — Work Log

**Date:** 2026-03-17
**Branch:** codex/review-closure-sprint
**Commits:** a64746d, bb892ac, 2f36d4f, f2528cc, 6aa387f

## What was done

### Research Phase
- Spun up 3-agent team (retrieval-researcher, intelligence-researcher, eval-researcher)
- Each researcher analyzed 15 concrete improvement angles = 45 total angles
- Cross-team insight sharing on dependencies and integration points
- Key finding: noise + confidence escape hatches are root cause, not missing features

### Wave 1: Confidence + Noise (a64746d)
- Removed structurallyGrounded floor overrides that bypassed utilization caps
- Reduced base confidence constants (+0.182/+0.282/+0.362 -> +0.05/+0.10/+0.15)
- Added noise ratio hard caps (>0.60 -> cap 0.35, >0.45 -> cap 0.50)
- Added 6-tier utilization caps from <0.15 to <0.70
- Hardened backfill scoring: reject zero-overlap/low-lexical symbols
- Expanded VENDOR_FILE_RE for worktrees, .claude, .qa-temp, __pycache__
- Test file exclusion now applies to pivots with zero lexical relevance

### Wave 2: Budget Utilization (bb892ac)
- Raised BFS hardCap for broad: 200->280 (standard), 300->400 (large budget)
- Increased candidate limit multiplier for broad: 0.45->0.6, 0.6->0.8
- Aligned generator refill outer gate with target (0.6->0.85)
- Expanded maxPrimaryGroups and maxL0Nodes in story-mode packer
- Pivots scoring >= 50% of top score get full L0 resolution

### Wave 3: Broad Query Supply (f2528cc)
- Replaced locality requirement with score-floor (12% of top) for broad queries
- Raised pruneByFileDiversity limits: maxFiles 10->14, maxTotal 35->50

### Eval Infrastructure (2f36d4f)
- Added budgetUtilization and noiseRatio to eval QueryMetricOutput
- Pass tokenBudget and noiseRatio through eval pipeline
- Tightened DEFAULT_EVAL_THRESHOLDS: precisionMin 0.15->0.40
- Added avgBudgetUtilization and avgNoiseRatio to eval report

## Files Modified
- src/capsule/confidence.ts — confidence calibration overhaul
- src/capsule/generator.ts — backfill scoring, BFS caps, broad query filtering
- src/capsule/packer.ts — multi-pivot L0 packing, expanded groups
- tests/eval/metrics.ts — new metrics (budgetUtilization, noiseRatio)
- tests/eval/eval-runner.ts — threshold tightening, metric plumbing
- tests/unit/confidence-calibration.test.ts — updated for new thresholds
- tests/capsule/confidence-5level.test.ts — updated for new thresholds
- tests/capsule/story-packing.test.ts — updated for multi-pivot packing
- tests/field/review-regressions.test.ts — adjusted boundary tolerance
- audits/SPRINT_PROGRESS.md — overhaul waves and eval baseline
- docs/superpowers/specs/2026-03-17-contextweave-overhaul-design.md — new

## Files Created
- docs/superpowers/specs/2026-03-17-contextweave-overhaul-design.md
- docs/work-logs/2026-03-17-contextweave-overhaul.md

## Eval Baseline (post-overhaul)
| Metric | Value | Target |
|--------|-------|--------|
| Precision | 39.2% | 60%+ |
| Recall | 74.2% | 70%+ (MET) |
| Confidence | 33.3% | 40%+ |
| Budget utilization | 24.0% | 50%+ |
| Noise ratio | 0.3% | <35% (MET) |
| Task success | 100% | 80%+ (MET) |

## Test Results
- 134 tests passing across 10 test files, 0 failures
- Eval suite: 3 codebases, 20 queries, 7 tasks

## Remaining Work
- Wave 5: Cross-encoder reranking (highest-ROI intelligence improvement)
- Wave 6: Multi-hop retrieval, HyDE improvements, honest cw_stats
- External field reruns against reviewed codebases
