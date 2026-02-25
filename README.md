# ContextWeave

Local-first MCP server that delivers AST-aware, token-budgeted code context capsules with cross-session memory for AI coding agents.

---

## What is ContextWeave

AI coding agents like Claude operate within a fixed context window. On any non-trivial codebase, naively dumping files exhausts that budget immediately — leaving the model with stale, unfocused, or irrelevant code. The result is hallucinated APIs, missed dependencies, and wasted tokens on files that have nothing to do with the task at hand.

ContextWeave solves this by building a persistent AST dependency graph of your project using tree-sitter. When an agent needs context, it issues a natural-language query and receives a *capsule*: a token-budgeted, multi-level-compressed snapshot of exactly the symbols relevant to that query, ranked by graph distance, centrality, recency, and lexical match. Pivot symbols — the ones directly matched by your query — always appear at full source. Everything else is progressively compressed based on how relevant it is.

Cross-session memory compounds this over time. Every query and every file change is silently recorded as a low-confidence observation. Explicit `cw_remember` calls add high-confidence notes that survive across sessions. Future capsule generations pull these observations into context alongside code, so the model inherits knowledge from previous sessions without you having to re-explain it.

---

## How it Works

### 7-Phase Capsule Pipeline

```
Query
  │
  ▼
[Phase 1] Pivot Resolution
  Fuzzy-match query terms against all symbol names and file paths.
  Collect up to 5 symbol matches + 3 file matches per term.
  │
  ▼
[Phase 2] BFS Graph Traversal (Stage A)
  Walk the dependency graph outward from pivots via import/call/
  reference/inheritance edges. Depth scales with token budget
  (3–6 hops). Collect all reachable symbols with their distances.
  │
  ▼
[Phase 3] Stage B Reranking
  Score every candidate: pivot boost, distance decay, centrality
  signal, recency, export bonus, lexical match, locality boost
  (same-file: 1.35x, same-dir: 1.15x), hub dampening for high-
  degree non-pivot nodes. Select final candidate set.
  │
  ▼
[Phase 4] Compression Assignment
  Assign each symbol a compression level based on normalized score
  and distance. Pivot (distance=0) → L0. Score ≥60% → L1.
  Score ≥30% → L2. Otherwise → L3.
  │
  ▼
[Phase 5] Token-Budget Packing
  Pack symbols in score order, trying each compression level until
  the symbol fits within the code budget. Apply a promotion pass:
  if budget remains after packing, upgrade L3 nodes to lower
  compression levels by score priority.
  │
  ▼
[Phase 6] Memory Injection
  BM25-search passive and explicit observations for the query.
  Inject up to 20% of the token budget as observation context.
  │
  ▼
[Phase 7] Quality Gate + Format
  Compute pivot coverage, dependency coverage, noise ratio, and
  coverage confidence. Set uncertainty flag. Format output.
  Persist capsule log and passive query observation.
```

### Compression Levels

| Level | Name | Content |
|-------|------|---------|
| L0 | Full source | Complete symbol body as parsed |
| L1 | Signature skeleton | Function/class signature, no body |
| L2 | Summary | One-line docstring or name + kind |
| L3 | Reference | Single file:line reference entry |

---

## MCP Tools

ContextWeave registers seven tools over the MCP stdio transport.

### `cw_capsule`

Generate a token-budgeted context capsule for a query.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | `string` | What you're working on or looking for |
| `token_budget` | `number?` | Max tokens for the capsule (default: 4000) |
| `mode` | `"debug" \| "refactor" \| "feature" \| "review"?` | Task mode affecting scoring weights (default: `"feature"`) |

Returns compressed AST-aware context with quality metrics, compression breakdown, and any relevant observations from memory.

### `cw_impact`

Analyze what breaks if a symbol or file changes. Traverses incoming edges (dependents) up to a configurable depth.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string` | Symbol name or file path to analyze |
| `depth` | `number?` | Max traversal depth (default: 3) |

### `cw_flow`

Trace call flow between two symbols or explore all outgoing flows from a source symbol.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string` | Source symbol name |
| `target` | `string?` | Target symbol name (omit to trace all outgoing paths) |
| `max_hops` | `number?` | Maximum path length (default: 5) |

### `cw_remember`

Persist a cross-session observation about the codebase. Stored at confidence 1.0 by default and injected into future capsules.

| Parameter | Type | Description |
|-----------|------|-------------|
| `scope` | `string` | Category: `architecture`, `bug`, `pattern`, `decision`, `todo`, `convention` |
| `note` | `string` | The observation to remember |
| `symbol` | `string?` | Symbol name to associate with |
| `confidence` | `number?` | Confidence level 0–1 (default: 1.0) |

### `cw_recall`

