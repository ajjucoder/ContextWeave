# Merge & Rebuild — Work Log

**Date:** 2026-03-18
**Branch:** main (merged from codex/review-closure-sprint)
**Commits merged:** 22 commits (72a3ffd..351bf7c)

## What was done

### Analyzed March 17 Reviews (4 projects)
Scores were devastating — every metric WORSE than Round 1:
- Narrow precision: 7.8 -> 4.0
- Broad recall: 3.4 -> 2.75
- Budget utilization: 3.8 -> 1.75
- ALL ran against main branch (not the sprint branch with Wave 1-5 fixes)

### Critical bug fixes added before merge
1. **Java variable type bindings** — `local_variable_declaration`, `field_declaration`, `formal_parameter` now extract receiver types so `productModel.deleteProduct()` correctly resolves to the right `deleteProduct` definition
2. **Expanded vendor detection** — added template/theme/starter directory patterns, `.min.js/.min.css` detection, `node_modules`, `bundle/polyfill` name patterns

### Merged sprint branch to main (fast-forward)
All 22 commits including:
- Wave 1: confidence calibration (removed escape hatches, noise caps)
- Wave 2: budget utilization (wider BFS, multi-pivot packing)
- Wave 3: broad query supply (score-floor filter)
- Wave 4: eval infrastructure (budgetUtilization, noiseRatio metrics)
- Wave 5: cross-encoder wiring, adaptive RRF k
- Plus: `file:` -> `path:` fix in formatter, grep definition ranking, impact pinning

### Rebuilt dist
`npm run build` produced fresh `dist/index.js` with all fixes verified.

### Deleted stale indexes
Removed `.contextweave/contextweave.db` from all 4 reviewed projects so next run re-indexes with new parser (Java type bindings, vendor detection).

## Files created/modified
- src/core/parser.ts — Java type binding extraction
- src/capsule/generator.ts — expanded vendor detection
- dist/index.js — rebuilt
- All 4 project indexes deleted for fresh re-indexing

## What this should fix in next review
- `file:` vs `path:` follow-up syntax bug (most visible damage)
- Confidence lying HIGH on garbage (escape hatches removed)
- Vendor/template noise in broad queries (expanded detection)
- Java cw_impact false negatives (type bindings now extracted)
- Budget utilization (wider BFS, aligned refill target)
