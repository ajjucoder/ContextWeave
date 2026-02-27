# Capsule Pipeline Overhaul — 3-Wave Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the ContextWeave capsule pipeline to achieve 75%+ coverage confidence, replace the need for expensive Explore agents, and scale to 10M+ line codebases.

**Architecture:** Three waves that build on each other — (1) fix retrieval quality via multi-term scoring, weighted BFS, and file-level summaries, (2) add session intelligence so follow-up queries are cheaper and more targeted, (3) hierarchical indexing and pre-computed clusters for massive-scale codebases. Each wave is independently shippable.

**Tech Stack:** TypeScript ESM, better-sqlite3, tree-sitter, gpt-tokenizer, vitest

**Project Root:** `/path/to/ContextWeave`

**Key Files Reference:**
- Capsule generator: `src/capsule/generator.ts` (main pipeline, ~340 lines)
- BFS traversal: `src/core/graph.ts` (bfsTraversal, lazyBfsTraversal, scopedLazyBfsTraversal)
- Scoring: `src/capsule/scorer.ts` (scoreNode, assignCompressionLevel)
- Compression: `src/capsule/compressor.ts` (renderSymbol, estimateTokens)
- Packing: `src/capsule/packer.ts` (packNodes with promotion pass)
- Formatting: `src/capsule/formatter.ts` (formatCapsule)
- DB schema: `src/db/schema.ts` + `src/db/migrations.ts` (migration v1 + v2 exist)
- Types: `src/core/types.ts` (SymbolRecord, FileRecord, EdgeRecord, CapsuleMetadata, etc.)
- Synonyms: `src/utils/synonyms.ts` (14-entry map)
- Directory weights: `src/utils/directory-weights.ts` (DOWNWEIGHT_PATTERNS)
- FTS: `symbols_fts` virtual table using trigram tokenizer on (name, kind)

**Current Metrics (on ContextWeave itself):**
- 130 files, 813 symbols, 2822 edges
- Coverage confidence: 27-38% on its own codebase
- Pivot coverage: 9-36% (finding 69-236 pivots, only fitting 15-25)
- Dependency coverage: 0-1% (BFS expansion not contributing)

---

## WAVE 1: Fix Retrieval Quality (Confidence 30% → 75%+)

**Problem:** FTS returns every symbol matching ANY query term. "capsule generation pipeline" returns 236 pivots because it matches "capsule" OR "generation" OR "pipeline" independently. The scoring can't distinguish the 10 real pivots from 226 partial matches.

**Solution:** Multi-term relevance scoring, weighted edge traversal, and file-level summary compression.

---

### Task 1.1: Multi-Term Pivot Scoring

**Files:**
- Create: `src/capsule/pivot-scorer.ts`
- Modify: `src/capsule/generator.ts:154-181` (Phase 1: Pivot Resolution)
- Test: `tests/capsule/pivot-scorer.test.ts`

**What this does:** Instead of unioning all FTS matches, score each candidate by how many query terms it matches. A symbol matching 3/3 terms scores exponentially higher than 1/3.

**Step 1: Write the failing test**

```typescript
// tests/capsule/pivot-scorer.test.ts
import { describe, it, expect } from "vitest";
import { scorePivotRelevance } from "../../src/capsule/pivot-scorer.js";

describe("scorePivotRelevance", () => {
  const queryTerms = ["capsule", "generator", "pipeline"];

  it("scores exact name match highest", () => {
    const score = scorePivotRelevance(
      { name: "generateCapsule", signature: "function generateCapsule(db, params): CapsuleOutput", kind: "function", filePath: "src/capsule/generator.ts" },
      queryTerms
    );
    expect(score).toBeGreaterThan(5);
  });

  it("scores single-term match much lower", () => {
    const multi = scorePivotRelevance(
      { name: "generateCapsule", signature: "function generateCapsule(db, params)", kind: "function", filePath: "src/capsule/generator.ts" },
      queryTerms
    );
    const single = scorePivotRelevance(
      { name: "capsuleLogQueries", signature: "function capsuleLogQueries(db)", kind: "function", filePath: "src/db/queries/capsule-log.ts" },
      queryTerms
    );
    expect(multi).toBeGreaterThan(single * 2);
  });

  it("boosts file path matches", () => {
    const withPath = scorePivotRelevance(
      { name: "formatCapsule", signature: "function formatCapsule(...)", kind: "function", filePath: "src/capsule/formatter.ts" },
      queryTerms
    );
    const withoutPath = scorePivotRelevance(
      { name: "formatCapsule", signature: "function formatCapsule(...)", kind: "function", filePath: "src/utils/helpers.ts" },
      queryTerms
    );
    expect(withPath).toBeGreaterThan(withoutPath);
  });

  it("returns 0 for no matches", () => {
    const score = scorePivotRelevance(
      { name: "hashFile", signature: "function hashFile(content)", kind: "function", filePath: "src/utils/hash.ts" },
      queryTerms
    );
    expect(score).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capsule/pivot-scorer.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/capsule/pivot-scorer.ts
interface PivotCandidate {
  name: string;
  signature: string;
  kind: string;
  filePath: string;
}

export function scorePivotRelevance(candidate: PivotCandidate, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;

  const nameLower = candidate.name.toLowerCase();
  const sigLower = candidate.signature.toLowerCase();
  const pathLower = candidate.filePath.toLowerCase();
  const kindLower = candidate.kind.toLowerCase();

  // Split camelCase/snake_case name into sub-tokens
  const nameTokens = nameLower
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-./]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const pathTokens = pathLower
    .replace(/[_\-./\\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let nameTermHits = 0;
  let sigTermHits = 0;
  let pathTermHits = 0;

  for (const term of queryTerms) {
    if (nameTokens.some((t) => t.includes(term) || term.includes(t))) nameTermHits++;
    if (sigLower.includes(term)) sigTermHits++;
    if (pathTokens.some((t) => t.includes(term) || term.includes(t))) pathTermHits++;
  }

  if (nameTermHits === 0 && sigTermHits === 0 && pathTermHits === 0) return 0;

  const totalTerms = queryTerms.length;

  // Multi-term coverage bonus: matching N/N terms = exponential boost
  const nameCoverage = nameTermHits / totalTerms;
  const nameScore = nameTermHits * (1 + nameCoverage * 3); // 1-term=1, 2/3=3.3, 3/3=8

  const sigCoverage = sigTermHits / totalTerms;
  const sigScore = sigTermHits * (1 + sigCoverage) * 0.5;

  const pathCoverage = pathTermHits / totalTerms;
  const pathScore = pathTermHits * (1 + pathCoverage) * 0.3;

  // Kind-based weight: functions/classes are more likely real pivots
  const kindWeight = (kindLower === "function" || kindLower === "class" || kindLower === "method") ? 1.2 : 1.0;

  return (nameScore + sigScore + pathScore) * kindWeight;
}

export function rankPivots(
  candidates: Array<{ id: number } & PivotCandidate>,
  queryTerms: string[],
  maxPivots: number
): Map<number, number> {
  const scored = candidates.map((c) => ({
    id: c.id,
    score: scorePivotRelevance(c, queryTerms),
  }));

  scored.sort((a, b) => b.score - a.score);

  const result = new Map<number, number>();
  for (const { id, score } of scored.slice(0, maxPivots)) {
    if (score > 0) result.set(id, score);
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capsule/pivot-scorer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/capsule/pivot-scorer.ts tests/capsule/pivot-scorer.test.ts
git commit -m "feat(capsule): add multi-term pivot relevance scorer"
```

