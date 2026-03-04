# ContextWeave v1.0 Production Readiness Plan

> **Goal:** Make ContextWeave reliably replace Grep/Explorer for codebases up to 100K LOC.
> **Scale targets:** v1.0 = 100K LOC, v1.1 = 500K LOC, v2.0 = 1M+ LOC.
> **Date:** 2026-03-04

---

## Approach: Foundation-First (Approach A)

Phase 1: Foundation (eval + .cwignore + quick fixes + dead code cleanup)
Phase 2: Graph Completeness (path aliases, JSX, inheritance/implements/type_usage/reference edges, re-exports)
Phase 3: Retrieval Quality (intent classifier, FTS hybrid, BFS tuning, confidence calibration)
Phase 4: Performance + Polish (parser pooling, statement caching, ripgrep cw_grep, glob on capsule)

---

## Phase 1: Foundation

### P1.1: .cwignore directory exclusion
- Wire `.cwignore` loading into `discoverFiles()` alongside `.gitignore`
- Add `exclude` and `excludePatterns` to config schema
- Prune already-indexed files on reindex when they match new exclusions
- Generate default `.cwignore` template on `cw init`

### P1.2: Eval framework
- `tests/eval/eval-runner.ts` — multi-codebase query test runner
- `tests/eval/metrics.ts` — precision, recall, token efficiency, latency
- `tests/eval/fixtures/` — query test cases with expected files/symbols
- Ratchet test: CI fails if metrics regress below previous best minus tolerance
- Start with ContextWeave's own codebase as first eval target

### P1.3: Intent classifier fix
- Separate question-words (how/what/why) from action-words (implement/add/fix)
- Questions with a single focus term classify as narrow, not task

### P1.4: Dead code and bug fixes
- Fix cluster split bug (absolute vs project-relative paths)
- Wire `observationCount` into `scoreNode` (currently hardcoded to 0)
- Populate L2 render `edges` parameter
- Call `StalenessEngine.runGC()` on a schedule (e.g., after every N capsule generations)
- Call `StalenessEngine.decayConfidence()` periodically
- Remove dead config fields or wire them up
- Remove `chokidar` from dependencies (unused)
- Fix `fileQueries.getByPathSuffix()` to avoid table scan
- Fix path overmatch in `filePathMatchesQueryTerms` (segment-boundary matching)
- Fix session dedup to consider L0 and L1, not just L0
- Fix diagnostics to report multiple bottlenecks, not just one
- Fix BFS skip to have partial degradation (depth 1) instead of all-or-nothing

---

## Phase 2: Graph Completeness

### P2.1: TypeScript path alias resolution
- Read `tsconfig.json` `paths` and `baseUrl` at index time
- Resolve `@/`, `~/`, `#` prefixed imports to actual file paths
- Create import edges for resolved aliases

### P2.2: JSX component usage edges
- Add tree-sitter queries for `jsx_self_closing_element` and `jsx_opening_element`
- Capture JSX renders as edges (new kind: `jsx_render`)
- Add JSX prop callback detection (`onClick={handler}`)
- Add weight in BFS (0.8 — slightly cheaper than calls, strong signal)

### P2.3: Missing edge kinds (inheritance, implements, type_usage, reference)
- Add tree-sitter queries for class `extends`, `implements`, type annotations
- Create edges in `resolveEdges()` for all 4 kinds
- These already have weights in `weighted-bfs.ts`

### P2.4: Re-export edge tracking
- Detect `export { X } from './module'` and `export * from './module'`
- Create re-export edges (kind: `reexport`, cost: 0.1)
- Handle renamed re-exports (`export { X as Y }`)
- Treat re-export edges as transparent in BFS traversal

---

## Phase 3: Retrieval Quality

### P3.1: FTS hybrid search
- Phase 1: exact name match via `symbols.getByName(term)`
- Phase 2: FTS trigram only if Phase 1 returns < threshold results
- Phase 3: fuzzy path match (existing logic)

### P3.2: BFS cost model fix
- Rename `maxDepth` to `maxCost` internally
- Add separate `maxHops` hard cap (default: 8)
- Track `hopCount` separately from `distance` (cost) in BFS queue

### P3.3: Confidence calibration
- Move from 3-level to 5-level uncertainty
- Add token utilization as a confidence signal
- Add diagnostic reason to each level
- Calibrate thresholds using eval framework data

### P3.4: Convention boost for framework entry points
- Detect Next.js middleware, route handlers, page/layout files
- Create synthetic "framework_entry" edges during indexing
- Auto-include as pivots for relevant queries

### P3.5: Recall noise reduction
- Scope-based weighting (architecture: 3.0x, passive: 0.3x)
- Auto-expire passive observations older than 7 days
- Group intentional vs passive in recall output

---

## Phase 4: Performance + Polish

### P4.1: Parser pooling
- Cache `Parser` instances per language (Map<string, Parser>)
- Reuse across files during bulk indexing

### P4.2: Statement caching
- WeakMap cache per DB instance for `symbolQueries()`, `fileQueries()`, `edgeQueries()`
- Apply the pattern already used for `degreeStmtCache`

### P4.3: Token counting fast path
- `estimateTokens()` using `Math.ceil(text.length / 3.5)` for scoring/ranking
- Exact `countTokens()` only for final packing

### P4.4: Light symbol queries
- Add `getByNameLight`, `getByFileIdLight` that exclude `full_source`
- Use Light variants in hot paths (pivot scoring, BFS expansion)

### P4.5: Ripgrep-backed cw_grep tool
- Shell out to `rg` for text search
- Enrich results with enclosing symbol context from index
- Replace current `cw_search` disk-scanning approach

### P4.6: Path/glob filtering on cw_capsule
- Add optional `path` and `glob` params
- Pre-filter file candidates before pivot resolution

### P4.7: isExported fix
- Python: only mark module-level symbols as exported if `__all__` defines them or if they lack `_` prefix
- Go: use capitalization convention for export detection

---

## Success Criteria

- Eval framework with 15+ queries across 2+ codebases
- Precision >= 0.7 and Recall >= 0.6 on average
- Zero legacy/dead code in capsules when .cwignore is configured
- Auth/middleware queries find the right files in Next.js codebases
- JSX component usage appears in impact analysis
- Capsule generation < 200ms at 100K LOC
- Recall returns intentional observations before passive noise
- Confidence levels are actionable (5-level with diagnostic reasons)
- Complete dependency graph (all 6+ edge kinds populated)
- Text search via cw_grep at ripgrep speed with symbol context
