# ContextWeave v2: Implementation Plan

**Goal:** Reverse-engineer Augment's Context Engine into ContextWeave as an open-source, local-first alternative. Fix every flaw from the 5 field reviews. Make `cw_capsule` reliable enough to replace Grep + Explorer Agent.

**Baseline:** ContextWeave has 12-language AST parsing, symbol graph, impact analysis, BM25 search, token-budgeted packing, cross-session memory, and a working MCP server with 12 tools. What's missing: semantic embeddings, hybrid search, enriched chunking, honest confidence, and several critical bug fixes.

**Reference implementations:** codemogger (tree-sitter + embeddings + SQLite + MCP), code-chunk (AST-aware chunking), retriv (hybrid BM25+vector), Cursor (Merkle tree indexing), Augment (quantized vector search, knowledge graph).

---

## Phase Overview

| Phase | Name | What It Does | Impact | Effort |
|-------|------|-------------|--------|--------|
| 0 | Critical Bug Fixes | Fix the 10 specific bugs the reviews found | Capsule goes from "poor" to "decent" | 2-3 days |
| 1 | AST-Aware Chunking | Build contextualized code chunks for embedding | Foundation for all semantic search | 3-4 days |
| 2 | Local Embedding Pipeline | Embed chunks with local model, store in sqlite-vec | Enables semantic search | 3-4 days |
| 3 | Hybrid Search + RRF | Combine BM25 + vector search with rank fusion | Capsule quality transforms | 3-4 days |
| 4 | Capsule Pipeline Overhaul | New intent routing, graph expansion, structured output | Agent-grade retrieval | 4-5 days |
| 5 | Intelligence Layer | Pattern detection, body-aware summaries, better flow | Augment-level capabilities | 5-7 days |
| 6 | Operational Excellence | Benchmarks, real metrics, incremental embeddings | Production readiness | 3-4 days |

**Total estimated scope:** 23-31 days of focused work.

**Dependencies:**
```
Phase 0 ──→ can start immediately (no dependencies)
Phase 1 ──→ can start immediately (no dependencies)
Phase 2 ──→ depends on Phase 1 (needs chunks to embed)
Phase 3 ──→ depends on Phase 2 (needs vectors to search)
Phase 4 ──→ depends on Phase 3 (needs hybrid search)
Phase 5 ──→ depends on Phase 1 (needs chunks for pattern detection)
Phase 6 ──→ depends on Phase 3 (needs hybrid search for benchmarks)

Phases 0 and 1 can run in parallel.
Phase 5 can start after Phase 1, in parallel with 2-4.
Phase 6 can start after Phase 3.
```

---

## Phase 0: Critical Bug Fixes

These are specific, targeted fixes to the existing codebase. Each one addresses a finding from the field reviews. No new libraries needed.

### 0.1 — Symbol-Name Exact Boost

**Problem:** When query is "useDataLayer", the capsule doesn't return `useDataLayer` as #1 result. Found in: Sitecraft, FocusPact, Claud-ometer, Codex reviews.

**File:** `src/capsule/pivot-scorer.ts`

**Fix:** Add an exact-match boost at the top of the pivot scoring function. If a query term exactly matches a symbol name (case-insensitive), that symbol gets a massive score boost (e.g., +50 on top of whatever BM25 gives it). This ensures the thing you asked about is always the first thing returned.

```
Logic:
- Tokenize query into terms
- For each pivot candidate, check if candidate.name === any query term (case-insensitive)
- Also check if candidate.name matches after camelCase split (e.g., "useDataLayer" matches "data layer")
- If exact match: boost score by +50
- If camelCase match: boost score by +25
- If file path contains the query term as a segment: boost by +10
```

**Acceptance:** Query "useDataLayer" on Sitecraft returns `useDataLayer` definition as #1 result.

### 0.2 — Kill Content Fallback for Exact Matches

**Problem:** Generator triggers content fallback when < 3 pivots found, injecting 90+ extra symbols from 10 files. Found in: Codex (30% pivot coverage on exact symbol), Claud-ometer (leaked neighbor functions).

**File:** `src/capsule/generator.ts` (where content fallback is triggered), `src/capsule/content-fallback.ts`

**Fix:** Add a fast-path check before content fallback. If the query resolved to 1-2 pivots AND those pivots are exact symbol-name matches (from 0.1), skip content fallback entirely. Return definition + callers + callees only.

```
Logic (in generator.ts, around the content fallback trigger):
- After initial pivot resolution, check:
  - If pivotCount <= 2 AND at least one pivot has an exact-name-match flag
  - Then: skip contentFallbackSearch(), instead enrich with:
    - The matched symbol's full_source
    - Its direct callers (from edges table, kind='call' or 'import', depth 1)
    - Its direct callees (from edges table, depth 1)
  - This produces a focused, precise capsule for narrow queries
```

**Acceptance:** Query "recommendFanout" on Codex returns only `recommendFanout` + direct callers/callees. No 90-pivot explosion.

### 0.3 — Fill the Token Budget

**Problem:** Budget 8,000 tokens, capsule returns 468 (6%). Found in: all 5 reviews. The >= 2000 refill gate and conservative skeletonization are the cause.

**Files:** `src/capsule/generator.ts` (refill gate), `src/capsule/packer.ts` (skeletonization)

**Fix:**
1. Remove or lower the `>= 2000` refill gate in generator.ts. Allow refill when budget utilization is < 60%, regardless of absolute budget size.
2. In the packer, after initial packing: if budget utilization < 60%, expand top-scored symbols from skeleton to full source, one at a time, until budget reaches ~85% utilization.
3. If still under budget after full-source expansion, include symbols from the next tier of relevance.

```
Logic:
- After initial pack: calculate utilization = tokensUsed / tokenBudget
- While utilization < 0.85 AND there are more symbols to expand:
  - Take the next highest-scored symbol that was skeletonized
  - Replace skeleton with full_source
  - Recalculate utilization
- While utilization < 0.85 AND there are adjacent-file symbols not yet included:
  - Add them at skeleton level
  - Recalculate utilization
```

**Acceptance:** Budget 8000 query on any codebase returns >= 5000 tokens of content.

### 0.4 — Calibrate Confidence Honestly

**Problem:** Reports HIGH confidence when retrieval is thin. Found in: all 5 reviews. The formula ignores token utilization and allows 1.0 on minimal coverage.

**File:** `src/capsule/confidence.ts`

**Fix:** Add hard caps based on observable retrieval quality signals:

