# ContextWeave Runtime Catalog

Current runtime catalog as reflected by source and tests in this repository.

## Runtime Focus

ContextWeave is a local-first MCP server that builds a persistent symbol/edge graph and serves token-budgeted context capsules. The runtime is currently tuned around field-recovery outcomes:

- higher relevance under broad/task queries
- deterministic framework boundary tracing
- reliable symbol navigation and impact analysis
- calibrated confidence and explicit uncertainty reasons

## MCP Tool Surface

### Always Registered

| Tool | Description |
|---|---|
| `cw_capsule` | Intent-aware context capsule generation with compression and packing |
| `cw_impact` | Incoming dependency blast radius |
| `cw_flow` | Graph path tracing between symbols or outward from a source |
| `cw_recall` | BM25-backed memory search |
| `cw_status` | Files/symbols/edges/observations summary and recent capsules |
| `cw_overview` | Scoped directory and query-focused project overview |
| `cw_files` | Indexed file listing with `path`/`pattern` filtering |
| `cw_grep` | Text/regex search with line snippets and enclosing symbol context |
| `cw_read` | Safe bounded file reads and symbol-targeted reads |
| `cw_stats` | Session-level token usage and estimated savings |

### Primary Lock Mode Only

| Tool | Description |
|---|---|
| `cw_remember` | Persist intentional memory notes |
| `cw_reindex` | Reindex file, directory, or project |

`src/mcp/server.ts` registers write-heavy tools only when session lock mode is `primary`. Secondary sessions are read-focused and skip watcher startup.

## Field-Recovery Behaviors (Runtime)

### Capsule Relevance, Ranking, and Packing

- Query intent classification: `narrow`, `broad`, `task`
- Multi-pass decomposition for broad/task queries
- Weighted traversal over dependency graph plus lexical/path signals
- Compression levels `L0..L3` with budget-aware packing
- Retrieval health surfaced as `stageA -> stageB` counts and coverage metrics

Primary implementation paths:

- `src/capsule/generator.ts`
- `src/capsule/scorer.ts`
- `src/capsule/packer.ts`
- `src/capsule/formatter.ts`

### HTTP / Framework Boundary Tracing

Synthetic `framework_entry` edges are created for:

- Next.js fetch callers -> matching `app/api/.../route` handlers
- Express route registrations -> controller/service handlers
- framework entry files to imported/called symbols

Primary implementation path: `src/core/indexer.ts` + `src/core/parser.ts`.
Primary verification: `tests/core/framework-entry-edges.test.ts`, `tests/field/review-regressions.test.ts`.

### Navigation and Impact Correctness

`cw_read`, `cw_flow`, and `cw_impact` support file-qualified symbol disambiguation (for example `path/to/file.ts:SymbolName`) for direct jumps and deterministic tracing.

Primary implementation paths:

- `src/mcp/tools/read.ts`
- `src/mcp/tools/flow.ts`
- `src/mcp/tools/impact.ts`

Primary verification:

- `tests/field/review-regressions.test.ts`
- `tests/integration/mcp-navigation-tools.test.ts`
- `tests/unit/read-file-symbol.test.ts`

### Confidence Calibration

Confidence is intent-aware (`narrow` vs `broad` vs `task`) and includes breadth penalties for broad/task retrieval via query-term and retrieval-surface factors.

Uncertainty levels are:

- `very_low`
- `low`
- `medium`
- `high`
- `critical`

Reason strings are emitted when coverage is weak (for example low query-term coverage, thin retrieval surface, low overall coverage confidence).

Primary implementation paths:

- `src/capsule/confidence.ts`
- `src/capsule/generator.ts`

Primary verification:

- `tests/capsule/confidence-formula.test.ts`
- `tests/unit/confidence-calibration.test.ts`
- `tests/field/review-regressions.test.ts`

## Document Indexing Support

### File Types

- Markdown: `.md`, `.markdown`
- YAML: `.yaml`, `.yml`
- JSON: `.json`

### Runtime Semantics

Document files are indexed as document-language entries and converted into a single synthetic exported symbol with searchable name/signature text and truncated full source for retrieval.

- no imports
- no calls
- no framework calls

Primary implementation path: `src/core/parser.ts`.
Primary verification:

- `tests/unit/parser.test.ts`
- `tests/field/review-regressions.test.ts` (EBPS doc retrieval assertions)

## Recall and Passive-Memory Behavior

Passive capture remains enabled:

- query capture in `src/memory/passive.ts` at confidence `0.5`
- file-change capture in `src/memory/passive.ts` at confidence `0.6`

Retrieval defaults are intentionally conservative:

- capsule injection path (`MemorySearch.getRelevantForCapsule`) excludes passive observations by default
- `cw_recall` excludes passive observations unless `scope: "passive"` is explicitly requested
- passive observations older than 7 days are excluded in memory search

Primary implementation paths:

- `src/memory/search.ts`
- `src/mcp/tools/recall.ts`
- `src/memory/passive.ts`

Primary verification:

- `tests/integration/recall-tool-grouping.test.ts`
- `tests/integration/passive-observation-recall.test.ts`
- `tests/memory/recall-scope-weight.test.ts`

## CI Gates

GitHub workflow: `.github/workflows/ci.yml`.

Execution order:

1. `npm ci`
2. `npm run lint`
3. `npm run test:field` with `CW_P95_TARGET_MS=200`
4. `npm test` with `CW_P95_TARGET_MS=200`
5. `npm run build`

The field regression suite is a hard CI gate before full test and build.

## Field Regression Gate

Primary file: `tests/field/review-regressions.test.ts`.

Coverage areas:

- Sitecraft (query relevance, route/service tracing, recall ordering)
- Claud-ometer (session route/resolver retrieval, file-qualified read)
- gravity-proxy (OAuth route/controller/service chain, flow and impact)
- EBPS (policy-doc retrieval and confidence floor expectations)