Retrieve prior observations from cross-session memory using BM25 search.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | `string` | What to search for in memory |
| `scope` | `string?` | Filter by scope category |
| `include_stale` | `boolean?` | Include stale observations (default: false) |
| `limit` | `number?` | Max results (default: 10) |

### `cw_status`

Show index health: file count, symbol count, edge count, observation count, stale observations, and the five most recent capsule generations.

| Parameter | Type | Description |
|-----------|------|-------------|
| `verbose` | `boolean?` | Show per-file breakdown (default: false) |

### `cw_reindex`

Force reindex a file, directory, or the entire project. Rebuilds the AST graph and recalculates centrality scores.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string?` | File or directory to reindex (omit for full project) |

---

## Installation

```bash
npm install contextweave
```

Initialize ContextWeave in your project root. This creates `.contextweave/config.json`, seeds the SQLite database, and runs an initial full index.

```bash
npx cw init
```

Add the MCP server to your `.mcp.json`:

```json
{
  "mcpServers": {
    "contextweave": {
      "command": "node",
      "args": ["./node_modules/.bin/cw", "serve"]
    }
  }
}
```

Start the server manually (Claude Code starts it automatically via `.mcp.json`):

```bash
npx cw serve
```

---

## Configuration

`.contextweave/config.json` is created by `cw init` with the following fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tokenBudget` | `number` | `4000` | Default token budget for capsule generation |
| `defaultMode` | `string` | `"feature"` | Default task mode (`debug`, `refactor`, `feature`, `review`) |
| `ignore` | `string[]` | `["node_modules","dist","build",".git",".next","coverage"]` | Glob patterns excluded from indexing |
| `stalenessDepth` | `number` | `2` | Graph hops before an observation is considered stale |
| `confidenceDecay` | `number` | `0.1` | Confidence decay rate applied to passive observations over time |
| `gcThreshold` | `number` | `0.1` | Minimum confidence before an observation is garbage-collected |

---

## Quality Metrics

Every capsule includes a `quality` block reporting retrieval health.

**Pivot coverage** — fraction of pivot symbols (directly matched by query) that made it into the packed output. Below 80% triggers a warning reason.

**Dependency coverage** — fraction of Stage B selected non-pivot symbols that survived packing. Below 35% is flagged.

**Noise ratio** — fraction of packed symbols with no lexical relevance to the query. Above 55% is flagged.

**Coverage confidence** — composite score: `pivotCoverage * 0.5 + dependencyCoverage * 0.3 + (1 - noiseRatio) * 0.2`. Below 0.65 triggers the uncertainty flag.

**Uncertainty** — three levels:
- `low`: no flags, coverage confidence ≥ 0.65
- `medium`: one flag reason, coverage confidence ≥ 0.45
- `high`: two or more flag reasons, or coverage confidence < 0.45

The capsule output header surfaces the uncertainty level and lists any flag reasons, so the agent knows when to be skeptical of the context it received.

---

## Passive Memory

ContextWeave builds memory automatically without any manual intervention.

Every time `cw_capsule` is called, the query and the resolved pivot symbols are recorded as a passive observation at confidence 0.5:

```
[auto] Query: "generateCapsule" resolved to: generateCapsule, packNodes
```

Every time a file changes (detected by the chokidar file watcher), the symbol-level diff — added, removed, and modified symbols — is recorded at confidence 0.6:

```
[auto] Modified: src/capsule/generator.ts — added: [scoreNode], removed: [], changed: [generateCapsule]
```

These passive observations accumulate across sessions in the SQLite database. When the next capsule is generated, BM25 search retrieves the most relevant observations and injects them into the capsule output alongside code, giving the model awareness of what has changed and what has been worked on previously.

Manual observations via `cw_remember` are stored at confidence 1.0 by default, so they rank above passive auto-observations in retrieval scoring. The combined score used for ranking is `confidence * bm25Score`.

---

## Benchmark

Average token reduction across test fixtures: **74.7%** with quality gates maintaining pivot coverage above 80%. The compression pipeline avoids the common failure mode of naive context windows: low-signal utility code (logging helpers, re-exports, deeply generic utilities) is pushed to L3 reference entries or dropped entirely while the symbols directly relevant to the query are preserved at full source.

---

## Technical Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js ≥22, TypeScript ESM |
| AST parsing | tree-sitter with TypeScript and JavaScript grammars |
| Database | better-sqlite3 (embedded SQLite) |
| File watching | chokidar v5 |
| MCP transport | `@modelcontextprotocol/sdk` stdio |
| Memory search | Custom BM25 full-text search over SQLite |
| Schema validation | zod |

---

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev

# Type check
npm run lint

# Run benchmark harness
npm run bench
```

The database is stored at `.contextweave/contextweave.db` and is excluded from version control. Delete it and re-run `cw init` to reset the index.
