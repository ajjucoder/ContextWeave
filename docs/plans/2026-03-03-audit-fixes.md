# ContextWeave Audit Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 6 root-cause issues identified in the Sitecraft audit to make ContextWeave reliably replace Grep/Explorer in Claude Code — reducing token consumption instead of increasing it.

**Architecture:** Three layers of fixes: (1) correctness — cw_impact returns real dependents; (2) retrieval quality — cw_capsule stops returning noise; (3) calibration — confidence/flow give actionable signals. Each fix is independent and testable in isolation.

**Tech Stack:** TypeScript ESM, Node 22, better-sqlite3, Vitest, tree-sitter AST edges in SQLite.

---

## Task 1: Fix cw_impact — barrel exports + symbol disambiguation

**Problem:** `traceImpact` finds 2/15+ actual dependents for `useDataLayer`. Root cause is barrel re-exports: components import `useDataLayer` from `hooks/index.ts` (not the original file), so edges point to the re-export symbol, not the original. Also, `resolveSymbol("Site")` resolves to the wrong symbol because it picks `matches[0]` (fuzzy, not most-referenced).

**Files:**
- Modify: `src/mcp/tools/impact.ts`
- Modify: `src/db/queries/symbols.ts`
- Modify: `src/db/queries/edges.ts`
- Test: `tests/unit/impact.test.ts` (create)

---

**Step 1: Write the failing test for barrel export traversal**

Create `tests/unit/impact.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { traceImpactFull } from "../../src/mcp/tools/impact.js";

function seedDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, path TEXT, mtime INTEGER, size INTEGER, indexed_at INTEGER);
    CREATE TABLE IF NOT EXISTS symbols (id INTEGER PRIMARY KEY, file_id INTEGER, name TEXT, kind TEXT, start_line INTEGER, end_line INTEGER, signature TEXT, body_hash TEXT, full_source TEXT, is_exported INTEGER, doc_comment TEXT, centrality REAL DEFAULT 0, last_seen INTEGER);
    CREATE TABLE IF NOT EXISTS edges (id INTEGER PRIMARY KEY, source_symbol_id INTEGER, target_symbol_id INTEGER, kind TEXT, created_at INTEGER);
  `);
  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);

  // useDataLayer defined in hooks/useDataLayer.ts
  files.insert({ path: "hooks/useDataLayer.ts", mtime: 1, size: 100, indexedAt: 1 });
  files.insert({ path: "hooks/index.ts", mtime: 1, size: 50, indexedAt: 1 });
  files.insert({ path: "components/EditPage.tsx", mtime: 1, size: 200, indexedAt: 1 });

  // original symbol
  syms.insert({ fileId: 1, name: "useDataLayer", kind: "function", startLine: 1, endLine: 10, signature: "function useDataLayer()", bodyHash: "h1", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: 1 });
  // barrel re-export: same name, different file (hooks/index.ts)
  syms.insert({ fileId: 2, name: "useDataLayer", kind: "function", startLine: 1, endLine: 1, signature: "function useDataLayer()", bodyHash: "h2", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: 1 });
  // consumer in EditPage imports from barrel (edge to sym id=2, not id=1)
  syms.insert({ fileId: 3, name: "EditPage", kind: "function", startLine: 5, endLine: 50, signature: "function EditPage()", bodyHash: "h3", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: 1 });

  edges.insert({ sourceSymbolId: 3, targetSymbolId: 2, kind: "import", createdAt: 1 });
}