```
Rules to add to computeCoverageConfidence():
1. If tokenUtilization < 0.30 → cap confidence at 0.40 (LOW)
2. If tokenUtilization < 0.50 → cap confidence at 0.60 (MEDIUM)
3. If pivotsIncluded < 3 AND intent is "broad" → cap at 0.50
4. If pivotCoverage (pivotsIncluded/totalRelevantPivots) < 0.30 → cap at 0.50
5. Never return > 0.90 unless tokenUtilization > 0.60 AND pivotCoverage > 0.60
```

Add `tokenUtilization` as a new required field in `ConfidenceParams`. Pass it from the generator after packing.

**Acceptance:** Broad query using 320/1800 tokens no longer reports HIGH confidence. Reports MEDIUM or LOW.

### 0.5 — Fix Cross-Session Feedback Contamination

**Problem:** post-tool-use updates the globally latest capsule log row, not the active session's. Found in: Sitecraft review (twice), confirmed by code inspection.

**File:** `src/hooks/post-tool-use.ts`

**Fix:** The hook currently opens its own DB connection and queries `capsule_log` without session filtering. Fix:
1. Accept `session_id` in the hook input (from Claude Code's hook context)
2. When updating capsule_log, filter by `session_id` not just "latest row"
3. If no session_id available, filter by the most recent capsule_log entry that matches the current `project_root`

```
Change in handlePostToolUse():
- Currently: queries capsule_log ORDER BY timestamp DESC LIMIT 1
- Fix: queries capsule_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1
- Fallback: WHERE project_root matches, ORDER BY timestamp DESC LIMIT 1
```

**Acceptance:** Two concurrent sessions don't corrupt each other's feedback data.

### 0.6 — Separate Bootstrap Memory from Code Capsules

**Problem:** Bootstrap seeds README/CLAUDE.md as 0.9-confidence observations. Capsule formatter emits them first, stealing budget from actual code. Found in: KisanSathi, Codex, Sitecraft.

**Files:** `src/memory/bootstrap.ts`, `src/capsule/formatter.ts`

**Fix:**
1. In `bootstrap.ts`: change the default confidence for seeded observations from 0.9 to 0.5. Tag them with `scope: "documentation"` or `scope: "convention"` (they already are).
2. In `formatter.ts`: when the query intent is "narrow" or classified as a code/symbol query, filter out observations with scope "documentation" or "convention" from the capsule output. Only include them when the query explicitly asks about docs, architecture, conventions, or workflow.
3. Hard-cap documentation observations to max 200 tokens in any capsule.

**Acceptance:** Narrow query "SecurityConfig authentication" on KisanSathi doesn't start with CLAUDE.md instructions.

### 0.7 — Directory Weighting for Mixed Repos

**Problem:** `src/main/resources/static/` ranked same as `src/main/java/`. Legacy dirs pollute results. Found in: KisanSathi, Sitecraft.

**File:** `src/utils/directory-weights.ts`

**Fix:** Add auto-downweight rules for common non-runtime paths:

```
Paths to downweight (multiply score by 0.1-0.3):
- resources/static/*, assets/*, public/*, dist/*, vendor/*
- *_demo_*, *_legacy_*, *_old_*, *_archive_*
- templates/admin/*, templates/vendor/*
- Any path with "demo", "example", "sample" as a directory segment

Paths to upweight (multiply score by 1.5-2.0):
- src/main/java/* (for Java/Spring repos)
- src/app/*, src/lib/*, src/core/* (for Next.js/React repos)
- Internal packages (packages/*, libs/*)
```

Also add support for a `.contextweave/config.json` field `primaryDirs` and `archiveDirs` that users can set explicitly.

**Acceptance:** Broad shopping-flow query on KisanSathi returns Java backend files, not static JS.

### 0.8 — TSX Parser Tolerance

**Problem:** Valid TSX files marked as syntax errors because `&` in JSX text triggers tree-sitter ERROR. Found in: FocusPact, Claud-ometer.

**File:** `src/core/parser.ts`

**Fix:** After parsing, check `rootNode.hasError`. If true, do a second pass:
1. Count the number of ERROR nodes in the tree
2. If ERROR nodes are only in JSX text positions (parent is `jsx_text` or `jsx_expression`), classify as "benign parse warning" not "file error"
3. Only record `error` in the files table if there are ERROR nodes in non-JSX-text positions
4. For benign warnings, still extract all symbols normally

```
Logic:
- After parse, if rootNode.hasError:
  - Walk tree, collect all ERROR nodes
  - For each ERROR node, check if parent.type is 'jsx_text' or similar
  - If ALL errors are in JSX text: file.error = null (not broken)
  - If ANY errors are in non-JSX positions: file.error = "syntax error at line X"
```

**Acceptance:** `SafetyGuardModal.tsx` and `SettingsModal.tsx` from FocusPact no longer flagged as errors.

### 0.9 — Normalize cw_grep Regex Semantics

**Problem:** `/fooBar/` treated literally in ripgrep path but as regex in fallback. `{}` brace syntax silently fails. Found in: Sitecraft, Claud-ometer.

**Files:** `src/mcp/tools/search.ts`, `src/mcp/tools/path-filters.ts`

**Fix:**
1. In `search.ts`: detect if query is wrapped in `/slashes/` — if so, treat as regex in both backends. Strip the slashes and set `use_regex: true` automatically.
2. In `path-filters.ts`: add support for `{ts,tsx}` brace expansion by expanding `**/*.{ts,tsx}` into `["**/*.ts", "**/*.tsx"]` before passing to the filter engine. If brace syntax can't be expanded, throw a clear error message instead of silently failing.

**Acceptance:** `cw_grep("fooBar", glob: "**/*.{ts,tsx}")` returns consistent results regardless of backend.

### 0.10 — Startup Self-Healing for Derived Artifacts

**Problem:** Existing indexes after migration have file_summaries=0. cw_overview can't work. Found in: Codex review.

**File:** `src/mcp/server.ts` (startup), `src/core/indexer.ts`

**Fix:** After running migrations at startup, check if `file_summaries` table is empty but `files` table has rows. If so, trigger a background backfill of file summaries and clusters. Don't block MCP serving — do it asynchronously.

```
Logic in server startup (after migrations):
- SELECT COUNT(*) FROM file_summaries
- SELECT COUNT(*) FROM files
- If files > 0 AND file_summaries == 0:
  - Log warning: "Backfilling file summaries for existing index..."
  - Call backfillSummariesIfNeeded(db) and backfillClustersIfNeeded(db)
  - This already exists in indexer.ts — just need to call it from startup
```

**Acceptance:** Opening a pre-existing project with ContextWeave auto-generates file summaries.

---

## Phase 1: AST-Aware Chunking for Embeddings

This phase builds the chunking infrastructure that converts tree-sitter AST output into enriched, embeddable code chunks. This is the foundation for all semantic search.

### 1.1 — New Dependencies

```bash
npm install code-chunk
```

The `code-chunk` library (by supermemoryai, MIT license, 152 stars, 1.1K weekly downloads) provides:
- Tree-sitter based AST parsing
- 5-stage pipeline: Parse → Extract → Build Scope Tree → Chunk → Enrich
- Contextualized text output optimized for embedding models
- Supports: TypeScript, JavaScript, Python, Rust, Go, Java
- Default chunk size: 1500 bytes, configurable
- Never splits mid-function

For languages code-chunk doesn't support (C, C++, C#, Ruby, Bash, PHP — the remaining 6 ContextWeave languages), we'll build a fallback chunker using ContextWeave's existing tree-sitter parsing.

### 1.2 — New File: `src/core/chunker.ts`

This module produces embeddable chunks from source files.

```
Interface:

export interface CodeChunk {
  id: string;                    // fileId:startLine-endLine
  filePath: string;              // project-relative path
  fileId: number;                // from files table
  language: string;
  startLine: number;
  endLine: number;
  rawCode: string;               // the actual code
  contextualizedText: string;    // scope chain + imports + signatures + code (for embedding)
  symbols: string[];             // symbol names contained in this chunk
  kind: string;                  // 'function' | 'class' | 'method' | 'module' | 'mixed'
  scopeChain: string;            // e.g., "UserService > getUser"
  imports: string[];             // imports used by this chunk
  siblingSignatures: string[];   // signatures of adjacent code
}

export function chunkFile(
  filePath: string,
  source: string,
  language: string,
  fileId: number
): CodeChunk[]

export function chunkProject(
  db: Database,
  projectRoot: string,
  options?: { maxChunkSize?: number; concurrency?: number }
): AsyncGenerator<CodeChunk[]>
```

**Implementation:**
1. For TypeScript, JavaScript, Python, Rust, Go, Java: use `code-chunk` library
   - Call `chunkCode({ code: source, language, maxChunkSize: 1500, contextMode: 'full' })`
   - Map the output to our `CodeChunk` interface
   - Add `fileId` and `filePath` from our index
2. For C, C++, C#, Ruby, Bash, PHP: fallback chunker
   - Use ContextWeave's existing tree-sitter parser to get symbols
   - Each symbol with `full_source` becomes a chunk
   - Enrich with: file path, imports (from edges table), adjacent symbol signatures
   - For symbols > 1500 bytes, split at statement boundaries
3. For files with no symbols (config, data): single chunk per file, max 2000 bytes

**Contextualized text format** (prepended before raw code for embedding):

```
File: src/lib/auth/session.ts
Scope: AuthModule > SessionManager > validateSession
Imports: supabase, jwt, UserModel
Siblings: createSession(user: User): Promise<Session>, revokeSession(id: string): void
---
export async function validateSession(token: string): Promise<Session | null> {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  ...
}
```

### 1.3 — New DB Table: `chunks`

**File:** `src/db/schema.ts` (add to migrations), `src/db/migrations.ts`

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  start_line       INTEGER NOT NULL,
  end_line         INTEGER NOT NULL,
  kind             TEXT    NOT NULL,
  scope_chain      TEXT    NOT NULL DEFAULT '',
  symbols          TEXT    NOT NULL DEFAULT '[]',  -- JSON array of symbol names
  contextualized   TEXT    NOT NULL,                -- full text for embedding
  raw_code         TEXT    NOT NULL,
  token_count      INTEGER NOT NULL DEFAULT 0,
  embedding        BLOB,                            -- NULL until Phase 2 embeds it
  created_at       INTEGER NOT NULL,
  UNIQUE(file_id, start_line, end_line)
);

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks(embedding) WHERE embedding IS NOT NULL;
```

### 1.4 — Integrate Chunking into Indexer

**File:** `src/core/indexer.ts`

After indexing a file's symbols and edges (existing flow), add a chunking step:

```
In indexSingleFile() or the post-parse hook:
1. Call chunkFile(filePath, source, language, fileId)
2. For each chunk:
   - INSERT OR REPLACE INTO chunks (file_id, start_line, end_line, kind, scope_chain, symbols, contextualized, raw_code, token_count, created_at)
   - Leave embedding as NULL (Phase 2 fills this)