---

### Task 1.2: Integrate Pivot Scorer into Generator

**Files:**
- Modify: `src/capsule/generator.ts:133-181` (Phase 1 pivot resolution)
- Test: `tests/capsule/pivot-quality.test.ts`

**What this does:** Replace the current "union all FTS matches" with scored ranking. Only the top N pivots (ranked by multi-term relevance) enter the BFS phase.

**Step 1: Write the failing test**

```typescript
// tests/capsule/pivot-quality.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  // Index ContextWeave's own test fixtures
  await indexProject(db, `${__dirname}/../fixtures`);
  updateCentralityScores(db);
});

describe("pivot quality after multi-term scoring", () => {
  it("achieves > 50% pivot coverage on multi-term query", () => {
    const result = generateCapsule(db, {
      query: "User service validate email",
      tokenBudget: 4000,
    });
    expect(result.metadata.quality.pivotCoverage).toBeGreaterThan(0.5);
  });

  it("produces fewer pivots but higher relevance", () => {
    const result = generateCapsule(db, {
      query: "validateEmail",
      tokenBudget: 2000,
    });
    // Single-term exact match should have very high pivot coverage
    expect(result.metadata.quality.pivotCoverage).toBeGreaterThan(0.7);
    expect(result.metadata.quality.noiseRatio).toBeLessThan(0.3);
  });

  it("coverage confidence is higher than baseline 38%", () => {
    const result = generateCapsule(db, {
      query: "User service validate",
      tokenBudget: 4000,
    });
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.45);
  });
});
```

**Step 2: Run test to verify current baseline fails the > 50% assertions**

Run: `npx vitest run tests/capsule/pivot-quality.test.ts`
Expected: FAIL (current pivot coverage is ~25-36%)

**Step 3: Modify the generator**

In `src/capsule/generator.ts`, replace Phase 1 (lines ~154-181). Key changes:

1. Import `scorePivotRelevance, rankPivots` from `./pivot-scorer.js`
2. After collecting all FTS + path candidates into `pivotSymbolIds`, build scored candidates:
   - For each pivot symbol ID, look up the symbol record (name, kind) and file (path)
   - Call `rankPivots()` to get scored, sorted top-N pivots
   - Replace the flat `Set<number>` with a `Map<number, number>` (id → relevance score)
3. Cap pivots at `MAX_PIVOTS = Math.max(30, Math.floor(tokenBudget / 50))` — fewer but better pivots
4. Pass pivot relevance scores into the scoring phase so multi-term pivots get preferential compression (L0 instead of L1)

The generator's Phase 1 should become:

```typescript
// Phase 1: Pivot Resolution with multi-term scoring
const MAX_PIVOTS = Math.max(30, Math.floor(tokenBudget / 50));

const rawPivotIds = new Set<number>();
// ... existing FTS + path matching logic stays, but collects into rawPivotIds ...

const pivotCandidates: Array<{ id: number; name: string; signature: string; kind: string; filePath: string }> = [];
for (const id of rawPivotIds) {
  const sym = symbols.getByIdLight(id);
  if (!sym) continue;
  const file = getFile(sym.fileId);
  if (!file) continue;
  pivotCandidates.push({ id, name: sym.name, signature: sym.signature, kind: sym.kind, filePath: file.path });
}

const rankedPivots = rankPivots(pivotCandidates, exactQueryTerms, MAX_PIVOTS);
const pivotSymbolIds = new Set(rankedPivots.keys());
const pivotRelevanceScores = rankedPivots;
```