describe("traceImpactFull - barrel exports", () => {
  it("finds consumers that import through barrel re-exports", () => {
    const db = new Database(":memory:");
    seedDb(db);
    // tracing useDataLayer (id=1) should find EditPage (id=3) via barrel alias (id=2)
    const result = traceImpactFull(db, 1, 3);
    const names = result.map((n) => n.name);
    expect(names).toContain("EditPage");
  });

  it("resolves ambiguous symbol preferring highest-centrality match", () => {
    const db = new Database(":memory:");
    seedDb(db);
    // update centrality: original symbol has higher centrality
    db.prepare("UPDATE symbols SET centrality = 0.9 WHERE id = 1").run();
    db.prepare("UPDATE symbols SET centrality = 0.1 WHERE id = 2").run();
    const syms = symbolQueries(db);
    const resolved = syms.getByNamePreferCentrality("useDataLayer");
    expect(resolved?.id).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/impact.test.ts 2>&1 | head -40
```

Expected: FAIL — `traceImpactFull` not exported, `getByNamePreferCentrality` not defined.

**Step 3: Add `getByNamePreferCentrality` to symbols.ts**

In `src/db/queries/symbols.ts`, after `getByName` definition, add:

```typescript
const getByNamePreferCentrality = db.prepare(
  "SELECT * FROM symbols WHERE name = ? ORDER BY centrality DESC LIMIT 1"
);
```

And in the returned object:
```typescript
getByNamePreferCentrality(name: string): SymbolRecord | undefined {
  return mapRow(getByNamePreferCentrality.get(name));
},
```

**Step 4: Export `traceImpactFull` from impact.ts**

In `src/mcp/tools/impact.ts`, rename `traceImpact` to `traceImpactFull` and export it. Also add barrel-alias resolution logic:

```typescript
// After initial BFS result, find all same-named symbols (barrel re-exports)
// and trace their dependents too.
export function traceImpactFull(
  db: Database.Database,
  symbolId: number,
  maxDepth: number
): ImpactNode[] {
  const symbols = symbolQueries(db);

  // get the original symbol's name for alias lookup
  const root = symbols.getById(symbolId);
  if (!root) return [];

  // find all symbols with same name (barrel re-exports)
  const aliases = symbols.getByName(root.name).filter((s) => s.id !== symbolId);

  // trace the original + all aliases
  const seen = new Set<string>();
  const allResults: ImpactNode[] = [];

  for (const id of [symbolId, ...aliases.map((a) => a.id)]) {
    for (const node of traceImpactDirect(db, id, maxDepth)) {
      const key = `${node.file}:${node.line}:${node.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        allResults.push(node);
      }
    }
  }

  return allResults;
}

// rename original function
function traceImpactDirect(db: Database.Database, symbolId: number, maxDepth: number): ImpactNode[] {
  // ... existing traceImpact body unchanged ...
}
```

Update `registerImpactTool` to call `traceImpactFull` instead of `traceImpact`. Also update symbol resolution to use `getByNamePreferCentrality` for single-target queries (file:symbol format):

```typescript
// Support "file.ts:SymbolName" format
const colonIdx = target.lastIndexOf(":");
if (colonIdx > 0 && target.includes(".")) {
  const filePart = target.slice(0, colonIdx);
  const namePart = target.slice(colonIdx + 1);
  const byPath = files.getByPathSuffix(filePart);
  if (byPath) {
    const sym = symbols.getByFileAndName(byPath.id, namePart);
    if (sym) pivotSymbols = [sym];
  }
}
```

Add `getByPathSuffix` to file queries and `getByFileAndName` to symbol queries.

**Step 5: Run tests**

```bash
npx vitest run tests/unit/impact.test.ts 2>&1 | tail -20
```

Expected: PASS (2 tests).

**Step 6: Commit**

```bash
git add src/mcp/tools/impact.ts src/db/queries/symbols.ts src/db/queries/edges.ts src/db/queries/files.ts tests/unit/impact.test.ts
git commit -m "fix(impact): trace barrel re-exports + prefer centrality for disambiguation"
```

---

## Task 2: Fix BFS over-expansion — asymmetric costs + visited cap + lexical gate

**Problem:** BFS visits 77–180 nodes for a 21-symbol result. Incoming edges (callers) are treated same-cost as outgoing edges, causing fan-in explosion. No upper bound on visited nodes.

**Files:**
- Modify: `src/core/weighted-bfs.ts`
- Test: `tests/unit/weighted-bfs.test.ts` (create)

---

**Step 1: Write the failing test**

Create `tests/unit/weighted-bfs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { weightedBfsTraversal } from "../../src/core/weighted-bfs.js";

function seedGraph(db: Database.Database) {
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT);
    CREATE TABLE symbols (id INTEGER PRIMARY KEY, file_id INTEGER, name TEXT, kind TEXT, start_line INTEGER DEFAULT 1, end_line INTEGER DEFAULT 1, signature TEXT DEFAULT '', body_hash TEXT DEFAULT '', full_source TEXT DEFAULT '', is_exported INTEGER DEFAULT 1, doc_comment TEXT, centrality REAL DEFAULT 0, last_seen INTEGER DEFAULT 0);
    CREATE TABLE edges (id INTEGER PRIMARY KEY, source_symbol_id INTEGER, target_symbol_id INTEGER, kind TEXT, created_at INTEGER DEFAULT 0);
  `);
  // hub: symbol 1 in hub.ts called by 20 unrelated symbols
  db.prepare("INSERT INTO files VALUES (1, 'src/core/hub.ts')").run();
  db.prepare("INSERT INTO files VALUES (2, 'src/auth/login.ts')").run();
  db.prepare("INSERT INTO symbols (id, file_id, name) VALUES (1, 1, 'hubFn')").run();
  db.prepare("INSERT INTO symbols (id, file_id, name) VALUES (2, 2, 'loginFn')").run();
  // loginFn calls hubFn: source=2, target=1 (outgoing from loginFn)
  db.prepare("INSERT INTO edges (source_symbol_id, target_symbol_id, kind) VALUES (2, 1, 'call')").run();
  // 18 unrelated callers of hubFn
  for (let i = 3; i <= 20; i++) {
    db.prepare(`INSERT INTO files VALUES (${i}, 'src/unrelated/file${i}.ts')`).run();
    db.prepare(`INSERT INTO symbols (id, file_id, name) VALUES (${i}, ${i}, 'unrelatd${i}')`).run();
    db.prepare(`INSERT INTO edges (source_symbol_id, target_symbol_id, kind) VALUES (${i}, 1, 'call')`).run();
  }
}

describe("weightedBfsTraversal", () => {
  it("respects maxVisitedNodes cap", () => {
    const db = new Database(":memory:");
    seedGraph(db);
    // Starting from loginFn (id=2), with a tight node cap, should not explode through hubFn's callers
    const results = weightedBfsTraversal(db, [2], 5, null, { maxVisitedNodes: 5 });
    expect(results.length).toBeLessThanOrEqual(6); // pivot + max 5 neighbors
  });

  it("incoming edges cost more than outgoing edges", () => {
    const db = new Database(":memory:");
    seedGraph(db);
    // loginFn→hubFn is outgoing (call), hubFn←unrelatd3 is incoming from loginFn's perspective
    // The 18 unrelated callers should be at higher distance than outgoing targets
    const results = weightedBfsTraversal(db, [2], 5, null, {});
    const hubNode = results.find((r) => r.symbolId === 1);
    const unrelatedNode = results.find((r) => r.symbolId === 3);
    if (hubNode && unrelatedNode) {
      // unrelated callers reached via hubFn (incoming edge) should be farther
      expect(unrelatedNode.distance).toBeGreaterThan(hubNode.distance);
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/weighted-bfs.test.ts 2>&1 | head -40
```

Expected: FAIL — `weightedBfsTraversal` doesn't accept options object.

**Step 3: Implement in weighted-bfs.ts**

Three changes to `weightedBfsTraversal`:

1. Add optional `options` parameter:
```typescript
export interface BfsOptions {
  maxVisitedNodes?: number;  // default: 300
  incomingEdgeCostMultiplier?: number;  // default: 1.5
}

export function weightedBfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxDepth: number,
  scopeDirs?: string[] | null,
  options: BfsOptions = {}
): WeightedBfsNode[]
```

2. Apply incoming edge cost multiplier (change ~line 97 of current weighted-bfs.ts):
```typescript
const isIncoming = incoming.some((e) => e.symbol_id === edge.symbol_id);
const incomingMultiplier = isIncoming ? (options.incomingEdgeCostMultiplier ?? 1.5) : 1.0;
const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path) * incomingMultiplier;
```

But since we combine `[...outgoing, ...incoming]`, we need to track which is which. Change to:
```typescript
const maxNodes = options.maxVisitedNodes ?? 300;

// Process outgoing (cost as-is) and incoming (cost * multiplier) separately
for (const edge of outgoing) {
  // existing cost logic
  const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path);
  // ... enqueue logic unchanged
}
for (const edge of incoming) {
  if (!isInScope(edge.file_path)) continue;
  const targetDir = dirname(edge.file_path);
  const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path)
    * (options.incomingEdgeCostMultiplier ?? 1.5);
  // ... same enqueue logic
}
```

3. Add node cap check inside the while loop:
```typescript
if (visited.size >= maxNodes) break;
```

**Step 4: Update all call sites of `weightedBfsTraversal` in generator.ts**

In `src/capsule/generator.ts`, the call at line 366 — update to pass `maxVisitedNodes` derived from retrieval budget:

```typescript
const maxVisitedNodes = Math.min(300, Math.floor(retrievalBudget / 20));
const bfsNodes = skipBfs
  ? [...pivotSymbolIds].map((id) => ({ symbolId: id, distance: 0 }))
  : weightedBfsTraversal(db, [...pivotSymbolIds], maxDepth, scopeDirs, { maxVisitedNodes });
```

**Step 5: Run tests**

```bash
npx vitest run tests/unit/weighted-bfs.test.ts 2>&1 | tail -20
```

Expected: PASS.

**Step 6: Run full test suite to ensure no regressions**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all existing tests pass.

**Step 7: Commit**

```bash
git add src/core/weighted-bfs.ts src/capsule/generator.ts tests/unit/weighted-bfs.test.ts
git commit -m "fix(capsule): asymmetric BFS costs for incoming edges + visited node cap"
```

---

## Task 3: Add path-based retrieval for API route queries

**Problem:** Query "inquiry email notification flow" misses `api/submit-inquiry/route.ts` entirely. The FTS + fuzzy path match doesn't find it because "submit-inquiry" is a path segment, not a symbol name.

**Files:**
- Modify: `src/capsule/generator.ts` (Phase 1, after line 198)
- Modify: `src/db/queries/files.ts`
- Test: `tests/unit/capsule-path-retrieval.test.ts` (create)

---

**Step 1: Write the failing test**

Create `tests/unit/capsule-path-retrieval.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractPathTerms, filePathMatchesQueryTerms } from "../../src/capsule/path-retrieval.js";

describe("filePathMatchesQueryTerms", () => {
  it("matches path segment substring", () => {
    expect(filePathMatchesQueryTerms(
      "app/api/submit-inquiry/route.ts",
      ["submit", "inquiry", "email"]
    )).toBe(true);
  });

  it("does not match unrelated file", () => {
    expect(filePathMatchesQueryTerms(
      "components/ServicesRoute.tsx",
      ["submit", "inquiry", "email"]
    )).toBe(false);
  });

  it("extracts path terms from hyphenated segments", () => {
    const terms = extractPathTerms("app/api/submit-inquiry/route.ts");
    expect(terms).toContain("submit");
    expect(terms).toContain("inquiry");
    expect(terms).toContain("route");
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/capsule-path-retrieval.test.ts 2>&1 | head -20
```

Expected: FAIL — module not found.

**Step 3: Create `src/capsule/path-retrieval.ts`**

```typescript
export function extractPathTerms(filePath: string): string[] {
  return filePath
    .toLowerCase()
    .replace(/\.[^.]+$/, "")  // strip extension
    .split(/[\/\\\-_.]+/)
    .filter((t) => t.length > 2);
}

export function filePathMatchesQueryTerms(
  filePath: string,
  queryTerms: string[]
): boolean {
  const pathTerms = extractPathTerms(filePath);
  const matchCount = queryTerms.filter((qt) =>
    pathTerms.some((pt) => pt.includes(qt) || qt.includes(pt))
  ).length;
  // require at least 2 query terms to match, or 1 term that's ≥6 chars (specific enough)
  const specificTerms = queryTerms.filter((t) => t.length >= 6);
  return matchCount >= 2 || specificTerms.some((qt) =>
    pathTerms.some((pt) => pt.includes(qt) || qt.includes(pt))
  );
}
```

**Step 4: Wire into generator.ts Phase 1 pivot collection**

In `src/capsule/generator.ts`, after the cluster expansion block (after line ~198), add a path-matching pass:

```typescript
// Path-based pivot boost: if query terms match file path segments,
// add all symbols from that file as pivot candidates.
if (intent === "narrow" || intent === "task") {
  const allFiles = files.getAll(); // or use candidateFiles which is cheaper
  for (const file of candidateFiles) {
    if (filePathMatchesQueryTerms(file.path, exactQueryTerms)) {
      const fileSymbols = symbols.getByFileId(file.fileId);
      for (const sym of fileSymbols) {
        rawPivotIds.add(sym.id);
      }
    }
  }
}
```

Import `filePathMatchesQueryTerms` at the top of generator.ts.

**Step 5: Run tests**

```bash
npx vitest run tests/unit/capsule-path-retrieval.test.ts 2>&1 | tail -10
```

Expected: PASS.

**Step 6: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

**Step 7: Commit**

```bash
git add src/capsule/path-retrieval.ts src/capsule/generator.ts tests/unit/capsule-path-retrieval.test.ts
git commit -m "feat(capsule): path-segment matching for API route and file-specific queries"
```

---

## Task 4: Raise legacy/prototype directory costs

**Problem:** `sitecraft/` and `sitecraft_demo_AIStudio/` legacy dirs poison every capsule with ~300 tokens of junk. The `demo` cost multiplier is only 1.5x; needs to be 3.0x. Also add `legacy`, `prototype`, `old`, `archive` patterns.

**Files:**
- Modify: `src/core/weighted-bfs.ts`
- Modify: `src/utils/directory-weights.ts`
- Test: `tests/unit/directory-costs.test.ts` (create)

---

**Step 1: Write the failing test**

Create `tests/unit/directory-costs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getDirectoryWeight } from "../../src/utils/directory-weights.js";

describe("getDirectoryWeight", () => {
  it("heavily penalizes legacy directories", () => {
    expect(getDirectoryWeight("sitecraft_legacy/App.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("sitecraft_demo_AIStudio/App.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("old/components/Button.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("archive/v1/types.ts")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("prototype/experiments.ts")).toBeLessThanOrEqual(0.2);
  });

  it("does not penalize active src directories", () => {
    expect(getDirectoryWeight("src/components/Button.tsx")).toBeGreaterThanOrEqual(0.9);
    expect(getDirectoryWeight("app/api/route.ts")).toBeGreaterThanOrEqual(0.9);
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/directory-costs.test.ts 2>&1 | head -20
```

Expected: FAIL — legacy/demo patterns don't match with ≤0.2 weight.

**Step 3: Read and update directory-weights.ts**

Read: `src/utils/directory-weights.ts`

Update the weight map to add/raise legacy-pattern penalties:

```typescript
const DIRECTORY_WEIGHTS: Array<[RegExp, number]> = [
  // legacy, archive, prototype — very low weight
  [/\/(legacy|archive|old|prototype)\//i, 0.15],
  [/_(legacy|demo|old|prototype|archive)\//i, 0.15],
  [/\/(demo|examples?|samples?)\//i, 0.2],
  // existing test/vendor patterns
  [/\/(tests?|__tests?__|spec|__mocks?__)\//i, 0.3],
  [/\/(vendor|third_party|external)\//i, 0.2],
  [/\/(docs?|documentation)\//i, 0.5],
  [/\/(scripts?|tools?|bin)\//i, 0.6],
];

export function getDirectoryWeight(filePath: string): number {
  for (const [pattern, weight] of DIRECTORY_WEIGHTS) {
    if (pattern.test(filePath)) return weight;
  }
  return 1.0;
}
```

**Step 4: Update weighted-bfs.ts edge cost function**

In `src/core/weighted-bfs.ts`, raise demo/examples cost from 1.5x to 3.0x, and add legacy patterns:

```typescript
function edgeCost(kind: string, sourceDir: string, targetDir: string, targetPath: string): number {
  const base = EDGE_WEIGHTS[kind] ?? 1.0;
  if (sourceDir === targetDir) return base * 0.6;
  if (/\/(tests?|__tests?__|spec)\//i.test(targetPath)) return base * 1.8;
  if (/\/(vendor|third_party|external)\//i.test(targetPath)) return base * 2.5;
  if (/\/(legacy|archive|old|prototype)\//i.test(targetPath)) return base * 3.0;
  if (/_(legacy|demo|old|prototype|archive)\//i.test(targetPath)) return base * 3.0;
  if (/\/(examples?|samples?|demo)\//i.test(targetPath)) return base * 3.0;
  return base;
}
```

**Step 5: Run tests**

```bash
npx vitest run tests/unit/directory-costs.test.ts 2>&1 | tail -10
npx vitest run 2>&1 | tail -20
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/core/weighted-bfs.ts src/utils/directory-weights.ts tests/unit/directory-costs.test.ts
git commit -m "fix(capsule): raise legacy/demo/prototype directory traversal costs to 3x"
```

---

## Task 5: Recalibrate confidence thresholds

**Problem:** Confidence is almost always LOW/HIGH because `pivotCoverage < 0.8` fires whenever even one pivot is excluded by token budget (extremely common). The result is all capsules report `Uncertainty: HIGH` which is meaningless to agents.

**Files:**
- Modify: `src/capsule/confidence.ts`
- Modify: `src/capsule/generator.ts` (lines 754–783, uncertainty flag triggers)
- Test: `tests/unit/confidence.test.ts` (modify existing)

---

**Step 1: Read existing confidence tests**

```bash
cat tests/unit/scorer.test.ts | head -50
```

Check for existing coverage — the existing `self-confidence.test.ts` is the relevant one.

**Step 2: Write the failing tests**

Add to `tests/integration/self-confidence.test.ts` (or create `tests/unit/confidence-calibration.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { computeCoverageConfidence, buildUncertainty } from "../../src/capsule/confidence.js";

describe("confidence calibration", () => {
  it("returns medium uncertainty when 50% of pivots are covered", () => {
    const conf = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 4,
      pivotsIncluded: 2,
      relevantPivotsIncluded: 2,
      totalRelevantPivots: 4,
      dependencyCoverage: 0.6,
      noiseRatio: 0.3,
      fileSummaryCount: 0,
    });
    // 50% coverage should be medium, not high
    const uncertainty = buildUncertainty(true, 1, conf);
    expect(uncertainty).not.toBe("high");
  });

  it("returns low uncertainty when ≥60% pivots covered and low noise", () => {
    const conf = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 5,
      pivotsIncluded: 3,
      relevantPivotsIncluded: 3,
      totalRelevantPivots: 5,
      dependencyCoverage: 0.7,
      noiseRatio: 0.2,
      fileSummaryCount: 2,
    });
    const uncertainty = buildUncertainty(conf < 0.65, 1, conf);
    expect(uncertainty).toBe("low");
  });

  it("returns high uncertainty only when coverage is truly poor", () => {
    const conf = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 10,
      pivotsIncluded: 1,
      relevantPivotsIncluded: 1,
      totalRelevantPivots: 10,
      dependencyCoverage: 0.1,
      noiseRatio: 0.7,
      fileSummaryCount: 0,
    });
    const uncertainty = buildUncertainty(true, 3, conf);
    expect(uncertainty).toBe("high");
  });
});
```

**Step 3: Run to verify it fails**

```bash
npx vitest run tests/unit/confidence-calibration.test.ts 2>&1 | head -30
```

Expected: FAIL — first test returns "high" instead of "medium".

**Step 4: Fix confidence.ts**

Update `buildUncertainty`:

```typescript
export function buildUncertainty(
  lowConfidence: boolean,
  reasonCount: number,
  coverageConfidence: number
): CapsuleUncertainty {
  if (!lowConfidence) return "low";
  // high uncertainty only when multiple reasons AND poor coverage
  if (reasonCount >= 3 || coverageConfidence < 0.35) return "high";
  if (reasonCount >= 2 && coverageConfidence < 0.45) return "high";
  return "medium";
}
```

**Step 5: Fix uncertainty flag in generator.ts**

In `src/capsule/generator.ts` around line 754–783, change `pivotCoverage < 0.8` threshold to `0.5`:

```typescript
// Before:
const reasons: string[] = [];
if (pivotCount === 0) reasons.push("no_pivots");
if (pivotCount > 0 && pivotCoverage < 0.8) reasons.push("low_pivot_coverage");
if (dependencyCoverage < 0.35) reasons.push("low_dependency_coverage");
if (noiseRatio > 0.55) reasons.push("high_noise");

// After:
if (pivotCount === 0) reasons.push("no_pivots");
if (pivotCount > 0 && pivotCoverage < 0.5) reasons.push("low_pivot_coverage");
if (dependencyCoverage < 0.25) reasons.push("low_dependency_coverage");
if (noiseRatio > 0.6) reasons.push("high_noise");

const confidenceFloor = intent === "narrow" ? 0.55 : 0.6;
```

**Step 6: Run tests**

```bash
npx vitest run tests/unit/confidence-calibration.test.ts 2>&1 | tail -10
npx vitest run tests/integration/self-confidence.test.ts 2>&1 | tail -20
npx vitest run 2>&1 | tail -20
```

Expected: all pass. Verify the `self-confidence.test.ts` ratchet doesn't break.

**Step 7: Commit**

```bash
git add src/capsule/confidence.ts src/capsule/generator.ts tests/unit/confidence-calibration.test.ts
git commit -m "fix(capsule): recalibrate confidence thresholds to reduce false HIGH uncertainty"
```

---

## Task 6: Fix cw_flow — honest failure metadata + JSX prop edge tracking

**Problem:** `traceOutgoing("handlePublish")` returns "No outgoing flows found" instead of explaining why. Agents get no signal about whether to fall back to manual reading.

**Files:**
- Modify: `src/mcp/tools/flow.ts`
- Test: `tests/unit/flow.test.ts` (create)

---

**Step 1: Write the failing test**

Create `tests/unit/flow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { buildFlowResult } from "../../src/mcp/tools/flow.js";

function seedSymbolNoEdges(db: Database.Database) {
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT);
    CREATE TABLE symbols (id INTEGER PRIMARY KEY, file_id INTEGER, name TEXT, kind TEXT, start_line INTEGER DEFAULT 1, end_line INTEGER DEFAULT 50, signature TEXT DEFAULT '', body_hash TEXT DEFAULT '', full_source TEXT DEFAULT '', is_exported INTEGER DEFAULT 1, doc_comment TEXT, centrality REAL DEFAULT 0, last_seen INTEGER DEFAULT 0);
    CREATE TABLE edges (id INTEGER PRIMARY KEY, source_symbol_id INTEGER, target_symbol_id INTEGER, kind TEXT, created_at INTEGER DEFAULT 0);
  `);
  db.prepare("INSERT INTO files VALUES (1, 'src/components/Modal.tsx')").run();
  db.prepare("INSERT INTO symbols (id, file_id, name, kind) VALUES (1, 1, 'handlePublish', 'function')").run();
  // No outgoing edges from handlePublish
}

describe("cw_flow honest failure", () => {
  it("returns symbol location when no outgoing flows found", () => {
    const db = new Database(":memory:");
    seedSymbolNoEdges(db);
    const result = buildFlowResult(db, "handlePublish", undefined, 5);
    expect(result.text).toContain("src/components/Modal.tsx");
    expect(result.text).toContain("flows_limited");
  });

  it("indicates static-call limitation in failure message", () => {
    const db = new Database(":memory:");
    seedSymbolNoEdges(db);
    const result = buildFlowResult(db, "handlePublish", undefined, 5);
    expect(result.text).toContain("static");
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/flow.test.ts 2>&1 | head -20
```

Expected: FAIL — `buildFlowResult` not exported.

**Step 3: Refactor flow.ts to export `buildFlowResult`**

Extract the core logic of the MCP handler into a testable function:

```typescript
export interface FlowResult {
  text: string;
  isLimited: boolean;
}

export function buildFlowResult(
  db: Database.Database,
  source: string,
  target: string | undefined,
  maxHops: number
): FlowResult {
  const sourceId = resolveSymbol(db, source);

  if (!sourceId) {
    return {
      text: `No symbol found matching "${source}"`,
      isLimited: false,
    };
  }

  // ... existing path/outgoing logic ...

  if (paths.length === 0) {
    const symbols = symbolQueries(db);
    const files = fileQueries(db);
    const sym = symbols.getById(sourceId);
    const file = sym ? files.getById(sym.fileId) : undefined;
    const location = file && sym ? `${file.path}:${sym.startLine}` : "unknown";

    return {
      text: [
        `No outgoing flows found from "${source}" (flows_limited: true).`,
        `Symbol location: ${location}`,
        `Reason: analysis is limited to static call expressions. Prop callbacks,`,
        `higher-order functions, and dynamic dispatch are not traced.`,
        `Recommendation: use cw_read to inspect "${source}" directly.`,
      ].join("\n"),
      isLimited: true,
    };
  }

  // ... format found paths as before ...
  return { text: lines.join("\n"), isLimited: false };
}
```

Update `registerFlowTool` to call `buildFlowResult` and return its `.text`.

**Step 4: Run tests**

```bash
npx vitest run tests/unit/flow.test.ts 2>&1 | tail -10
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/mcp/tools/flow.ts tests/unit/flow.test.ts
git commit -m "fix(flow): return symbol location and limitation explanation when no flows found"
```

---

## Task 7: Annotate cw_search results with containing symbol context

**Problem:** `cw_search` matches text correctly but returns raw line+content without the containing symbol name/kind. This makes it equivalent to Grep with no AST advantage.

**Files:**
- Modify: `src/mcp/tools/search.ts`
- Modify: `src/db/queries/symbols.ts` (add `getEnclosingSymbol` query)
- Test: `tests/unit/search-symbol-context.test.ts` (create)

---

**Step 1: Write the failing test**

Create `tests/unit/search-symbol-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { getEnclosingSymbol } from "../../src/db/queries/symbols.js";

function seedDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT);
    CREATE TABLE symbols (id INTEGER PRIMARY KEY, file_id INTEGER, name TEXT, kind TEXT, start_line INTEGER, end_line INTEGER, signature TEXT DEFAULT '', body_hash TEXT DEFAULT '', full_source TEXT DEFAULT '', is_exported INTEGER DEFAULT 0, doc_comment TEXT, centrality REAL DEFAULT 0, last_seen INTEGER DEFAULT 0);
  `);
  db.prepare("INSERT INTO files VALUES (1, 'src/utils/toast.ts')").run();
  db.prepare("INSERT INTO symbols VALUES (1, 1, 'showToast', 'function', 10, 30, '', '', '', 1, null, 0, 0)").run();
}

describe("getEnclosingSymbol", () => {
  it("returns the symbol that contains a given line", () => {
    const db = new Database(":memory:");
    seedDb(db);
    const sym = getEnclosingSymbol(db, 1, 15);  // line 15 is inside showToast (10-30)
    expect(sym?.name).toBe("showToast");
    expect(sym?.kind).toBe("function");
  });

  it("returns null for line outside any symbol", () => {
    const db = new Database(":memory:");
    seedDb(db);
    const sym = getEnclosingSymbol(db, 1, 5);  // line 5 is before showToast starts
    expect(sym).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/search-symbol-context.test.ts 2>&1 | head -20
```

Expected: FAIL — `getEnclosingSymbol` not exported.

**Step 3: Add `getEnclosingSymbol` to symbols.ts**

```typescript
const getEnclosingSymbolStmt = db.prepare(`
  SELECT * FROM symbols
  WHERE file_id = ? AND start_line <= ? AND end_line >= ?
  ORDER BY (end_line - start_line) ASC
  LIMIT 1
`);
```

In returned object:
```typescript
getEnclosingSymbol(fileId: number, line: number): SymbolRecord | null {
  return mapRow(getEnclosingSymbolStmt.get(fileId, line, line)) ?? null;
},
```

Export as standalone function too:
```typescript
export function getEnclosingSymbol(
  db: Database.Database,
  fileId: number,
  line: number
): SymbolRecord | null {
  return symbolQueries(db).getEnclosingSymbol(fileId, line);
}
```

**Step 4: Wire into search.ts**

In `src/mcp/tools/search.ts`, after collecting text matches, for each match:
```typescript
const sym = symbols.getEnclosingSymbol(file.id, match.line);
const context = sym ? ` [in ${sym.kind} ${sym.name}]` : "";
lines.push(`${match.file}:${match.line}${context}: ${match.content}`);
```

**Step 5: Run tests**

```bash
npx vitest run tests/unit/search-symbol-context.test.ts 2>&1 | tail -10
npx vitest run 2>&1 | tail -20
```

**Step 6: Commit**

```bash
git add src/mcp/tools/search.ts src/db/queries/symbols.ts tests/unit/search-symbol-context.test.ts
git commit -m "feat(search): annotate text matches with enclosing symbol name and kind"
```

---

## Task 8: Add staleness indicator to cw_overview + file:symbol support in cw_read

**Problem A:** `cw_overview` doesn't tell the agent when files have been modified since indexing. If the user edited 5 files since the last index, the capsule returns stale data.

**Problem B:** `cw_read` doesn't support `"file.ts:SymbolName"` format, forcing agents to know line numbers.

**Files:**
- Modify: `src/mcp/tools/overview.ts`
- Modify: `src/mcp/tools/read.ts`
- Modify: `src/db/queries/files.ts`
- Test: `tests/unit/overview-staleness.test.ts` (create)
- Test: `tests/unit/read-file-symbol.test.ts` (create)

---

**Step 1: Write failing tests**

Create `tests/unit/overview-staleness.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { countStaleFiles } from "../../src/db/queries/files.js";

function seedDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, mtime INTEGER, size INTEGER, indexed_at INTEGER);
  `);
  db.prepare("INSERT INTO files VALUES (1, 'src/a.ts', 1000, 100, 900)").run();  // stale: mtime > indexed_at
  db.prepare("INSERT INTO files VALUES (2, 'src/b.ts', 800, 100, 900)").run();   // fresh
  db.prepare("INSERT INTO files VALUES (3, 'src/c.ts', 950, 100, 900)").run();   // stale
}

describe("countStaleFiles", () => {
  it("counts files where mtime > indexed_at", () => {
    const db = new Database(":memory:");
    seedDb(db);
    expect(countStaleFiles(db)).toBe(2);
  });
});
```

Create `tests/unit/read-file-symbol.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSymbolTarget } from "../../src/mcp/tools/read.js";

describe("parseSymbolTarget", () => {
  it("parses file:symbol format", () => {
    const result = parseSymbolTarget("types.ts:Site");
    expect(result).toEqual({ fileSuffix: "types.ts", symbolName: "Site" });
  });

  it("returns null for plain symbol name", () => {
    const result = parseSymbolTarget("Site");
    expect(result).toBeNull();
  });

  it("handles path with multiple segments", () => {
    const result = parseSymbolTarget("src/types.ts:Site");
    expect(result).toEqual({ fileSuffix: "src/types.ts", symbolName: "Site" });
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx vitest run tests/unit/overview-staleness.test.ts tests/unit/read-file-symbol.test.ts 2>&1 | head -30
```

Expected: FAIL — both exports missing.

**Step 3: Add `countStaleFiles` to files.ts**

```typescript
const countStaleStmt = db.prepare(
  "SELECT COUNT(*) as count FROM files WHERE mtime > indexed_at"
);
```

In returned object:
```typescript
countStale(): number {
  return (countStaleStmt.get() as { count: number }).count;
},
```

Export standalone:
```typescript
export function countStaleFiles(db: Database.Database): number {
  return fileQueries(db).countStale();
}
```

**Step 4: Wire staleness into overview.ts**

In `src/mcp/tools/overview.ts`, after gathering index health stats, add:

```typescript
const staleCount = files.countStale();
if (staleCount > 0) {
  lines.push(`\n⚠ ${staleCount} file(s) modified since last index. Run cw_reindex to update.`);
}
```

**Step 5: Add `parseSymbolTarget` and wire into read.ts**

In `src/mcp/tools/read.ts`, export:

```typescript
export function parseSymbolTarget(
  input: string
): { fileSuffix: string; symbolName: string } | null {
  // Must contain "." (file extension) and ":" before the symbol
  const lastColon = input.lastIndexOf(":");
  if (lastColon < 1) return null;
  const filePart = input.slice(0, lastColon);
  if (!filePart.includes(".")) return null;
  return { fileSuffix: filePart, symbolName: input.slice(lastColon + 1) };
}
```

In the MCP handler, before the existing symbol resolution, check for `file:symbol` format:

```typescript
const parsed = parseSymbolTarget(symbol);
if (parsed) {
  const matchedFile = files.getByPathSuffix(parsed.fileSuffix);
  if (matchedFile) {
    const sym = symbols.getByFileAndName(matchedFile.id, parsed.symbolName);
    if (sym) {
      // use sym directly, skip fuzzy resolution
    }
  }
}
```

(Requires `getByPathSuffix` and `getByFileAndName` added to respective queries — add them.)

**Step 6: Run all tests**

```bash
npx vitest run tests/unit/overview-staleness.test.ts tests/unit/read-file-symbol.test.ts 2>&1 | tail -10
npx vitest run 2>&1 | tail -30
```

Expected: all pass.

**Step 7: Commit**

```bash
git add src/mcp/tools/overview.ts src/mcp/tools/read.ts src/db/queries/files.ts tests/unit/overview-staleness.test.ts tests/unit/read-file-symbol.test.ts
git commit -m "feat(tools): staleness indicator in cw_overview, file:symbol format in cw_read"
```

---

## Task 9: Verify end-to-end with quality baseline

Run the existing quality baseline test suite and update the ratchet to confirm all improvements hold and no regressions were introduced.

**Files:**
- Test: `tests/integration/task-query-quality.test.ts` (run existing)
- Test: `tests/integration/self-confidence.test.ts` (run existing)
- Test: `tests/integration/threshold-ratchet.test.ts` (run existing)

---

**Step 1: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build, no TypeScript errors.

**Step 2: Run full test suite**

```bash
npx vitest run 2>&1 | tail -40
```

Expected: all tests pass.

**Step 3: Run quality baseline specifically**

```bash
npx vitest run tests/integration/task-query-quality.test.ts tests/integration/self-confidence.test.ts tests/integration/threshold-ratchet.test.ts 2>&1
```

**Step 4: If ratchet tests fail with improved scores, update baseline**

```bash
npx tsx tests/integration/update-baseline.ts
git add tests/integration/quality-baseline.json
```

**Step 5: Final commit**

```bash
git add tests/integration/quality-baseline.json
git commit -m "test: update quality baseline after audit fix improvements"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-03-audit-fixes.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.

**2. Parallel Session (separate)** — Open a new session in this project directory, reference this plan, use `superpowers:executing-plans` for batch execution with checkpoints.

Which approach?