3. Delete any old chunks for this file that no longer exist (changed file structure)
```

**For incremental re-indexing:** When a file changes and gets re-indexed:
1. Delete old chunks for that file
2. Re-chunk and insert new chunks
3. Mark new chunks as needing embedding (embedding = NULL)

### 1.5 — Tests

- Test that a TypeScript file produces correct chunks with scope chains
- Test that a Python file produces correct chunks
- Test that a >150 line function gets subdivided
- Test that chunks never split mid-expression
- Test that the fallback chunker works for C/Ruby/PHP
- Test incremental: modify a file, re-index, verify old chunks deleted and new chunks created

---

## Phase 2: Local Embedding Pipeline

This phase adds the ability to convert code chunks into vector embeddings using a local model. No API keys, no cloud, no cost.

### 2.1 — New Dependencies

```bash
npm install @huggingface/transformers sqlite-vec
```

**@huggingface/transformers** (Transformers.js):
- Runs ONNX models locally in Node.js (via ONNX Runtime)
- v4 supports WebGPU in Node.js for acceleration
- Model: `Xenova/all-MiniLM-L6-v2` — 384 dimensions, quantized to q8
- First load downloads ~23MB model, cached locally thereafter
- Embedding speed: ~10-50ms per chunk on CPU
- No API keys, no cloud, fully offline after first download

**sqlite-vec**:
- SQLite extension for vector similarity search
- Works directly with better-sqlite3 via `sqliteVec.load(db)`
- Stores vectors as BLOBs, provides `vec_distance_cosine()` function
- Creates virtual tables with `vec0` for indexed vector search
- Already compatible with ContextWeave's better-sqlite3 setup

### 2.2 — New File: `src/core/embedder.ts`

```
Interface:

export interface EmbedderOptions {
  modelName?: string;      // default: 'Xenova/all-MiniLM-L6-v2'
  dimensions?: number;     // default: 384
  dtype?: string;          // default: 'q8' (quantized)
  batchSize?: number;      // default: 32
  device?: string;         // default: 'auto' (picks best: GPU > WASM > CPU)
}

