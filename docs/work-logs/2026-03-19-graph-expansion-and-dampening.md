# Graph Expansion + Common Name Dampening — Work Log

**Date:** 2026-03-19
**Branch:** main
**Commits:** 5e52828, b3855aa

## Root Cause Found

Opus 4.6 review of Kuvio discovered the fundamental capsule failure:
- cw_flow traces HTTP boundaries perfectly (8/10)
- cw_impact finds all dependents (9/10)
- cw_capsule misses the same files (2/10 broad recall)

Root cause: capsules use BM25 text matching for pivot discovery. The graph that cw_flow and cw_impact use is NOT consulted during capsule generation.

Additionally: common symbol names (POST, State, config, handler) get +100 exact-match bonus even when they appear in 50+ files, causing ErrorBoundary.State to outrank the actual state management system.

## Changes

### Fix 1: candidateFileIds subset restriction removed (5e52828)
- For broad/task/debug queries, capsules now search the FULL symbol index
- Previously capped at 50-80 files from file_summaries_fts
- This is why capsules only saw 47/647 files in Kuvio

### Fix 2: Graph-seeded expansion (b3855aa)
- After text-based pivot resolution, follows call/callback/framework/event edges from top-10 pivots
- Discovers connected symbols that BM25 missed
- Bridges cw_flow's graph data into capsule retrieval
- Capped at 30 additional pivots

### Fix 3: Common-name dampening (b3855aa)
- Symbols with name IDF < 1.5 (appear in many files) get exact-match bonus reduced to 15%
- Prevents POST/State/config/handler from dominating results
- Uses existing IDF infrastructure — no new computation

## Test Results
- 121 tests passing, 0 failures
- Eval suite: precision 38.3%, recall 73.3%, 100% task success, 0% noise
- No regression from prior eval baseline

## Expected Impact
- "inquiry submission flow" should now find publicInquiry.ts via framework_entry edge
- "state management" should no longer rank ErrorBoundary.State above dataLayer.ts
- "dashboard navigation" should find nav-config.ts instead of postcss.config.mjs
