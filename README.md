# ContextWeave

Local-first MCP server for AST-aware code retrieval, deterministic navigation tools, and cross-session memory.

## Runtime Snapshot

ContextWeave indexes the project into a SQLite-backed symbol and edge graph, then serves token-budgeted `cw_capsule` outputs. The current runtime includes field-recovery hardening for:

- capsule relevance and packing under broad/task queries
- framework/runtime boundary tracing (Next.js and Express entry edges)
- navigation and impact correctness for file-qualified symbol targets
- confidence calibration and explicit uncertainty signaling

## MCP Tool Surface

ContextWeave always registers these read-focused tools:

| Tool | Purpose |
|---|---|
| `cw_capsule` | Token-budgeted context capsule with intent-aware retrieval |
| `cw_impact` | Dependents / blast-radius analysis |
| `cw_flow` | Symbol-to-symbol path tracing or outgoing flow exploration |
| `cw_recall` | BM25-backed memory retrieval |
| `cw_status` | Index health and recent capsule summary |
| `cw_overview` | Directory/symbol overview with optional query focus |
| `cw_files` | Indexed file listing with scope/pattern filters |
| `cw_grep` | Content/regex search with symbol context |
| `cw_read` | Safe bounded file or file-qualified symbol reads |
| `cw_stats` | Session token usage and estimated savings |

In primary lock mode only, ContextWeave also registers:

| Tool | Purpose |
|---|---|
| `cw_remember` | Persist intentional memory observations |
| `cw_reindex` | Force file/directory/project reindex |

Key schema points:

- `cw_capsule`: `query`, `token_budget`, `mode`, optional `path` and `glob`
- `cw_impact`, `cw_flow`, and `cw_read` support file-qualified symbol targets (for example `src/file.ts:SymbolName`)
- `cw_recall` defaults to intentional observations and only includes passive observations when `scope: "passive"` is requested

## Capsule and Confidence

Capsules are produced through a staged retrieval path (pivot discovery, traversal/ranking, compression/packing, memory injection, formatting). Output quality metadata includes:

- retrieval counts (`stageA -> stageB`)
- pivot/dependency/noise coverage
- `coverageConfidence` from intent-specific confidence scoring
- uncertainty level: `very_low`, `low`, `medium`, `high`, `critical`
- explicit reason strings when retrieval is thin (for example low query term coverage or low overall coverage confidence)

Broad/task confidence is explicitly breadth-gated using query-term and retrieval-surface coverage, so narrow local hits do not overstate confidence on broad requests.

## Document Indexing Support

In addition to code languages, ContextWeave indexes:

- Markdown: `.md`, `.markdown`
- YAML: `.yaml`, `.yml`
- JSON: `.json`
- TOML: `.toml`
- INI: `.ini`

Document files are parsed as document-language entries and represented as a synthetic exported symbol (no imports/calls/framework edges). This makes policy/config docs retrievable in capsule, overview, and navigation paths.

## Memory and Recall Behavior

Passive memory is still captured automatically:

- query observations: scope `passive`, confidence `0.5`
- file-change observations: scope `passive`, confidence `0.6`

Current retrieval defaults intentionally reduce passive noise:

- capsule memory injection excludes passive observations by default
- `cw_recall` excludes passive observations unless `scope: "passive"` is requested
- passive observations are auto-expired after 7 days in memory search
- scope weighting favors intentional notes (`architecture`, `decision`, `intent`) over passive telemetry

## Field Regression Gate

The field regression gate is implemented in [`tests/field/review-regressions.test.ts`](tests/field/review-regressions.test.ts). It currently covers five fixture clusters with 14 tests:

- Sitecraft: server route/service retrieval over UI noise, HTTP boundary flow tracing, and recall ordering
- Claud-ometer: route loader/handler/resolver retrieval and direct file-qualified `cw_read`
- gravity-proxy: Express route/controller/service chain, flow, impact, and file-qualified reads
- EBPS: policy-doc retrieval (`.yaml` + `.md`) and confidence calibration expectations
- next-pages-router: older Next.js pages-router loader tracing across `pages/api/**` default handlers

## Installation

### Global Setup

```bash
git clone https://github.com/ajjucoder/ContextWeave.git
cd ContextWeave
npm install
npm run build
```

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "contextweave": {
      "command": "node",
      "args": ["/absolute/path/to/ContextWeave/dist/index.js", "serve"]
    }
  }
}
```

### Per-Project Setup

```bash
npm install contextweave
npx cw init
```

## Configuration

`.contextweave/config.json` fields:

| Field | Type | Default |
|---|---|---|
| `version` | `number` | `1` |
| `ignore` | `string[]` | `["node_modules","dist","build",".git",".next","coverage"]` |
| `tokenBudget` | `number` | `4000` |
| `defaultMode` | `"debug" \| "refactor" \| "feature" \| "review"` | `"feature"` |
| `stalenessDepth` | `number` | `2` |
| `confidenceDecay` | `number` | `0.1` |
| `gcThreshold` | `number` | `0.1` |

## Development and CI Gates

Local scripts:

```bash
npm run lint
npm run test:field
npm test
npm run build
npm run eval
```

GitHub CI (`.github/workflows/ci.yml`) runs gates in this order:

1. `npm ci`
2. `npm run lint`
3. `npm run test:field` (`CW_P95_TARGET_MS=200`)
4. `npm test` (`CW_P95_TARGET_MS=200`)
5. `npm run build`
6. `npm run eval`

The slower product benchmark runs outside the main push gate through [`.github/workflows/product-bench.yml`](.github/workflows/product-bench.yml):

- `workflow_dispatch` for manual operator checks
- nightly schedule for drift detection
- `release.published` for pre-release evidence

## Technical Stack

| Component | Technology |
|---|---|
| Runtime | Node.js >= 22, TypeScript ESM |
| Parser | tree-sitter grammars + document-language indexing |
| Storage | better-sqlite3 (WAL) |
| Watcher | `@parcel/watcher` |
| MCP transport | `@modelcontextprotocol/sdk` stdio |
| Validation | zod |