export class LocalEmbedder {
  static async create(options?: EmbedderOptions): Promise<LocalEmbedder>

  // Embed a single text string
  async embed(text: string): Promise<Float32Array>

  // Embed a batch of texts (more efficient)
  async embedBatch(texts: string[]): Promise<Float32Array[]>

  // Cleanup / release model
  async dispose(): void
}
```

**Implementation:**

```typescript
import { pipeline } from '@huggingface/transformers';

class LocalEmbedder {
  private extractor;

  static async create(options) {
    const instance = new LocalEmbedder();
    instance.extractor = await pipeline(
      'feature-extraction',
      options.modelName ?? 'Xenova/all-MiniLM-L6-v2',
      { dtype: options.dtype ?? 'q8', device: options.device ?? 'auto' }
    );
    return instance;
  }

  async embed(text: string): Promise<Float32Array> {
    const result = await this.extractor(text, { pooling: 'mean', normalize: true });
    return new Float32Array(result.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Process in batches for memory efficiency
    const results = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const output = await this.extractor(batch, { pooling: 'mean', normalize: true });
      // Split batch output into individual vectors
      for (let j = 0; j < batch.length; j++) {
        results.push(new Float32Array(output[j].data));
      }
    }
    return results;
  }
}
```

### 2.3 — New File: `src/core/vector-store.ts`

Manages vector storage and search using sqlite-vec.

```
Interface:

export class VectorStore {
  constructor(db: Database)

  // Initialize sqlite-vec extension and create virtual table
  initialize(): void

  // Store embedding for a chunk
  storeEmbedding(chunkId: number, embedding: Float32Array): void

  // Store embeddings in batch (much faster)
  storeBatch(entries: Array<{ chunkId: number; embedding: Float32Array }>): void

  // Search for nearest neighbors
  search(queryEmbedding: Float32Array, limit?: number): VectorSearchResult[]

  // Search with file path filter
  searchWithFilter(
    queryEmbedding: Float32Array,
    pathFilter?: string,    // glob pattern
    limit?: number
  ): VectorSearchResult[]

  // Check if a chunk has an embedding
  hasEmbedding(chunkId: number): boolean

  // Count chunks with/without embeddings
  stats(): { total: number; embedded: number; pending: number }
}

export interface VectorSearchResult {
  chunkId: number;
  fileId: number;
  filePath: string;
  startLine: number;
  endLine: number;
  distance: number;       // cosine distance (lower = more similar)
  kind: string;
  scopeChain: string;
  symbols: string[];
}
```

**Implementation using sqlite-vec:**

```typescript
import * as sqliteVec from 'sqlite-vec';

class VectorStore {
  constructor(db) {
    this.db = db;
  }