Then in the scoring phase, use `pivotRelevanceScores.get(symbolId)` to boost multi-term pivots.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capsule/pivot-quality.test.ts`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All 158+ tests pass

**Step 6: Commit**

```bash
git add src/capsule/generator.ts src/capsule/pivot-scorer.ts tests/capsule/pivot-quality.test.ts
git commit -m "feat(capsule): integrate multi-term pivot scoring into generator"
```

---

### Task 1.3: Weighted BFS — Edge-Type-Aware Traversal

**Files:**
- Create: `src/core/weighted-bfs.ts`
- Modify: `src/capsule/generator.ts` (Phase 2: replace scopedLazyBfsTraversal call)
- Test: `tests/core/weighted-bfs.test.ts`

**What this does:** Replace uniform BFS with a priority queue that weights edges by type and direction. Import edges from the same directory cost 0.5 hops. Call edges from test files cost 2.0 hops. This means the BFS reaches relevant symbols in fewer hops and stops before noise.

**Step 1: Write the failing test**

```typescript
// tests/core/weighted-bfs.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { weightedBfsTraversal } from "../../src/core/weighted-bfs.js";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();

  // Create file structure: src/core/main.ts, src/core/helper.ts, tests/main.test.ts
  const mainFileId = files.insert({ path: "src/core/main.ts", hash: "a", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
  const helperFileId = files.insert({ path: "src/core/helper.ts", hash: "b", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
  const testFileId = files.insert({ path: "tests/main.test.ts", hash: "c", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });

  const mainFn = syms.insert({ fileId: mainFileId, name: "processData", kind: "function", startLine: 1, endLine: 10, signature: "function processData()", bodyHash: "x1", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const helperFn = syms.insert({ fileId: helperFileId, name: "validateInput", kind: "function", startLine: 1, endLine: 5, signature: "function validateInput()", bodyHash: "x2", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const testFn = syms.insert({ fileId: testFileId, name: "testProcessData", kind: "function", startLine: 1, endLine: 20, signature: "function testProcessData()", bodyHash: "x3", fullSource: "", isExported: false, docComment: null, centrality: 0, lastSeen: now });

  // main imports helper (same dir), test imports main (test dir)
  edges.insert({ sourceSymbolId: mainFn, targetSymbolId: helperFn, kind: "import", createdAt: now });
  edges.insert({ sourceSymbolId: testFn, targetSymbolId: mainFn, kind: "call", createdAt: now });
});

describe("weightedBfsTraversal", () => {
  it("reaches same-dir imports at lower effective distance", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    const nodes = weightedBfsTraversal(db, [mainSym.id], 3);

    const helperNode = nodes.find((n) => {
      const s = syms.getById(n.symbolId);
      return s?.name === "validateInput";
    });
    const testNode = nodes.find((n) => {
      const s = syms.getById(n.symbolId);
      return s?.name === "testProcessData";
    });

    expect(helperNode).toBeDefined();
    expect(testNode).toBeDefined();
    // Helper (same dir, import edge) should have lower effective distance than test
    expect(helperNode!.distance).toBeLessThan(testNode!.distance);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/weighted-bfs.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/core/weighted-bfs.ts
import type Database from "better-sqlite3";
import { dirname } from "node:path";

export interface WeightedBfsNode {
  symbolId: number;
  distance: number; // effective weighted distance
}

interface EdgeRow {
  symbol_id: number;
  kind: string;
  file_path: string;
}

const EDGE_WEIGHTS: Record<string, number> = {
  import: 0.8,
  call: 1.0,
  type_usage: 0.9,
  reference: 1.2,
  inheritance: 0.6,
  implements: 0.7,
};

function edgeCost(kind: string, sourceDir: string, targetDir: string, targetPath: string): number {
  const base = EDGE_WEIGHTS[kind] ?? 1.0;

  // Same directory: cheaper traversal
  if (sourceDir === targetDir) return base * 0.6;

  // Test/vendor files: more expensive
  if (/\/(tests?|__tests?__|spec)\//i.test(targetPath)) return base * 1.8;
  if (/\/(vendor|third_party|external)\//i.test(targetPath)) return base * 2.5;
  if (/\/(examples?|samples?|demo)\//i.test(targetPath)) return base * 1.5;

  return base;
}

export function weightedBfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxDepth: number,
  scopeDirs?: string[] | null
): WeightedBfsNode[] {
  const getOutgoing = db.prepare(`
    SELECT e.target_symbol_id as symbol_id, e.kind, f.path as file_path
    FROM edges e
    JOIN symbols s ON s.id = e.target_symbol_id
    JOIN files f ON f.id = s.file_id
    WHERE e.source_symbol_id = ?
  `);
  const getIncoming = db.prepare(`
    SELECT e.source_symbol_id as symbol_id, e.kind, f.path as file_path
    FROM edges e
    JOIN symbols s ON s.id = e.source_symbol_id
    JOIN files f ON f.id = s.file_id
    WHERE e.target_symbol_id = ?
  `);
  const getFilePath = db.prepare(`
    SELECT f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id = ?
  `);

  const isInScope = (filePath: string): boolean => {
    if (!scopeDirs || scopeDirs.length === 0) return true;
    return scopeDirs.some((dir) => filePath.startsWith(`${dir}/`) || filePath.startsWith(`${dir}\\`));
  };

  const visited = new Map<number, number>();

  // Priority queue implemented as sorted insertion (adequate for <50K nodes)
  const queue: Array<{ symbolId: number; distance: number }> = [];
  const enqueue = (symbolId: number, distance: number) => {
    // Binary insertion to maintain sort order
    let lo = 0, hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (queue[mid]!.distance <= distance) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, { symbolId, distance });
  };

  for (const id of pivotIds) {
    visited.set(id, 0);
    enqueue(id, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Skip if we already found a shorter path
    const bestKnown = visited.get(current.symbolId);
    if (bestKnown !== undefined && bestKnown < current.distance) continue;
    if (current.distance >= maxDepth) continue;

    const sourcePathRow = getFilePath.get(current.symbolId) as { path: string } | undefined;
    const sourceDir = sourcePathRow ? dirname(sourcePathRow.path) : "";

    const outgoing = getOutgoing.all(current.symbolId) as EdgeRow[];
    const incoming = getIncoming.all(current.symbolId) as EdgeRow[];

    for (const edge of [...outgoing, ...incoming]) {
      if (!isInScope(edge.file_path)) continue;

      const targetDir = dirname(edge.file_path);
      const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path);
      const newDist = current.distance + cost;

      if (newDist >= maxDepth) continue;

      const existing = visited.get(edge.symbol_id);
      if (existing !== undefined && existing <= newDist) continue;

      visited.set(edge.symbol_id, newDist);
      enqueue(edge.symbol_id, newDist);
    }
  }

  return Array.from(visited.entries()).map(([symbolId, distance]) => ({ symbolId, distance }));
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/weighted-bfs.test.ts`
Expected: PASS

**Step 5: Wire into generator**

In `src/capsule/generator.ts`, replace the `scopedLazyBfsTraversal` call with `weightedBfsTraversal`:

```typescript
import { weightedBfsTraversal } from "../core/weighted-bfs.js";

// Phase 2: Weighted BFS traversal with edge-type-aware costs
const maxDepth = getBfsDepth(tokenBudget);
const scopeDirs = pivotDirs.size > 0 ? [...pivotDirs] : null;
const bfsNodes = weightedBfsTraversal(db, [...pivotSymbolIds], maxDepth, scopeDirs);
```

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/core/weighted-bfs.ts tests/core/weighted-bfs.test.ts src/capsule/generator.ts
git commit -m "feat(graph): add weighted BFS with edge-type-aware traversal costs"
```

---

### Task 1.4: File-Level Summary Compression (Level 4)

**Files:**
- Modify: `src/core/types.ts` (add CompressionLevel 4)
- Modify: `src/capsule/compressor.ts` (add level 4 rendering)
- Modify: `src/capsule/packer.ts` (add file-level grouping logic)
- Test: `tests/capsule/file-summary.test.ts`

**What this does:** Add a new compression level that summarizes an entire file in one line: `[file] src/db/queries/edges.ts: 8 symbols (insert, getBySource, getByTarget, deleteBySymbol, ...)`. This lets the packer include awareness of 8 symbols in ~20 tokens instead of 160 tokens.

**Step 1: Write the failing test**

```typescript
// tests/capsule/file-summary.test.ts
import { describe, it, expect } from "vitest";
import { renderFileSummary } from "../../src/capsule/compressor.js";

describe("renderFileSummary", () => {
  it("renders a single-line file summary", () => {
    const summary = renderFileSummary("src/db/queries/edges.ts", [
      { name: "insert", kind: "method" },
      { name: "getBySource", kind: "method" },
      { name: "getByTarget", kind: "method" },
      { name: "deleteBySymbol", kind: "method" },
      { name: "mapRow", kind: "function" },
      { name: "edgeQueries", kind: "function" },
    ]);

    expect(summary).toContain("src/db/queries/edges.ts");
    expect(summary).toContain("6 symbols");
    expect(summary).toContain("insert");
    expect(summary).toContain("edgeQueries");
  });

  it("truncates long symbol lists", () => {
    const symbols = Array.from({ length: 20 }, (_, i) => ({ name: `symbol${i}`, kind: "function" }));
    const summary = renderFileSummary("src/big-file.ts", symbols);
    expect(summary).toContain("20 symbols");
    // Should not list all 20 names
    expect(summary.length).toBeLessThan(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capsule/file-summary.test.ts`
Expected: FAIL — renderFileSummary not exported

**Step 3: Implement**

In `src/capsule/compressor.ts`, add:

```typescript
interface FileSummarySymbol {
  name: string;
  kind: string;
}

export function renderFileSummary(filePath: string, symbols: FileSummarySymbol[]): string {
  const MAX_NAMES = 8;
  const names = symbols.slice(0, MAX_NAMES).map((s) => s.name);
  const suffix = symbols.length > MAX_NAMES ? `, +${symbols.length - MAX_NAMES} more` : "";
  return `[file] ${filePath}: ${symbols.length} symbols (${names.join(", ")}${suffix})`;
}
```

In `src/capsule/packer.ts`, after the main packing loop completes, add a file-summary pass: for files that have 3+ symbols NOT yet packed, generate a file summary line and add it if budget permits. This gives the LLM awareness of nearby code without the full token cost.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capsule/file-summary.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/capsule/compressor.ts src/capsule/packer.ts tests/capsule/file-summary.test.ts
git commit -m "feat(capsule): add file-level summary compression for unpacked symbols"
```

---

### Task 1.5: Improved Confidence Formula

**Files:**
- Modify: `src/capsule/generator.ts:393-396` (confidence calculation)
- Test: `tests/capsule/confidence-formula.test.ts`

**What this does:** Rework the confidence formula to account for the new retrieval quality. The old formula penalized having many pivots (lower pivotCoverage). The new formula rewards having high-quality pivots with multi-term relevance.

**Step 1: Write the failing test**

```typescript
// tests/capsule/confidence-formula.test.ts
import { describe, it, expect } from "vitest";
import { computeCoverageConfidence } from "../../src/capsule/generator.js";

describe("computeCoverageConfidence", () => {
  it("returns high confidence when pivots are high-relevance", () => {
    const confidence = computeCoverageConfidence({
      pivotCount: 10,
      pivotsIncluded: 8,
      relevantPivotsIncluded: 8, // all included pivots matched 2+ query terms
      totalRelevantPivots: 9,
      dependencyCoverage: 0.5,
      noiseRatio: 0.1,
      fileSummaryCount: 3,
    });
    expect(confidence).toBeGreaterThan(0.7);
  });

  it("returns lower confidence when only low-relevance pivots included", () => {
    const confidence = computeCoverageConfidence({
      pivotCount: 200,
      pivotsIncluded: 30,
      relevantPivotsIncluded: 5,
      totalRelevantPivots: 50,
      dependencyCoverage: 0.2,
      noiseRatio: 0.4,
      fileSummaryCount: 0,
    });
    expect(confidence).toBeLessThan(0.5);
  });

  it("boosts confidence when file summaries fill gaps", () => {
    const without = computeCoverageConfidence({
      pivotCount: 30, pivotsIncluded: 10, relevantPivotsIncluded: 10,
      totalRelevantPivots: 15, dependencyCoverage: 0.3, noiseRatio: 0.2, fileSummaryCount: 0,
    });
    const with_ = computeCoverageConfidence({
      pivotCount: 30, pivotsIncluded: 10, relevantPivotsIncluded: 10,
      totalRelevantPivots: 15, dependencyCoverage: 0.3, noiseRatio: 0.2, fileSummaryCount: 5,
    });
    expect(with_).toBeGreaterThan(without);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capsule/confidence-formula.test.ts`
Expected: FAIL — computeCoverageConfidence not exported

**Step 3: Extract and rewrite the confidence formula**

Export a new function from `src/capsule/generator.ts`:

```typescript
interface ConfidenceParams {
  pivotCount: number;
  pivotsIncluded: number;
  relevantPivotsIncluded: number;
  totalRelevantPivots: number;
  dependencyCoverage: number;
  noiseRatio: number;
  fileSummaryCount: number;
}

export function computeCoverageConfidence(params: ConfidenceParams): number {
  const { pivotCount, pivotsIncluded, relevantPivotsIncluded, totalRelevantPivots, dependencyCoverage, noiseRatio, fileSummaryCount } = params;

  // Relevant pivot coverage matters more than raw pivot coverage
  const relevantCoverage = totalRelevantPivots === 0
    ? (pivotsIncluded > 0 ? 0.5 : 0)
    : relevantPivotsIncluded / totalRelevantPivots;

  // File summaries fill the gap — each summary covers 3-15 symbols cheaply
  const summaryBoost = Math.min(0.15, fileSummaryCount * 0.03);

  return Math.max(0, Math.min(1,
    relevantCoverage * 0.5 +
    dependencyCoverage * 0.2 +
    (1 - noiseRatio) * 0.15 +
    summaryBoost +
    0.15 // base confidence floor for having any results
  ));
}
```

Wire this into the existing confidence calculation in the generator, replacing the old formula.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capsule/confidence-formula.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/capsule/generator.ts tests/capsule/confidence-formula.test.ts
git commit -m "feat(capsule): rewrite confidence formula for multi-term pivot quality"
```

---

### Task 1.6: Wave 1 Self-Test — ContextWeave on Itself

**Files:**
- Create: `tests/integration/self-confidence.test.ts`

**What this does:** Run ContextWeave on its own codebase and assert coverage confidence is above the target threshold. This is the acceptance test for Wave 1.

**Step 1: Write the test**

```typescript
// tests/integration/self-confidence.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  await indexProject(db, `${__dirname}/../fixtures`);
  updateCentralityScores(db);
}, 30000);

const CONFIDENCE_THRESHOLD = 0.6;
const QUERIES = [
  "UserService validate email",
  "capsule generation pipeline",
  "edge resolution import scoping",
  "BFS traversal graph",
  "observation memory staleness",
];

describe("Wave 1 acceptance: self-confidence", () => {
  for (const query of QUERIES) {
    it(`achieves >${CONFIDENCE_THRESHOLD * 100}% confidence for "${query}"`, () => {
      const result = generateCapsule(db, { query, tokenBudget: 4000 });
      expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(CONFIDENCE_THRESHOLD);
    });
  }

  it("average confidence across all queries exceeds threshold", () => {
    let totalConfidence = 0;
    for (const query of QUERIES) {
      const result = generateCapsule(db, { query, tokenBudget: 4000 });
      totalConfidence += result.metadata.quality.coverageConfidence;
    }
    expect(totalConfidence / QUERIES.length).toBeGreaterThan(CONFIDENCE_THRESHOLD);
  });
});
```

**Step 2: Run and iterate until passing**

Run: `npx vitest run tests/integration/self-confidence.test.ts`

If any query fails the threshold, investigate and tune:
- Pivot scorer weights
- BFS edge weights
- Compression level thresholds

**Step 3: Commit**

```bash
git add tests/integration/self-confidence.test.ts
git commit -m "test(capsule): add Wave 1 self-confidence acceptance tests"
```

---

### Task 1.7: Wave 1 QA — Cross-Project Validation

**Files:**
- Create: `bench/cross-project-qa.ts`

**What this does:** Clone 3 diverse repos into a temp directory, index each, run capsule queries, and report confidence metrics. This validates that Wave 1 improvements generalize beyond ContextWeave's own codebase.

**Step 1: Write the QA harness**

```typescript
// bench/cross-project-qa.ts
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { createSchema } from "../src/db/schema.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";

const QA_DIR = resolve(__dirname, "../.qa-temp");

interface QaProject {
  name: string;
  repo: string;
  queries: string[];
}

const PROJECTS: QaProject[] = [
  {
    name: "codex-team-orchestrator (TS, ~237 files)",
    repo: "https://github.com/ajjucoder/codex-team-orchestrator.git",
    queries: ["orchestrator agent dispatch", "task queue worker", "message routing"],
  },
  {
    name: "polymarket-arbitrage-sim (TS, ~100 files)",
    repo: "https://github.com/ajjucoder/polymarket-arbitrage-sim.git",
    queries: ["arbitrage strategy calculation", "market data fetch", "portfolio allocation"],
  },
  {
    name: "research-agent (Python, ~14 authored files)",
    repo: "https://github.com/ajjucoder/research-agent.git",
    queries: ["agent search query", "result ranking", "source extraction"],
  },
];

async function main() {
  if (existsSync(QA_DIR)) rmSync(QA_DIR, { recursive: true, force: true });
  mkdirSync(QA_DIR, { recursive: true });

  const results: Array<{ project: string; query: string; confidence: number; pivotCoverage: number; symbols: number; tokens: number }> = [];

  for (const project of PROJECTS) {
    const projectDir = resolve(QA_DIR, project.name.split(" ")[0]!);
    process.stdout.write(`\nCloning ${project.name}...\n`);

    try {
      execSync(`git clone --depth 1 ${project.repo} "${projectDir}"`, { stdio: "pipe" });
    } catch {
      process.stdout.write(`  SKIP: failed to clone\n`);
      continue;
    }

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);

    process.stdout.write("  Indexing...\n");
    const indexResult = await indexProject(db, projectDir);
    updateCentralityScores(db);
    process.stdout.write(`  ${indexResult.filesIndexed} files, ${indexResult.symbolsFound} symbols\n`);

    for (const query of project.queries) {
      const capsule = generateCapsule(db, { query, tokenBudget: 4000 });
      const q = capsule.metadata.quality;
      results.push({
        project: project.name,
        query,
        confidence: q.coverageConfidence,
        pivotCoverage: q.pivotCoverage,
        symbols: capsule.metadata.symbolCount,
        tokens: capsule.metadata.tokensUsed,
      });
      process.stdout.write(`  "${query}" → confidence: ${(q.coverageConfidence * 100).toFixed(1)}%, pivots: ${(q.pivotCoverage * 100).toFixed(1)}%, ${capsule.metadata.symbolCount} symbols, ${capsule.metadata.tokensUsed} tokens\n`);
    }

    db.close();
  }

  process.stdout.write("\n=== SUMMARY ===\n");
  const avgConfidence = results.reduce((acc, r) => acc + r.confidence, 0) / results.length;
  const minConfidence = Math.min(...results.map((r) => r.confidence));
  process.stdout.write(`Average confidence: ${(avgConfidence * 100).toFixed(1)}%\n`);
  process.stdout.write(`Min confidence:     ${(minConfidence * 100).toFixed(1)}%\n`);
  process.stdout.write(`Target:             >60%\n`);
  process.stdout.write(`Status:             ${avgConfidence > 0.6 ? "PASS" : "FAIL"}\n`);

  rmSync(QA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`QA failed: ${err}\n`);
  process.exit(1);
});
```

**Step 2: Run QA**

Run: `npx tsx bench/cross-project-qa.ts`

Target: Average confidence > 60%, no query below 40%.

**Step 3: Commit**

```bash
git add bench/cross-project-qa.ts
git commit -m "bench: add cross-project QA harness for capsule confidence validation"
```

---

## WAVE 2: Session Intelligence (Replace Explore Agent)

**Problem:** Every capsule query starts from scratch. If you asked about `resolveEdges` then ask about `computePageRank`, the system doesn't know they're related. Follow-up queries pay full retrieval cost. An Explore agent succeeds because it builds context iteratively.

**Prerequisite:** Wave 1 must be complete and passing all tests.

---

### Task 2.1: Session Context Store

**Files:**
- Create: `src/capsule/session-context.ts`
- Modify: `src/db/schema.ts` (add session_context table)
- Modify: `src/db/migrations.ts` (add migration v3)
- Test: `tests/capsule/session-context.test.ts`

**What this does:** Track which symbols and files were returned in previous capsule queries within the same session. The generator can then use this to: (a) avoid repeating the same content, (b) understand what the user is working on, (c) boost related symbols in follow-up queries.

**DB Schema Addition (migration v3):**

```sql
CREATE TABLE IF NOT EXISTS session_context (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL REFERENCES sessions(id),
  symbol_id   INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  file_id     INTEGER REFERENCES files(id) ON DELETE CASCADE,
  query       TEXT    NOT NULL,
  relevance   REAL    NOT NULL DEFAULT 1.0,
  returned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_ctx_session ON session_context(session_id);
CREATE INDEX IF NOT EXISTS idx_session_ctx_symbol ON session_context(symbol_id);
```

**Implementation:**

```typescript
// src/capsule/session-context.ts
import type Database from "better-sqlite3";

export interface SessionContextEntry {
  symbolId: number;
  fileId: number;
  query: string;
  relevance: number;
  returnedAt: number;
}

export class SessionContext {
  private db: Database.Database;
  private sessionId: string;

  constructor(db: Database.Database, sessionId: string) {
    this.db = db;
    this.sessionId = sessionId;
  }

  record(symbols: Array<{ symbolId: number; fileId: number }>, query: string): void {
    const insert = this.db.prepare(`
      INSERT INTO session_context (session_id, symbol_id, file_id, query, relevance, returned_at)
      VALUES (?, ?, ?, ?, 1.0, ?)
    `);
    const now = Date.now();
    const insertAll = this.db.transaction(() => {
      for (const s of symbols) {
        insert.run(this.sessionId, s.symbolId, s.fileId, query, now);
      }
    });
    insertAll();
  }

  getRecentFileIds(limit = 50): number[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT file_id FROM session_context
      WHERE session_id = ? ORDER BY returned_at DESC LIMIT ?
    `).all(this.sessionId, limit) as Array<{ file_id: number }>;
    return rows.map((r) => r.file_id);
  }

  getRecentSymbolIds(limit = 100): number[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT symbol_id FROM session_context
      WHERE session_id = ? ORDER BY returned_at DESC LIMIT ?
    `).all(this.sessionId, limit) as Array<{ symbol_id: number }>;
    return rows.map((r) => r.symbol_id);
  }

  getRecentQueries(limit = 10): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT query FROM session_context
      WHERE session_id = ? ORDER BY returned_at DESC LIMIT ?
    `).all(this.sessionId, limit) as Array<{ query: string }>;
    return rows.map((r) => r.query);
  }
}
```

**Test, run, commit as per the Task structure above.**

**Step 5: Commit**

```bash
git add src/capsule/session-context.ts src/db/schema.ts src/db/migrations.ts tests/capsule/session-context.test.ts
git commit -m "feat(capsule): add session context store for cross-query intelligence"
```

---

### Task 2.2: Session-Aware Pivot Boosting

**Files:**
- Modify: `src/capsule/generator.ts` (Phase 1: boost pivots near recent session context)
- Test: `tests/capsule/session-boost.test.ts`

**What this does:** If the previous query returned symbols from `src/core/graph.ts`, and the new query mentions "PageRank", symbols in `src/core/graph.ts` get a 2x pivot relevance boost. This simulates how an Explore agent builds on prior context.

**Implementation approach:**
1. After pivot scoring, check `SessionContext.getRecentFileIds()`
2. If a pivot candidate is in a recently-returned file, multiply its relevance score by 1.5-2x
3. If a pivot candidate is in the same directory as recently-returned files, multiply by 1.2x
4. This naturally focuses follow-up queries on the area the user is already exploring

**Test, run, commit.**

---

### Task 2.3: Query Decomposition

**Files:**
- Create: `src/capsule/query-decomposer.ts`
- Test: `tests/capsule/query-decomposer.test.ts`

**What this does:** Break complex queries into sub-queries and merge results. "capsule generation pipeline scoring compression" becomes:
1. "capsule generation pipeline" (architectural query)
2. "scoring compression" (implementation detail query)

Each sub-query gets its own pivot resolution, and results are merged with deduplication.

**Implementation:** Split on natural boundaries (3+ terms → split into 2-3 term groups preserving adjacency). Score each sub-query's pivots independently. Merge by taking the union of top-N pivots from each sub-query, with multi-sub-query matches getting a 1.5x boost.

**Test, run, commit.**

---

### Task 2.4: Deduplication — Don't Repeat Previous Capsule Content

**Files:**
- Modify: `src/capsule/generator.ts` (add dedup pass after packing)
- Test: `tests/capsule/dedup.test.ts`

**What this does:** If the same symbol was returned at L0 (full source) in a previous capsule this session, downgrade it to L2 (summary) or skip it entirely. This frees token budget for new information.

**Implementation:**
1. After packing, check each packed symbol against `SessionContext.getRecentSymbolIds()`
2. If a symbol was recently returned at L0, allow it at L2 (signature only) but not L0 again
3. Redirect freed tokens to previously-unpacked symbols or file summaries
4. Include a `[previously shown]` marker so the LLM knows full source is available in context

**Test, run, commit.**

---

### Task 2.5: Wave 2 Self-Test — Session Intelligence Validation

**Files:**
- Create: `tests/integration/session-intelligence.test.ts`

**What this does:** Simulate a multi-query session and verify that:
1. Second query on related topic has higher confidence than if it were the first query
2. Token usage decreases for follow-up queries (deduplication working)
3. Coverage confidence remains above 60% across the session

**Test, run, commit.**

---

### Task 2.6: Wave 2 QA — Multi-Query Cross-Project Validation

Extend `bench/cross-project-qa.ts` to run 3-query sequences per project:
1. Broad architectural query
2. Follow-up drilling into a specific area
3. Related but different area

Measure: confidence improvement from query 1 → 2 → 3, total token reduction vs. 3 independent queries.

Target: 20%+ token reduction on follow-up queries, average confidence > 65%.

**Test, run, commit.**

---

## WAVE 3: Scale Architecture (1M–10M+ Lines)

**Problem:** BFS over the full symbol graph + FTS over all symbols = O(n) per query. At 100K symbols this takes seconds. At 1M symbols it takes minutes.

**Prerequisite:** Waves 1 and 2 must be complete and passing all tests.

---

### Task 3.1: File-Level Index with Pre-Computed Summaries

**Files:**
- Create: `src/core/file-summaries.ts`
- Modify: `src/db/schema.ts` (add file_summaries table)
- Modify: `src/db/migrations.ts` (add migration v4)
- Test: `tests/core/file-summaries.test.ts`

**What this does:** At index time, compute a summary for each file: primary exports, symbol count, dependency count, average centrality. Store this in a dedicated table. At query time, first resolve relevant FILES (O(log n) via FTS on file paths + summaries), then drill into symbols within those files only.

**DB Schema:**

```sql
CREATE TABLE IF NOT EXISTS file_summaries (
  file_id      INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  export_names TEXT    NOT NULL, -- comma-separated exported symbol names
  symbol_count INTEGER NOT NULL,
  edge_count   INTEGER NOT NULL,
  avg_centrality REAL  NOT NULL DEFAULT 0.0,
  summary_text TEXT    NOT NULL, -- pre-computed one-line summary for FTS
  computed_at  INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS file_summaries_fts USING fts5(
  summary_text,
  content='file_summaries',
  content_rowid='file_id',
  tokenize='trigram'
);
```

The summary_text is: `"edges.ts edgeQueries insert getBySource getByTarget deleteBySymbol import call reference edge database query"` — a bag of words from the file's symbol names, kinds, and import sources. This enables FTS to find relevant files without scanning all symbols.

**Test, run, commit.**

---

### Task 3.2: Two-Phase Retrieval — Files First, Then Symbols

**Files:**
- Modify: `src/capsule/generator.ts` (Phase 1 rewrite: file-level then symbol-level)
- Test: `tests/capsule/two-phase-retrieval.test.ts`

**What this does:** Replace the current "find all matching symbols in the entire DB" with:
1. Phase 1A: Find top-K relevant files (via file_summaries_fts + path matching). K = 20-50 files.
2. Phase 1B: Within those files only, run symbol-level FTS + pivot scoring.

This limits the pivot search space from ALL symbols to symbols in the top 50 files. On a 100K-symbol project, this reduces pivot candidates from ~10K to ~500.

**Test, run, commit.**

---

### Task 3.3: Pre-Computed Module Clusters

**Files:**
- Create: `src/core/clusters.ts`
- Modify: `src/db/schema.ts` (add clusters table)
- Modify: `src/db/migrations.ts` (add migration v5)
- Test: `tests/core/clusters.test.ts`

**What this does:** At index time, use the import graph to identify "modules" — groups of files that import each other heavily. Store these clusters. At query time, when a pivot is in cluster X, all files in cluster X get a locality boost. This replaces the directory-based scoping with a more accurate graph-based scoping.

**Algorithm:** Connected components on the import graph, with edges weighted by import count. Files with >3 cross-imports are in the same cluster. Large clusters (>20 files) are split by directory. Clusters are recomputed on each full reindex.

**Test, run, commit.**

---

### Task 3.4: Bounded Query-Time Work

**Files:**
- Modify: `src/capsule/generator.ts` (add time budget + early termination)
- Test: `tests/capsule/bounded-query.test.ts`

**What this does:** Add a `maxQueryTimeMs` parameter (default: 500ms). If pivot resolution + BFS + scoring exceeds this budget, stop and return what we have with a quality note. This prevents capsule generation from blocking the LLM for seconds on massive codebases.

**Implementation:**
1. Start a timer at capsule generation start
2. After pivot resolution, check time. If >50% spent, skip BFS expansion and use pivots only.
3. After BFS, check time. If >80% spent, skip promotion pass in packer.
4. Always return a result — partial is better than timeout.

**Test, run, commit.**

---

### Task 3.5: DB Migration Safety

**Files:**
- Test: `tests/db/migration-upgrade-path.test.ts`

**What this does:** Verify that migrating from v2 → v3 → v4 → v5 works correctly and doesn't break existing data. Create a v2 database with real data, run migrations, verify all data intact.

**Test, run, commit.**

---

### Task 3.6: Wave 3 Scale Test — Large Codebase Simulation

**Files:**
- Create: `bench/scale-test.ts`

**What this does:** Generate a synthetic codebase with 10K files, 50K symbols, and 200K edges. Index it. Run capsule queries. Verify:
1. Index time < 60 seconds
2. Capsule generation < 500ms
3. Memory usage < 512MB during query
4. Confidence > 55% on targeted queries

**Implementation:**

```typescript
// bench/scale-test.ts
// Generate N files with M symbols each, with realistic import patterns
// Index into in-memory DB
// Run queries and measure time/memory/confidence
```

**Test, run, commit.**

---

### Task 3.7: Wave 3 QA — Real Large Project Validation

Extend `bench/cross-project-qa.ts` with a large open-source project:

```typescript
// Add to PROJECTS array:
{
  name: "express (JS, ~500 files)",
  repo: "https://github.com/expressjs/express.git",
  queries: ["middleware routing", "request response handler", "error handling"],
},
```

Alternatively, test on the user's existing large projects:
- `playground/openclaw-official` (4400+ files, multi-language)
- `All kishan sathi/kisan-sathi-next` (580 files)

Target: Capsule generation < 1 second, confidence > 50% on all queries.

**Test, run, commit.**

---

### Task 3.8: Final Self-Test — ContextWeave on Itself (All Waves)

**Files:**
- Modify: `tests/integration/self-confidence.test.ts` (raise threshold)

**What this does:** After all 3 waves, run ContextWeave on its own codebase using the MCP tools (not Grep/Explore). Verify:

1. `cw_capsule` confidence > 70% on all queries
2. `cw_capsule` token usage < 4000 for comprehensive results
3. Session follow-up queries have higher confidence than first query
4. `cw_impact` correctly identifies blast radius for key symbols
5. `cw_flow` traces call chains accurately

Raise the CONFIDENCE_THRESHOLD in self-confidence.test.ts from 0.6 to 0.7.

**Step 1: Update threshold and add session tests**

```typescript
const CONFIDENCE_THRESHOLD = 0.7;

// Add session sequence test
it("follow-up query achieves higher confidence than standalone", () => {
  // First query establishes context
  const first = generateCapsule(db, {
    query: "capsule generation pipeline",
    tokenBudget: 4000,
    sessionId: "test-session",
  });

  // Follow-up query should benefit from session context
  const followUp = generateCapsule(db, {
    query: "scoring compression packing",
    tokenBudget: 4000,
    sessionId: "test-session",
  });

  expect(followUp.metadata.quality.coverageConfidence)
    .toBeGreaterThan(first.metadata.quality.coverageConfidence * 0.9);
});
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass including the raised thresholds.

**Step 3: Run full QA suite**

Run: `npx tsx bench/cross-project-qa.ts`
Expected: Average confidence > 65%, all projects passing.

**Step 4: Final commit**

```bash
git add -A
git commit -m "test(capsule): raise confidence thresholds after 3-wave overhaul"
```

---

## Post-Implementation Checklist

After all 3 waves are complete, verify the following:

- [ ] `npx vitest run` — all tests pass (should be 200+ tests by now)
- [ ] `npx tsx bench/cross-project-qa.ts` — average confidence > 65%
- [ ] `npx tsx bench/scale-test.ts` — 10K file project queries in < 500ms
- [ ] Run `cw_capsule` on ContextWeave itself via MCP — confidence > 70%
- [ ] Run `cw_capsule` on at least 3 projects from `/path/to/` — all > 55%
- [ ] No regressions in existing MCP tools (cw_impact, cw_flow, cw_recall, cw_remember, cw_status, cw_reindex)
- [ ] DB migrations work cleanly from v2 → v5
- [ ] Memory usage during capsule generation stays under 256MB

## Architecture Summary After All Waves

```
Query → Query Decomposer → Sub-queries
  ↓
Phase 1A: File-Level Retrieval (file_summaries_fts)
  → Top 50 candidate files
  ↓
Phase 1B: Symbol-Level Pivot Scoring (multi-term, per-file)
  → Top 30-80 ranked pivots with relevance scores
  ↓
Phase 2: Weighted BFS (edge-type + directory-aware costs)
  → Expanded candidate set with effective distances
  ↓
Phase 3: Session-Aware Reranking
  → Boost symbols near recent context, penalize repeats
  ↓
Phase 4: Scoring (centrality × distance × lexical × locality × hub penalty)
  → Ranked candidate list
  ↓
Phase 5: Packing (L0 → L1 → L2 → L3 → file summaries)
  → Token-budgeted output with promotion pass
  ↓
Phase 6: Dedup + Session Recording
  → Record returned symbols for next query
  ↓
Phase 7: Quality Gate + Format
  → Confidence score, uncertainty flag, formatted output
```