  initialize() {
    sqliteVec.load(this.db);

    // Create vec0 virtual table for ANN search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding float[384]
      );
    `);
  }

  storeEmbedding(chunkId, embedding) {
    this.db.prepare(
      'INSERT OR REPLACE INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)'
    ).run(chunkId, Buffer.from(embedding.buffer));
  }

  search(queryEmbedding, limit = 20) {
    const rows = this.db.prepare(`
      SELECT cv.chunk_id, cv.distance,
             c.file_id, f.path as filePath,
             c.start_line, c.end_line, c.kind, c.scope_chain, c.symbols
      FROM chunk_vectors cv
      JOIN chunks c ON c.id = cv.chunk_id
      JOIN files f ON f.id = c.file_id
      WHERE embedding MATCH ?
      AND k = ?
      ORDER BY distance
    `).all(Buffer.from(queryEmbedding.buffer), limit);

    return rows.map(r => ({
      ...r,
      symbols: JSON.parse(r.symbols)
    }));
  }
}
```

### 2.4 — Integrate Embedding into Index Pipeline

**File:** `src/core/indexer.ts`

After chunking (Phase 1.4), embed the chunks:

```
New function: embedPendingChunks(db, embedder)
1. SELECT id, contextualized FROM chunks WHERE embedding IS NULL
2. Batch the texts (32 at a time)
3. Call embedder.embedBatch(texts)
4. For each result, call vectorStore.storeEmbedding(chunkId, vector)
5. Update chunks SET embedding = vector WHERE id = chunkId

This runs:
- During initial indexProject() — after all files parsed and chunked
- During incremental re-index — only for new/changed chunks
- As a background task after startup self-healing (Phase 0.10)
```

**Performance targets:**
- 1000 chunks: ~30-50 seconds on CPU (first run only)
- Incremental: 5-10 chunks per file change: ~0.5-1.5 seconds
- Memory: ~200MB for model + ~50MB for 100k chunks

### 2.5 — Graceful Degradation

If the embedding model fails to load (unsupported platform, OOM, etc.):
- Log a warning
- Fall back to BM25-only search (current behavior)
- Set a flag `embeddingsAvailable = false` on the server
- Include this in `cw_status` output so the user knows

### 2.6 — Tests

- Test that LocalEmbedder produces 384-dim vectors
- Test that similar code chunks have high cosine similarity
- Test that dissimilar code has low similarity
- Test VectorStore CRUD operations
- Test search returns results ordered by distance
- Test batch embedding performance (>100 chunks)
- Test graceful degradation when model unavailable

---

## Phase 3: Hybrid Search with Rank Fusion

This phase combines BM25 (existing) and vector search (Phase 2) into a single unified retrieval layer.

### 3.1 — New File: `src/core/hybrid-ranker.ts`

```
Interface:

export interface HybridSearchOptions {
  query: string;
  queryTerms: string[];        // from intent classifier
  queryEmbedding: Float32Array; // from embedder
  limit?: number;               // default: 30
  pathFilter?: string;          // glob
  pathRestriction?: string;     // directory
  mode?: CapsuleMode;
  recencyBoost?: boolean;       // default: true
}

export interface HybridSearchResult {
  fileId: number;
  filePath: string;
  symbolIds: number[];         // symbols in this chunk
  chunkId: number;
  startLine: number;
  endLine: number;
  scopeChain: string;
  kind: string;
  bm25Rank: number | null;    // rank in BM25 results (null if not found)
  vectorRank: number | null;   // rank in vector results (null if not found)
  exactMatchRank: number | null; // rank in exact symbol-name match (null if not found)
  rrfScore: number;            // final fused score
  recencyScore: number;        // bonus for recently modified files
}

export function hybridSearch(
  db: Database,
  vectorStore: VectorStore,
  options: HybridSearchOptions
): HybridSearchResult[]
```

**Implementation — Three-Signal RRF:**

```
The hybrid ranker fuses THREE ranked lists:

Signal 1: BM25 (existing FTS5 search)
  - Query the existing bm25_index / symbols FTS
  - Group results by chunk (map symbol → containing chunk)
  - Produce ranked list A

Signal 2: Vector Similarity (new)
  - Embed the query using LocalEmbedder
  - Search chunk_vectors for nearest neighbors
  - Produce ranked list B

Signal 3: Exact Symbol-Name Match (new, from Phase 0.1)
  - Query symbols table for exact name matches
  - Map to containing chunks
  - Produce ranked list C

Fusion with Reciprocal Rank Fusion (RRF):
  For each unique chunk across all three lists:
    rrfScore = w1 * 1/(k + rankA) + w2 * 1/(k + rankB) + w3 * 1/(k + rankC)

  Where:
    k = 60 (standard RRF constant)
    w1 = 1.0 (BM25 weight)
    w2 = 1.0 (vector weight)
    w3 = 2.0 (exact match weight — doubled because it's the highest-precision signal)

  If a chunk doesn't appear in a list, that term contributes 0.

Recency bonus (optional):
  For each result, check the file's mtime from the files table.
  Files modified in the last 24h: +0.1 bonus
  Files modified in the last 7d: +0.05 bonus
  This gently promotes recently-active code without dominating the ranking.

Sort by final rrfScore descending.
Return top `limit` results.
```

### 3.2 — Replace Pivot Resolution in Generator

**File:** `src/capsule/generator.ts`

The current generator finds pivots via BM25 + fuzzy matching + path matching. Replace the initial retrieval step with the hybrid ranker:

```
Current flow:
  query → BM25 FTS search → pivot candidates → scorer → pack

New flow:
  query → embed query → hybridSearch(BM25 + vector + exact) → pivot candidates → scorer → pack

Specifically:
1. Embed the query: const queryEmbedding = await embedder.embed(query)
2. Call hybridSearch(db, vectorStore, { query, queryTerms, queryEmbedding, ... })
3. Map HybridSearchResults to ScoredNode[] (the existing type the packer expects)
4. Continue with existing scoring, packing, formatting pipeline
```

The hybrid ranker replaces:
- The manual FTS queries in the generator
- The content-fallback search (no longer needed — vector search covers it)
- The semantic-reranker.ts (replaced by real vector similarity)

### 3.3 — Update `cw_capsule` MCP Tool

**File:** `src/mcp/tools/capsule.ts`

The tool wrapper needs to:
1. Get the embedder instance from the server context
2. Pass it to the generator
3. Handle the case where embeddings aren't available (graceful degradation to BM25-only)

### 3.4 — Update `cw_overview` to Use Hybrid Search

**File:** `src/mcp/tools/overview.ts`

Currently `cw_overview` does lexical file-summary search and often returns "no matches." With hybrid search:
1. Embed the overview query
2. Use vector search to find semantically relevant chunks
3. Group by file → produce file-level overview
4. This fixes the "no focused matches found" problem from every review

### 3.5 — Tests

- Test that hybrid search returns results when BM25 misses (semantic query)
- Test that hybrid search returns results when vector misses (exact identifier)
- Test RRF fusion produces correct ordering
- Test recency boost doesn't dominate ranking
- Test with path filters
- Benchmark: hybrid search latency on 1000-file project (target: < 500ms)
- Integration: cw_capsule with hybrid search produces better results than BM25-only

---

## Phase 4: Capsule Pipeline Overhaul

This phase rebuilds the capsule generation pipeline to be agent-grade: proper intent routing, graph expansion, structured output, and file-qualified follow-ups.

### 4.1 — Rewrite Intent Classifier

**File:** `src/capsule/intent-classifier.ts`

**Problem from reviews:** Term-count heuristic classifies "where is session search filtering implemented" as broad because it has many words. Natural-language narrow queries get misrouted.

**New classification logic:**

```
Intent types (expanded):
- "symbol-lookup": query contains or resolves to an exact symbol name
  → Route to: exact match fast path (skip fallback, return definition + callers)
- "narrow": query asks about a specific file, function, or behavior
  → Route to: focused hybrid search, small result set, full source for top hits
- "broad": query asks about architecture, flow, or "how does X connect to Y"
  → Route to: broad hybrid search, graph expansion, multiple clusters
- "debug": query asks about errors, bugs, or failures
  → Route to: narrow search + error-related files + test files

Detection signals:
- If query exactly matches a symbol name → "symbol-lookup"
- If query starts with "where", "find", "show me", "what is" + contains < 5 content terms → "narrow"
- If query contains "how does", "explain", "architecture", "end to end", "flow", "connect" → "broad"
- If query contains "error", "bug", "fix", "broken", "failing" → "debug"
- Fallback: count unique content terms. < 4 → "narrow", >= 4 → "broad"

Key fix: presence of question words ("where", "how") does NOT make it broad.
Only semantic indicators like "architecture", "end to end", "connect" do.
```

### 4.2 — Graph Expansion After Initial Retrieval

**File:** `src/capsule/generator.ts` (new step after hybrid search)

After hybrid search returns initial results, walk the graph to find connected context:

```
For each top-10 result from hybrid search:
1. Get the symbols in that chunk
2. For each symbol, query edges table for:
   - Direct callers (incoming edges, kind='call')
   - Direct callees (outgoing edges, kind='call')
   - Type relationships (kind='implements', 'extends', 'uses_type')
3. For each found connected symbol:
   - If it's in a file not yet in the results, add it at lower priority
   - If it's in a file already in results, boost that file's score
4. Cap expansion at 20 additional symbols to prevent explosion

This is what Augment's "knowledge graph expansion" does:
vector search finds the starting points, graph traversal finds the connected context.
```

### 4.3 — Structured JSON Output

**Files:** `src/capsule/formatter.ts`, `src/mcp/tools/capsule.ts`, `src/core/types.ts`

Add structured output alongside the text output:

```typescript
interface StructuredCapsuleOutput {
  // Metadata
  query: string;
  intent: QueryIntent;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  uncertainty: string;
  tokenBudget: number;
  tokensUsed: number;
  tokenUtilization: number;

  // Ranked files with reasons
  files: Array<{
    path: string;
    relevance: number;        // 0-1 score
    reason: string;           // why this file is relevant
    symbols: string[];        // key symbols from this file
    startLine?: number;
    endLine?: number;
  }>;

  // Follow-up actions (file-qualified)
  suggestedReads: Array<{
    tool: 'cw_read';
    args: { file: string; symbol: string };
    reason: string;
  }>;

  // Observations
  observations: string[];

  // The text capsule (for backward compatibility)
  text: string;
}
```

Return both `text` and `structuredContent` from the MCP tool. Agents that can parse JSON get structured data; others get the text.

### 4.4 — File-Qualified Follow-Up Commands

**File:** `src/capsule/formatter.ts`

**Problem from reviews:** Follow-ups suggest `cw_read(symbol: "X")` without file path, causing resolution ambiguity.

**Fix:** All follow-up suggestions must include the file path:

```
Before: "For more detail: cw_read(symbol: 'getSites')"
After:  "For more detail: cw_read(file: 'src/lib/supabase/queries.ts', symbol: 'getSites')"
```

Generate by: for each suggested symbol, look up its file path from the symbols table.

### 4.5 — Query-Aware Follow-Up Ranking

**File:** `src/capsule/formatter.ts`

**Problem from reviews:** Follow-ups ranked by score only, not by unresolved query terms.

**Fix:** After packing the capsule, check which query terms are NOT covered by the packed symbols. Rank follow-up suggestions by how many uncovered terms they address, not by their generic centrality score.

### 4.6 — Tests

- Test intent classification: "useDataLayer" → symbol-lookup, "how does auth connect" → broad
- Test graph expansion finds callers/callees not in initial search
- Test structured output contains all required fields
- Test follow-ups are file-qualified
- Test follow-ups prioritize uncovered query terms

---

## Phase 5: Intelligence Layer

This phase adds the capabilities that make ContextWeave go beyond search and into real code understanding — matching what makes Augment feel "magical."

### 5.1 — Body-Aware File Summaries

**File:** `src/core/file-summaries.ts`

**Problem from reviews:** File summaries only contain path tokens, symbol names, signatures, and kinds. They don't index string literals, JSX text, SQL table names, or important API calls. This is why `cw_overview` misses "realtime supabase session" even though the code plainly exists.

**Fix:** Enhance `upsertFileSummary()` to extract and index:

```
New fields to extract from full_source of symbols in each file:
1. String literals: extract quoted strings > 4 chars (for API endpoints, table names, channel names)
2. JSX text content: text inside JSX elements (for UI text search)
3. SQL identifiers: table names from SQL queries (SELECT/INSERT/UPDATE/DELETE ... FROM/INTO)
4. Important function calls: names of called functions (fetch, supabase.from, prisma.*)
5. Framework patterns: route paths from decorators (@Get, @Post, @RequestMapping)
6. Environment variables: process.env.* references

Store these in a new `body_features` TEXT column in file_summaries.
Include body_features in the FTS index for file summaries.
```

### 5.2 — Pattern Detection Engine

**New file:** `src/core/pattern-detector.ts`

This is the feature that makes Augment understand "every dashboard page follows pattern X."

```
Interface:

export interface CodePattern {
  id: string;                     // hash of the pattern signature
  name: string;                   // human-readable name
  description: string;            // what the pattern is
  files: string[];                // which files follow this pattern
  confidence: number;             // how sure we are (based on # of instances)
  signature: PatternSignature;    // the structural fingerprint
}

export interface PatternSignature {
  importShape: string[];          // sorted list of import sources
  exportShape: string[];          // kinds of exports (function, class, const)
  hookUsage: string[];            // React hooks used
  symbolKinds: string[];          // kinds of symbols defined
  directoryPattern: string;       // e.g., "src/app/*/page.tsx"
}

export function detectPatterns(db: Database): CodePattern[]
```

**How it works:**

```
1. For each file in the index:
   - Compute a PatternSignature:
     - What does it import? (sorted list of import sources)
     - What does it export? (function, class, const, default)
     - What hooks does it use? (useState, useEffect, useRouter, etc.)
     - What symbol kinds does it define?
     - What directory pattern does it match? (e.g., src/app/*/page.tsx)

2. Hash each PatternSignature into a fingerprint

3. Group files by fingerprint

4. Groups with 3+ files = detected pattern
   - Name it based on the directory pattern + common imports
   - e.g., "Dashboard Page Pattern: imports useDataLayer, exports default function, uses useState/useEffect"

5. Store detected patterns in a new `patterns` table:
   CREATE TABLE IF NOT EXISTS patterns (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     description TEXT NOT NULL,
     files       TEXT NOT NULL,   -- JSON array of file paths
     signature   TEXT NOT NULL,   -- JSON PatternSignature
     confidence  REAL NOT NULL,
     detected_at INTEGER NOT NULL
   );

6. Run detection:
   - During indexProject() after all files processed
   - During periodic background refresh
   - Incrementally: when files change, recompute patterns for affected directory groups
```

**Integration with capsule:**
When a broad query mentions a directory or concept that matches a pattern, include the pattern description in the capsule. This tells the agent "all files in this directory follow this pattern" without having to show every file.

### 5.3 — Smart Observation Promotion

**File:** `src/memory/observations.ts`

**Problem from reviews:** All observations are equal weight. Doc quotes and learned patterns rank the same.

**Fix:** Add observation promotion logic:

```
1. Track observation "hit count" — how many times an observation was relevant to a capsule query
2. When an observation is relevant to 3+ different queries across sessions:
   - Promote to "convention" scope
   - Boost confidence to 0.9
   - These are durable patterns the system has validated
3. When an observation hasn't been relevant to any query in 30+ days:
   - Demote confidence by 0.1 per period
   - Eventually archive (existing staleness logic)
```

### 5.4 — Improved Flow Tracing

**File:** `src/mcp/tools/flow.ts`, `src/core/indexer.ts` (edge creation)

**Problem from reviews:** cw_flow can't trace real call chains. Can't resolve imports to exports, track aliases, or trace callbacks.

**Improvements (incremental, not a full rewrite):**

```
1. Import resolution (in indexer.ts):
   - When creating an import edge, try to resolve to the actual exported symbol
   - Currently: import { foo } from './bar' creates edge to the file
   - New: resolve to the specific exported symbol 'foo' in bar.ts
   - Use existing tsconfig-paths.ts for alias resolution

2. Callback tracking (in indexer.ts):
   - When a function is passed as argument to another function, create a 'callback' edge
   - Detect: someFunction(myHandler) → edge from someFunction to myHandler
   - Detect: <Component onClick={handleClick} /> → edge from Component to handleClick

3. Server action edges (in indexer.ts):
   - For Next.js: 'use server' functions → create 'server-action' edge type
   - For Express: app.get('/path', handler) → create 'route-handler' edge

4. In flow.ts:
   - Include 'callback' and 'server-action' edges in traversal
   - Weight them lower than direct call edges but include them
   - Show edge type in output so agent understands the connection
```

### 5.5 — IDF-Style Term Suppression

**File:** `src/capsule/query-decomposer.ts`

**Problem from reviews:** Common code words like "get", "page", "query", "route" contaminate ranking because they appear everywhere.

**Fix:** Compute term frequency across the codebase and suppress high-frequency terms:

```
1. During indexing, compute document frequency for each term:
   - How many files contain this term in symbol names?
   - Store in a term_frequency table or compute on demand

2. In query decomposition, compute IDF weight per term:
   - IDF(term) = log(totalFiles / filesContainingTerm)
   - Terms with very low IDF (appear in >50% of files): suppress their weight in scoring
   - Terms with high IDF (appear in <5% of files): boost their weight

3. Pass IDF weights to the pivot scorer and hybrid ranker
   - High-IDF terms should dominate the ranking
   - Low-IDF terms should be tiebreakers, not primary signals
```

### 5.6 — Tests

- Test pattern detection finds 3+ files with same import/export shape
- Test body-aware summaries find "supabase" in a file that uses it in code body
- Test IDF suppression reduces noise from "get" and "page"
- Test improved flow tracing resolves import → export
- Test callback detection creates correct edges
- Test observation promotion after 3+ hits

---

## Phase 6: Operational Excellence

This phase makes ContextWeave production-ready with real metrics, benchmarks, and reliable operation.

### 6.1 — Benchmark Suite from Real Reviews

**New file:** `bench/retrieval-quality.ts`

Create a benchmark suite using the exact queries and expected files from the 5 field reviews:

```typescript
const BENCHMARK_QUERIES = [
  // Sitecraft
  {
    name: 'sitecraft-narrow',
    query: 'useDataLayer hook implementation and all components that import it',
    expectedFiles: ['src/lib/dataLayer.ts'],
    expectedSymbols: ['useDataLayer'],
    mode: 'narrow',
  },
  {
    name: 'sitecraft-broad',
    query: 'auth + dashboard + data layer connections',
    expectedFiles: ['proxy.ts', 'dataLayer.ts', 'AuthProvider.tsx'],
    mustNotInclude: ['AboutApp', 'legal/terms'],
    mode: 'broad',
  },
  // FocusPact
  {
    name: 'focuspact-narrow',
    query: 'where is the minimum focus duration and zombie protocol enforced when stopping a session',
    expectedFiles: ['session-rules.ts', 'sessions.ts', 'sessions/stop/route.ts'],
    mode: 'narrow',
  },
  // ... more from each review
];

// For each query:
// 1. Run cw_capsule with the query
// 2. Check: does the capsule contain the expected files/symbols?
// 3. Check: does it NOT contain the must-not-include items?
// 4. Check: is confidence calibrated (not HIGH on thin retrieval)?
// 5. Check: is budget utilized > 50%?
// 6. Report precision, recall, and F1 per query
```

### 6.2 — Real Token Savings Metrics

**File:** `src/mcp/tools/stats.ts`

Replace the inflated savings metric with honest comparisons:

```
Current: savings = 1 - (capsuleTokens / sumOfAllFileTokens)
Problem: assumes alternative is reading ALL files, which no agent does

New metrics:
1. "Capsule tokens used": actual tokens in the capsule
2. "Equivalent grep+read cost": estimate based on
   - Number of files the capsule covers × average file size in tokens
   - This is what an agent would have read to get the same information
3. "Budget utilization": tokensUsed / tokenBudget (should be > 60%)
4. "First-pass hit rate": % of queries where the capsule contained the right answer
   (tracked via post-tool-use feedback — was there a follow-up Read on a file NOT in the capsule?)
5. "Follow-up rate": average number of follow-up tool calls after a capsule
   (lower is better — means the capsule answered the question)
```

### 6.3 — Incremental Embedding Updates

**File:** `src/core/watcher.ts`

The watcher already exists and uses `@parcel/watcher`. Extend it to update embeddings:

```
When a file changes:
1. Re-index the file (existing behavior)
2. Re-chunk the file (new: delete old chunks, create new chunks)
3. Embed new chunks (new: call embedder.embedBatch for the new chunks)
4. Update the vector store (new: remove old vectors, insert new vectors)

This keeps the embedding index fresh without full re-indexing.
Typical cost: 5-10 chunks per file × 10-50ms per embedding = 50-500ms per file change.
```

### 6.4 — Project-Relative Paths in DB

**File:** `src/core/indexer.ts`

**Problem from reviews:** Absolute paths stored in DB leak machine-local paths and hurt portability.

**Fix:** Store project-relative paths in the `files` table. Resolve to absolute only when reading files. This is a migration:

```
1. New migration: UPDATE files SET path = replace(path, ?, '') where ? is projectRoot
2. Update all queries that use file paths to resolve relative → absolute at read time
3. Update all output formatters to display relative paths
```

### 6.5 — Embedding Model Configuration

**File:** `src/utils/config.ts`

Allow users to configure the embedding model in `.contextweave/config.json`:

```json
{
  "embedding": {
    "model": "Xenova/all-MiniLM-L6-v2",
    "dimensions": 384,
    "dtype": "q8",
    "enabled": true,
    "device": "auto"
  },
  "primaryDirs": ["src/", "lib/", "packages/"],
  "archiveDirs": ["legacy/", "demo/", "examples/"]
}
```

If `embedding.enabled` is false, skip embedding entirely and use BM25-only (current behavior). This lets users on constrained machines opt out of the ~200MB model download.

### 6.6 — Tests

- Benchmark suite passes: all review queries return expected files
- Token savings metrics are honest and internally consistent
- Incremental embedding: change a file, verify embedding updates in < 2 seconds
- Config: set enabled=false, verify BM25-only fallback works

---

## New Dependencies Summary

| Package | Purpose | Size | License |
|---------|---------|------|---------|
| `@huggingface/transformers` | Local embedding model runtime (ONNX) | ~200MB (model: ~23MB) | Apache-2.0 |
| `sqlite-vec` | Vector similarity search in SQLite | ~150KB native extension | MIT |
| `code-chunk` | AST-aware code chunking | ~50KB + tree-sitter WASM | MIT |

Total new dependency footprint: ~200MB (mostly the ONNX runtime). The embedding model downloads once and caches locally.

All three are well-maintained, MIT/Apache licensed, and compatible with ContextWeave's existing stack (Node 22, better-sqlite3, tree-sitter, TypeScript ESM).

---

## New Files Summary

| File | Phase | Purpose |
|------|-------|---------|
| `src/core/chunker.ts` | 1 | AST-aware code chunking with contextualization |
| `src/core/embedder.ts` | 2 | Local embedding model wrapper |
| `src/core/vector-store.ts` | 2 | sqlite-vec vector storage and search |
| `src/core/hybrid-ranker.ts` | 3 | Three-signal RRF fusion (BM25 + vector + exact) |
| `src/core/pattern-detector.ts` | 5 | Structural pattern detection across files |
| `bench/retrieval-quality.ts` | 6 | Benchmark suite from real review queries |

## Modified Files Summary

| File | Phase | Change |
|------|-------|--------|
| `src/capsule/pivot-scorer.ts` | 0 | Symbol-name exact boost |
| `src/capsule/generator.ts` | 0, 3, 4 | Kill fallback, use hybrid search, graph expansion |
| `src/capsule/confidence.ts` | 0 | Hard caps on confidence based on utilization |
| `src/capsule/packer.ts` | 0 | Fill budget aggressively |
| `src/capsule/formatter.ts` | 0, 4 | Separate docs, file-qualified follow-ups, structured output |
| `src/capsule/content-fallback.ts` | 0 | Add exact-match bypass |
| `src/capsule/intent-classifier.ts` | 4 | Rewrite with semantic signals |
| `src/capsule/semantic-reranker.ts` | 3 | Replace with hybrid ranker (may deprecate) |
| `src/capsule/query-decomposer.ts` | 5 | IDF-style term suppression |
| `src/hooks/post-tool-use.ts` | 0 | Session-scoped feedback |
| `src/memory/bootstrap.ts` | 0 | Lower confidence, tag scope |
| `src/memory/observations.ts` | 5 | Observation promotion logic |
| `src/utils/directory-weights.ts` | 0 | Auto-downweight static/legacy dirs |
| `src/core/parser.ts` | 0 | TSX tolerance |
| `src/core/indexer.ts` | 1, 2, 5, 6 | Chunking, embedding, callbacks, relative paths |
| `src/core/file-summaries.ts` | 5 | Body-aware features |
| `src/core/watcher.ts` | 6 | Incremental embedding updates |
| `src/core/clusters.ts` | 5 | Use call + type edges, not just imports |
| `src/mcp/tools/capsule.ts` | 3, 4 | Pass embedder, structured output |
| `src/mcp/tools/overview.ts` | 3 | Use hybrid search |
| `src/mcp/tools/search.ts` | 0 | Regex normalization |
| `src/mcp/tools/path-filters.ts` | 0 | Brace expansion support |
| `src/mcp/tools/flow.ts` | 5 | Include callback/server-action edges |
| `src/mcp/tools/stats.ts` | 6 | Honest metrics |
| `src/mcp/server.ts` | 0 | Startup self-healing |
| `src/utils/config.ts` | 6 | Embedding model configuration |
| `src/db/schema.ts` | 1 | chunks table |
| `src/db/migrations.ts` | 1, 5 | New tables (chunks, patterns, term_frequency) |
| `package.json` | 1, 2 | New dependencies |

---

## Acceptance Criteria: "Is It Augment-Level?"

After all phases, ContextWeave should pass these tests:

### Narrow Queries (Symbol Lookup)
- [ ] Query "useDataLayer" returns useDataLayer definition as #1 result
- [ ] Query "searchSessions" returns searchSessions function, not neighbor functions
- [ ] Query "SecurityConfig" returns SecurityConfig.java, not static JS
- [ ] Budget utilization > 60% on narrow queries
- [ ] Confidence is LOW/MEDIUM when retrieval is thin, HIGH only when complete

### Broad Queries (Architecture)
- [ ] "How does auth connect to the dashboard" returns auth, middleware, dashboard files — not docs
- [ ] "End-to-end shopping flow" returns controllers, services, models — not static assets
- [ ] "Session data flow from JSONL to UI" returns reader → route → hook → page chain
- [ ] Budget utilization > 60% on broad queries
- [ ] Missing middle layers (API routes) are included via graph expansion

### Replacing Grep + Explorer
- [ ] Single cw_capsule call produces result that doesn't need follow-up grep
- [ ] Token cost of capsule < token cost of equivalent grep + 3 reads
- [ ] On the review benchmark queries, first-pass hit rate > 80%
- [ ] Average follow-up reads after capsule < 1.0

### Confidence and Trust
- [ ] Confidence correlates with actual retrieval quality (not inflated)
- [ ] When retrieval is incomplete, confidence says so
- [ ] Structured JSON output is parseable and actionable by agents

### Performance
- [ ] Initial indexing + embedding of 500-file project < 60 seconds
- [ ] Hybrid search latency < 500ms
- [ ] Incremental file change: re-index + re-embed < 2 seconds
- [ ] Memory usage < 500MB during normal operation

---

## What This Achieves vs Augment

| Metric | Augment | ContextWeave v2 (Target) |
|--------|---------|--------------------------|
| Semantic search | Cloud embeddings | Local `all-MiniLM-L6-v2` |
| Search quality | Excellent | Good-to-excellent (hybrid RRF) |
| Latency | < 200ms (cloud) | < 500ms (local) |
| Token savings | ~70% (real) | ~60-70% (real, honestly measured) |
| Cost | $30-50/month | Free |
| Privacy | Code sent to cloud | 100% local, no data leaves machine |
| Cross-repo | Yes | Not yet (future phase) |
| Scale | 100M+ LOC | 1-5M LOC comfortably |
| Pattern detection | Built-in | Built-in (AST structural) |
| MCP support | Yes | Yes (native) |
| Open source | No | Yes (MIT) |

**Where ContextWeave v2 wins:** Free, local-first, open-source, no data leaves your machine, deeper AST integration (tree-sitter vs Augment's cloud-only chunking), customizable (swap embedding models, adjust weights).

**Where Augment still wins:** Cross-repo context, 100M+ LOC scale with quantized ANN, proprietary fine-tuned embedding models, team collaboration features.

**For the use case of "give my coding agent better context so it stops grepping endlessly"** — ContextWeave v2 matches Augment's core value proposition at zero cost.
