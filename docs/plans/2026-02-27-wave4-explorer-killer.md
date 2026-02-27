# Wave 4: Explorer-Killer — Self-Optimizing Capsule Intelligence

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ContextWeave capsules sufficient to replace Grep + Explore agent for 90%+ of real-world Claude Code tasks. Broad queries ("find bugs", "implement feature X", "check for AISlop") must achieve 75%+ confidence. Multi-agent teams (6-15 concurrent agents) must be able to call `cw_capsule` simultaneously without contention. A self-improving test harness must measure and drive these improvements automatically.

**Architecture:** Four phases that build on the Wave 1-3 foundation:
1. **Self-Improving QA Harness** — regression tests that measure real-world task performance and fail when capsule quality degrades
2. **Query Intent Classification** — detect narrow vs. broad vs. task-oriented queries and route to different retrieval strategies
3. **Multi-Pass Capsule Strategy** — for broad queries, decompose into focused sub-capsules and merge results with story-complete packing
4. **Concurrent Agent Support** — connection pooling, read-only capsule path, WAL-optimized concurrency for 6-15 simultaneous agents

**Tech Stack:** TypeScript ESM, better-sqlite3 (WAL mode), tree-sitter, gpt-tokenizer, vitest

**Project Root:** `/path/to/ContextWeave`

**Key Files Reference (post Wave 1-3):**
- Capsule generator: `src/capsule/generator.ts` (~640 lines, 7-phase pipeline)
- Pivot scorer: `src/capsule/pivot-scorer.ts` (multi-term scoring, stem matching)
- Weighted BFS: `src/core/weighted-bfs.ts` (Dijkstra-style, edge-type costs)
- Query decomposer: `src/capsule/query-decomposer.ts` (stop-words, term groups)
- Session context: `src/capsule/session-context.ts` (cross-query dedup)
- File summaries: `src/core/file-summaries.ts` (FTS5 trigram, two-phase retrieval)
- Module clusters: `src/core/clusters.ts` (Union-Find on import edges)
- Packer: `src/capsule/packer.ts` (L0-L3 compression, promotion pass, file summaries)
- Formatter: `src/capsule/formatter.ts` (header + code sections + unpacked + quality notes)
- DB connection: `src/db/connection.ts` (WAL mode, busy_timeout=5000, cache_size=-32000)
- DB schema: `src/db/schema.ts` (files, symbols, edges, sessions, session_context, file_summaries, file_clusters, etc.)
- MCP capsule tool: `src/mcp/tools/capsule.ts` (registers cw_capsule)
- MCP server: `src/mcp/server.ts` (stdio transport, single DB instance, session lock)
- Self-confidence test: `tests/integration/self-confidence.test.ts` (7 tests, 70% threshold)
- Cross-project QA: `bench/cross-project-qa.ts` (4 repos, session sequences)

**Current Metrics (post Wave 1-3 on ContextWeave itself, 154 files, 965 symbols, 3797 edges):**
- Focused queries (2-3 terms, symbol names): 81% confidence — HIGH
- Broad queries (8-10 terms, natural language): 37-52% confidence — LOW
- Self-test average (7 symbol-name queries): 83.5% — passes 70% threshold
- Cross-project QA (4 repos, symbol queries): 87.2% average
- Session token dedup: 44.4% reduction on follow-up queries
- Scale: 1K files/5K symbols at 7ms, 47MB heap

**The Gap:** Focused symbol lookups work great. But real-world Claude usage is broad: "find bugs in authentication", "implement dark mode", "check for AISlop code". These broad task-oriented queries hit 37-52% because the pipeline treats them identically to narrow symbol lookups. Claude falls back to Grep + Explorer, which costs 30-100K tokens.

---

## PHASE 1: Self-Improving QA Harness (Tasks 1.1-1.4)

**Problem:** The current self-confidence test uses narrow symbol queries ("generateCapsule", "weightedBfsTraversal") which already score 80%+. There's no test for the broad task-oriented queries that actually cause Claude to fall back to Grep. Without measuring broad query performance, we can't improve it.

**Solution:** Build a comprehensive QA harness that measures capsule quality against real-world task patterns (not just symbol lookups). The harness tests three query classes: narrow, broad, and task-oriented. It runs on every `npm test` and fails when any class drops below its threshold.

---

### Task 1.1: Real-World Task Query Suite

**Files:**
- Create: `tests/integration/task-query-quality.test.ts`

**What this does:** Defines three query classes with different quality thresholds, reflecting how Claude actually uses `cw_capsule` in practice.

**Implementation:**

```typescript
// tests/integration/task-query-quality.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

afterAll(() => db?.close());

// CLASS A: Narrow symbol queries (current sweet spot)
const NARROW_QUERIES = [
  "generateCapsule",
  "weightedBfsTraversal",
  "scorePivotRelevance",
  "SessionContext",
  "computeClusters",
];

// CLASS B: Broad architectural queries (what Claude asks when exploring)
const BROAD_QUERIES = [
  "capsule generation pipeline scoring compression",
  "database schema migration tables indexes",
  "file indexing parsing symbol extraction",
  "memory observation staleness confidence decay",
  "MCP server tool registration transport",
];

// CLASS C: Task-oriented queries (what users tell Claude to do)
const TASK_QUERIES = [
  "find bugs in the capsule pipeline",
  "how does the indexer handle file changes",
  "implement a new MCP tool for symbol search",
  "optimize the BFS traversal for large graphs",
  "check for error handling issues in database queries",
];

const NARROW_THRESHOLD = 0.70;
const BROAD_THRESHOLD = 0.55;  // starts low, Phase 2+3 will raise to 0.70
const TASK_THRESHOLD = 0.50;   // starts low, Phase 2+3 will raise to 0.65

describe("query quality by class", () => {
  describe("CLASS A: narrow symbol queries", () => {
    for (const query of NARROW_QUERIES) {
      it(`"${query}" confidence > ${NARROW_THRESHOLD * 100}%`, () => {
        const result = generateCapsule(db, { query, tokenBudget: 4000 });
        expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(NARROW_THRESHOLD);
      });
    }
  });

  describe("CLASS B: broad architectural queries", () => {
    for (const query of BROAD_QUERIES) {
      it(`"${query}" confidence > ${BROAD_THRESHOLD * 100}%`, () => {
        const result = generateCapsule(db, { query, tokenBudget: 5000 });
        expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(BROAD_THRESHOLD);
      });
    }
  });

  describe("CLASS C: task-oriented queries", () => {
    for (const query of TASK_QUERIES) {
      it(`"${query}" confidence > ${TASK_THRESHOLD * 100}%`, () => {
        const result = generateCapsule(db, { query, tokenBudget: 6000 });
        expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(TASK_THRESHOLD);
      });
    }
  });

  it("overall average confidence > 60%", () => {
    const allQueries = [...NARROW_QUERIES, ...BROAD_QUERIES, ...TASK_QUERIES];
    let total = 0;
    for (const query of allQueries) {
      const result = generateCapsule(db, { query, tokenBudget: 5000 });
      total += result.metadata.quality.coverageConfidence;
    }
    expect(total / allQueries.length).toBeGreaterThan(0.60);
  });
});
```

**Acceptance:** All narrow queries pass 70%, broad pass 55%, task pass 50%. The thresholds are deliberately low at first — Phase 2 and 3 improvements will push them up, and then the thresholds get raised (see Task 1.4).

---

### Task 1.2: Capsule Diagnostic Reporter

**Files:**
- Create: `src/capsule/diagnostics.ts`
- Test: `tests/capsule/diagnostics.test.ts`

**What this does:** After each capsule generation, produces structured diagnostic data that identifies WHY confidence was low. This drives the self-improvement loop — diagnostics tell you exactly which pipeline stage failed and what to fix.

**Implementation:**

```typescript
// src/capsule/diagnostics.ts
export interface CapsuleDiagnostic {
  queryClass: "narrow" | "broad" | "task";
  pivotStats: {
    rawCandidates: number;
    afterRanking: number;
    afterPacking: number;
    topPivotScores: number[];       // top 5 pivot scores
    bottomPivotScores: number[];    // bottom 5 ranked pivot scores (shows score cliff)
  };
  coverageStats: {
    filesRetrieved: number;
    filesRelevant: number;          // files containing packed symbols
    symbolsRetrieved: number;
    symbolsPacked: number;
    tokenBudgetUsed: number;        // percentage
    l0Count: number;                // full source
    l1Count: number;                // skeleton
    l2Count: number;                // summary
    l3Count: number;                // reference
  };
  bottleneck: "pivot_flood" | "bfs_noise" | "packing_scatter" | "budget_exhaustion" | "none";
  bottleneckDetail: string;
  suggestion: string;
}

export function classifyQuery(query: string, pivotCount: number): "narrow" | "broad" | "task" {
  const words = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const taskVerbs = new Set(["find", "check", "implement", "add", "fix", "optimize", "refactor", "debug", "review", "test", "how", "what", "why"]);
  const hasTaskVerb = words.some(w => taskVerbs.has(w));
  if (hasTaskVerb) return "task";
  if (words.length <= 3 && pivotCount <= 30) return "narrow";
  return "broad";
}

export function diagnose(metadata: CapsuleMetadata, pivotScores: number[]): CapsuleDiagnostic {
  // Analyze which pipeline stage is the bottleneck
  // Returns structured diagnostic with actionable suggestion
}
```

The `diagnose` function analyzes the metadata from `generateCapsule` output and identifies the bottleneck:
- **pivot_flood**: stageA > 200 candidates, meaning FTS returned too many matches → need better query intent filtering
- **bfs_noise**: stageB has many symbols but few are packed → BFS expanded into irrelevant territory
- **packing_scatter**: packed symbols span 10+ files with <3 symbols per file → need story-complete packing
- **budget_exhaustion**: token budget used >90% but pivot coverage <50% → need higher budget or better compression
- **none**: all metrics healthy

**Acceptance:** `classifyQuery` correctly identifies narrow/broad/task for 90%+ of test cases. `diagnose` returns correct bottleneck for synthetic inputs.

---

### Task 1.3: Diagnostic Integration into Generator

**Files:**
- Modify: `src/capsule/generator.ts` (add diagnostics to CapsuleMetadata)
- Modify: `src/core/types.ts` (extend CapsuleMetadata with optional diagnostics)
- Modify: `src/capsule/formatter.ts` (render diagnostic section when present)

**What this does:** Wires diagnostics into the capsule pipeline so every capsule includes structured quality feedback. Claude (or the self-improving test) can read the diagnostic section and know exactly what went wrong.

**Implementation details:**
- Add `diagnostics?: CapsuleDiagnostic` to `CapsuleMetadata` in `src/core/types.ts`
- After the quality gate in `generator.ts` (after line 569), call `diagnose(metadata, pivotScores)` where `pivotScores` are collected during pivot ranking
- The pivot scores array is already available from `rankPivots` — expose the scores in the return, not just the Map
- In `formatter.ts`, add optional `--- Diagnostics ---` section with bottleneck and suggestion when `diagnostics` is present
- Diagnostics are always computed (cheap — just metadata analysis) but only rendered in the formatted output when confidence < 65% (LOW), to avoid noise on good capsules

**Acceptance:** Capsules with LOW confidence include a `--- Diagnostics ---` section identifying the bottleneck. Run full test suite — all 223+ tests still pass.

---

### Task 1.4: Threshold Ratchet Test

**Files:**
- Create: `tests/integration/threshold-ratchet.test.ts`

**What this does:** Records the current best confidence scores per query class in a JSON baseline file. On each test run, verifies scores haven't regressed below the baseline. After any optimization that improves scores, the baseline is updated (manually or via a script). This is the "self-improving" mechanism — the test only allows forward progress.

**Implementation:**

```typescript
// tests/integration/threshold-ratchet.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
// ... standard DB setup ...

const BASELINE_PATH = resolve(__dirname, "../../.contextweave/quality-baseline.json");

interface QualityBaseline {
  narrow: { avgConfidence: number; minConfidence: number };
  broad: { avgConfidence: number; minConfidence: number };
  task: { avgConfidence: number; minConfidence: number };
  updatedAt: string;
}

function loadBaseline(): QualityBaseline {
  if (!existsSync(BASELINE_PATH)) {
    // Bootstrap with conservative defaults
    return {
      narrow: { avgConfidence: 0.70, minConfidence: 0.60 },
      broad: { avgConfidence: 0.40, minConfidence: 0.30 },
      task: { avgConfidence: 0.35, minConfidence: 0.25 },
      updatedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
}

// The test measures current scores and verifies they're >= baseline
// After improvements, run: npx tsx tests/integration/update-baseline.ts
// to snapshot new higher thresholds
describe("quality ratchet — no regression allowed", () => {
  const baseline = loadBaseline();

  it("narrow queries don't regress below baseline", () => {
    // run NARROW_QUERIES, compute avg, compare to baseline.narrow.avgConfidence
  });

  it("broad queries don't regress below baseline", () => {
    // run BROAD_QUERIES, compute avg, compare to baseline.broad.avgConfidence
  });

  it("task queries don't regress below baseline", () => {
    // run TASK_QUERIES, compute avg, compare to baseline.task.avgConfidence
  });
});
```

Also create `tests/integration/update-baseline.ts` — a script that runs all queries, measures scores, and writes the new baseline JSON. Run this manually after each Phase completes to ratchet the thresholds up.

**Acceptance:** Baseline file is created on first run. All ratchet tests pass. Baseline update script works.

---

## PHASE 2: Query Intent Classification + Smart Routing (Tasks 2.1-2.5)

**Problem:** The pipeline treats "generateCapsule" identically to "find bugs in the capsule pipeline". Both go through the same FTS → BFS → pack path. But they need fundamentally different strategies:
- **Narrow:** precise FTS match → short BFS → pack a few symbols at L0 = done
- **Broad:** need to cover multiple code areas → wider BFS → pack representative symbols from each area
- **Task:** need to understand what the task implies → map verbs to code patterns → find relevant modules first

**Solution:** Classify the query, then route to a strategy-specific pipeline variant.

---

### Task 2.1: Query Intent Classifier

**Files:**
- Create: `src/capsule/intent-classifier.ts`
- Test: `tests/capsule/intent-classifier.test.ts`

**What this does:** Classifies a query into one of three intents, each triggering different pipeline behavior.

**Implementation:**

```typescript
// src/capsule/intent-classifier.ts
export type QueryIntent = "narrow" | "broad" | "task";

export interface ClassifiedQuery {
  intent: QueryIntent;
  normalizedTerms: string[];      // cleaned, deduplicated terms
  focusTerms: string[];           // highest-signal terms (for narrow: the symbol name; for broad: key nouns; for task: target nouns)
  actionVerbs: string[];          // for task queries: find, implement, fix, etc.
  impliedModules: string[];       // inferred from terms: e.g., "auth" → authentication, login, session
  suggestedBudgetMultiplier: number;  // 1.0 for narrow, 1.5 for broad, 2.0 for task
}

const TASK_VERBS = new Set(["find", "check", "implement", "add", "fix", "optimize",
  "refactor", "debug", "review", "test", "remove", "update", "create", "delete",
  "improve", "investigate", "audit", "migrate", "replace", "extract"]);

const MODULE_SYNONYMS: Record<string, string[]> = {
  auth: ["authentication", "login", "session", "token", "jwt", "password", "credential"],
  db: ["database", "query", "sql", "schema", "migration", "table", "index"],
  api: ["endpoint", "route", "handler", "request", "response", "middleware", "controller"],
  ui: ["component", "view", "page", "template", "render", "layout", "style"],
  test: ["spec", "assert", "mock", "fixture", "coverage"],
  // ... expand based on common project patterns
};

export function classifyQueryIntent(query: string): ClassifiedQuery {
  const words = query.toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);

  const actionVerbs = words.filter(w => TASK_VERBS.has(w));
  const hasTaskVerb = actionVerbs.length > 0;
  const nonVerbTerms = words.filter(w => !TASK_VERBS.has(w) && !STOP_WORDS.has(w));

  // Intent classification heuristics
  let intent: QueryIntent;
  if (hasTaskVerb && nonVerbTerms.length >= 2) {
    intent = "task";
  } else if (nonVerbTerms.length <= 2 && !hasTaskVerb) {
    intent = "narrow";
  } else if (nonVerbTerms.length >= 4 || (hasTaskVerb && nonVerbTerms.length >= 3)) {
    intent = "broad"; // or "task" if verb present
  } else {
    intent = nonVerbTerms.length <= 3 ? "narrow" : "broad";
  }

  // Extract focus terms (highest signal words)
  // For camelCase compound words, they're likely symbol names → high signal
  const focusTerms = nonVerbTerms.filter(t =>
    t.match(/[A-Z]/) || t.includes("_") || t.length >= 6
  );

  // Infer implied modules from terms
  const impliedModules: string[] = [];
  for (const term of nonVerbTerms) {
    for (const [module, synonyms] of Object.entries(MODULE_SYNONYMS)) {
      if (term === module || synonyms.includes(term)) {
        impliedModules.push(module);
      }
    }
  }

  return {
    intent,
    normalizedTerms: nonVerbTerms,
    focusTerms: focusTerms.length > 0 ? focusTerms : nonVerbTerms.slice(0, 2),
    actionVerbs,
    impliedModules,
    suggestedBudgetMultiplier: intent === "narrow" ? 1.0 : intent === "broad" ? 1.5 : 2.0,
  };
}
```

**Acceptance:**
- "generateCapsule" → narrow
- "capsule generation pipeline scoring compression" → broad
- "find bugs in the capsule pipeline" → task
- "implement a new MCP tool for symbol search" → task
- "SessionContext" → narrow
- "database schema migration tables indexes" → broad
- At least 90% accuracy on a 30-query test suite

---

### Task 2.2: Strategy Router in Generator

**Files:**
- Modify: `src/capsule/generator.ts` (add strategy routing after query classification)

**What this does:** After classifying the query intent, the generator adjusts its behavior:

**For narrow queries (current behavior, optimized):**
- MAX_PIVOTS stays at `Math.max(30, tokenBudget / 50)`
- BFS depth stays at `getBfsDepth(tokenBudget)`
- Packer uses standard L0-L3 levels
- No changes needed — this path already scores 81%

**For broad queries:**
- MAX_PIVOTS increases to `Math.max(50, tokenBudget / 30)` — cast a wider net
- BFS depth reduced by 1 (shallow but wide)
- Selection limit increases by 1.5x
- **New: Module-aware grouping** — group candidates by file cluster, ensure at least 1 representative from each relevant cluster is packed
- Confidence formula adjusts: `relevantCoverage` weight drops from 0.5 to 0.35, `fileSummaryCount` weight increases (more file summaries = better coverage for broad queries)

**For task queries:**
- **New: Task decomposition** — extract action verb + target, map to code patterns
- FTS search uses `focusTerms` only (not all terms), reducing pivot flood
- BFS uses `impliedModules` to scope traversal (e.g., task about "auth" only traverses auth-related clusters)
- Budget multiplier applied: if user passed 4000, internally use 4000 * 2.0 = 8000 for retrieval, but still pack to 4000 (more candidates to choose from, better selection)

**Implementation approach:**
- Add `classifyQueryIntent(query)` call at the top of `generateCapsule`, before Phase 1
- Store the `ClassifiedQuery` in a local variable
- At each phase, check `classified.intent` and branch behavior:
  - Phase 1 (pivot resolution): adjust MAX_PIVOTS and FTS search terms based on intent
  - Phase 2 (BFS): adjust depth and scope based on intent
  - Phase 3 (scoring): adjust locality/lexical weights based on intent
  - Phase 4 (selection): adjust candidate limit and use module-aware grouping for broad/task
  - Phase 5 (packing): use story-complete packing for broad/task (see Task 2.3)
- Include `intent` in the diagnostics

**Acceptance:** All 223+ existing tests still pass. New test verifying that broad queries get more candidates selected. New test verifying task queries use focus terms.

---

### Task 2.3: Story-Complete Packing

**Files:**
- Modify: `src/capsule/packer.ts` (add story-complete packing mode)
- Test: `tests/capsule/story-packing.test.ts`

**What this does:** For broad/task queries, instead of packing the top N symbols by score (which scatters across 10+ files), pack "stories" — complete context around the top concerns.

**Current packing behavior:** Sort all scored nodes by score descending, pack greedily until budget exhausted. This gives you symbol #1 from file A, symbol #2 from file B, symbol #3 from file C, etc. Scattered.

**New story-complete packing (for broad/task intents):**

```
1. Group candidates by file cluster (or directory if no cluster)
2. Score each group by: max pivot score in group + count of pivots in group
3. For the top K groups (K = tokenBudget / 1000):
   a. Include ALL pivots in the group at L0 (full source)
   b. Include direct call dependencies at L1 (skeleton)
   c. Include remaining same-file symbols at L2 (summary)
4. Remaining budget: fill with highest-scored symbols from other groups at L3 (reference)
```

This means the capsule tells a complete story about the 3-5 most relevant code areas, rather than giving scattered fragments of 15 areas.

**Implementation:**

```typescript
export function packNodesStoryMode(
  scoredNodes: ScoredNode[],
  tokenBudget: number,
  codeRatio: number,
  clusterMap: Map<number, number>,  // symbolId → clusterId
): PackResult {
  const codeBudget = Math.floor(tokenBudget * codeRatio);

  // Group by cluster
  const groups = new Map<number, ScoredNode[]>();
  for (const node of scoredNodes) {
    const clusterId = clusterMap.get(node.symbol.id) ?? -node.file.id; // fallback: group by file
    const group = groups.get(clusterId) ?? [];
    group.push(node);
    groups.set(clusterId, group);
  }

  // Score and rank groups
  const groupScores = [...groups.entries()].map(([id, nodes]) => ({
    id,
    nodes,
    score: nodes.reduce((max, n) => Math.max(max, n.score), 0) +
           nodes.filter(n => n.distance === 0).length * 2,  // pivot count bonus
  })).sort((a, b) => b.score - a.score);

  // Pack top groups story-complete
  const packed: ScoredNode[] = [];
  let tokensUsed = 0;
  const budgetPerGroup = Math.floor(codeBudget / Math.max(1, Math.min(groupScores.length, 5)));

  for (const group of groupScores) {
    if (tokensUsed >= codeBudget * 0.9) break;
    const groupBudget = Math.min(budgetPerGroup, codeBudget - tokensUsed);

    // Sort within group: pivots first, then by score
    const sorted = [...group.nodes].sort((a, b) => {
      if (a.distance === 0 && b.distance !== 0) return -1;
      if (b.distance === 0 && a.distance !== 0) return 1;
      return b.score - a.score;
    });

    let groupTokens = 0;
    for (const node of sorted) {
      const targetLevel = node.distance === 0 ? 0 : node.score > sorted[0].score * 0.5 ? 1 : 2;
      const rendered = renderSymbol(node.symbol, node.file, targetLevel as CompressionLevel);
      const tokens = countTokens(rendered);
      if (groupTokens + tokens > groupBudget) continue;
      packed.push({ ...node, compressionLevel: targetLevel as CompressionLevel, rendered, tokenCount: tokens });
      groupTokens += tokens;
      tokensUsed += tokens;
    }
  }

  // Fill remaining with L3 references from other groups
  // ... standard greedy fill ...

  return { packed, observationBudget: tokenBudget - codeBudget, tokensUsed, fileSummaries: [] };
}
```

**Acceptance:**
- Story-mode packing produces capsules where each packed file has 3+ symbols (not scattered 1-per-file)
- Broad query confidence increases by 10-15% vs current scattered packing
- Narrow queries still use standard packing (no regression)

---

### Task 2.4: Adaptive Confidence Formula

**Files:**
- Modify: `src/capsule/generator.ts` (update `computeCoverageConfidence`)

**What this does:** The current confidence formula penalizes broad queries because they naturally have more pivots (pivotCoverage is low when 25/88 pivots are packed). The formula should account for query intent — broad queries with good module coverage should score higher even with lower raw pivot coverage.

**New formula by intent:**

For **narrow** queries (unchanged):
```
confidence = relevantCoverage * 0.5 + dependencyCoverage * 0.2 + (1 - noiseRatio) * 0.15 + summaryBoost + 0.15
```

For **broad** queries:
```
moduleCoverage = uniqueClustersInPacked / relevantClusters
confidence = moduleCoverage * 0.35 + relevantCoverage * 0.25 + (1 - noiseRatio) * 0.15 + summaryBoost + 0.25
```

For **task** queries:
```
storyCompleteness = avgSymbolsPerPackedFile / maxSymbolsPerFile  (capped at 1.0)
confidence = storyCompleteness * 0.30 + moduleCoverage * 0.25 + relevantCoverage * 0.20 + (1 - noiseRatio) * 0.10 + 0.15
```

Key insight: for broad/task queries, **module coverage** (did we touch all relevant code areas?) matters more than **pivot coverage** (did we pack every matching symbol?). And **story completeness** (did we provide full context for each area?) matters for task queries where Claude needs to actually make changes.

**Implementation:**
- `computeCoverageConfidence` gets a new parameter: `intent: QueryIntent` and `moduleCoverageStats: { packedClusters: number; relevantClusters: number; avgSymbolsPerFile: number }`
- Generator computes these stats from the packed result and cluster data
- Formula branches on intent

**Acceptance:**
- Broad queries confidence increases from ~42% to ~60%+ with the new formula
- Narrow queries are unchanged (same scores as before)
- All existing tests still pass (update threshold values where needed)

---

### Task 2.5: Phase 2 Ratchet Update

**Files:**
- Modify: `tests/integration/task-query-quality.test.ts` (raise thresholds)
- Run: `tests/integration/update-baseline.ts` (snapshot new baseline)

**What this does:** After Phase 2 improvements, raise the quality thresholds:
- Broad queries: 55% → 65%
- Task queries: 50% → 60%
- Overall average: 60% → 65%

Also update the baseline JSON so the ratchet test prevents regression.

**Acceptance:** All tests pass at new thresholds.

---

## PHASE 3: Multi-Pass Capsule Strategy (Tasks 3.1-3.5)

**Problem:** Even with intent-aware routing, a single-pass capsule can't capture a broad task like "find bugs in the capsule pipeline" in one shot. The pipeline generates 1 capsule that tries to cover everything. Claude needs to understand the pipeline end-to-end, which spans 6+ files, to find bugs. One 4000-token capsule can only show fragments.

**Solution:** For broad/task queries, automatically decompose into 2-4 focused sub-queries, generate a mini-capsule for each, then merge into a single coherent result. This simulates what the Explore agent does (sequential focused reads) but within a single `cw_capsule` call.

---

### Task 3.1: Smart Query Decomposer

**Files:**
- Modify: `src/capsule/query-decomposer.ts` (add intent-aware decomposition)
- Test: `tests/capsule/smart-decomposer.test.ts`

**What this does:** The existing `decomposeQuery` splits on term count. The new version uses intent classification and the file-level index to produce semantically meaningful sub-queries.

**Implementation:**

```typescript
export interface SubQuery {
  terms: string[];
  targetClusterIds: number[];   // which clusters to focus on
  budgetFraction: number;       // fraction of total budget for this sub-query
  priority: number;             // 1 = highest priority
}

export function decomposeForBroad(
  query: string,
  classified: ClassifiedQuery,
  db: Database.Database,
): SubQuery[] {
  // 1. Search file summaries for the focus terms
  // 2. Group matching files by cluster
  // 3. Each cluster becomes a sub-query:
  //    - terms = focus terms + cluster's dominant export names
  //    - budgetFraction = proportional to cluster's relevance score
  //    - priority = by cluster relevance
  // 4. Cap at 4 sub-queries (token budget is finite)
}

export function decomposeForTask(
  query: string,
  classified: ClassifiedQuery,
  db: Database.Database,
): SubQuery[] {
  // 1. Extract action verb → code pattern mapping:
  //    "find bugs" → look for error handling, edge cases, missing validation
  //    "implement feature" → look for similar features, extension points, types
  //    "optimize" → look for hot paths, O(n) operations, database queries
  // 2. For each pattern, search file summaries to find relevant clusters
  // 3. Create sub-queries: one per relevant pattern-cluster pair
  // 4. Priority: verb-matched clusters first
}
```

**Acceptance:**
- "find bugs in the capsule pipeline" decomposes into: ["capsule generator scoring", "capsule packer compression", "capsule formatter output"]
- "implement a new MCP tool" decomposes into: ["MCP tool registration server", "existing tool implementations", "input schema validation"]
- Sub-queries have correct cluster IDs and proportional budgets

---

### Task 3.2: Multi-Pass Generator

**Files:**
- Modify: `src/capsule/generator.ts` (add multi-pass mode for broad/task queries)

**What this does:** For broad/task intents, instead of one monolithic pipeline pass, run 2-4 focused sub-passes and merge results.

**Implementation flow:**

```
1. classifyQueryIntent(query)
2. if intent === "narrow": run current single-pass pipeline (unchanged)
3. if intent === "broad" or "task":
   a. subQueries = decomposeForBroad/Task(query, classified, db)
   b. for each subQuery:
      - Run a mini-capsule with budget = tokenBudget * subQuery.budgetFraction
      - Collect packed symbols and their scores
   c. Merge: deduplicate symbols across sub-capsules (keep highest score)
   d. Re-pack merged result with story-complete packing
   e. Compute module-aware confidence from merged result
```

**Key constraints:**
- Total budget across sub-passes must not exceed `tokenBudget`
- Each sub-pass is fast (~1-3ms) because it's focused on a small cluster
- The merge step deduplicates and re-ranks, ensuring no symbol appears twice
- If sub-query decomposition fails (e.g., no clusters found), fall back to single-pass

**Implementation approach:**
- Extract the core single-pass pipeline into a private function `generateSinglePass(db, params, candidateFileIds?)` that takes optional pre-filtered file IDs
- The main `generateCapsule` becomes an orchestrator:
  - Narrow: call `generateSinglePass` directly
  - Broad/Task: decompose → run N `generateSinglePass` calls with restricted file IDs → merge → re-pack
- Each sub-pass reuses the same DB connection (no overhead)
- Session context records all sub-pass symbols (dedup still works across sub-passes)

**Acceptance:**
- Narrow queries: identical behavior and scores (no regression)
- Broad queries: multi-pass produces higher confidence than single-pass
- Task queries: multi-pass captures 3+ distinct code areas vs. single-pass scattered approach
- Query time stays under 50ms for 1K-symbol projects

---

### Task 3.3: Result Merger

**Files:**
- Create: `src/capsule/merger.ts`
- Test: `tests/capsule/merger.test.ts`

**What this does:** Takes packed results from multiple sub-capsules and produces a single coherent capsule output.

**Implementation:**

```typescript
export interface SubCapsuleResult {
  packed: ScoredNode[];
  fileSummaries: string[];
  pivotSymbolIds: Set<number>;
  clusterIds: Set<number>;
}

export function mergeSubCapsules(
  results: SubCapsuleResult[],
  tokenBudget: number,
  codeRatio: number,
): PackResult {
  // 1. Collect all symbols from all sub-capsules
  // 2. Deduplicate: if a symbol appears in multiple sub-capsules, keep the one
  //    with the lowest compression level (most detail)
  // 3. Group by cluster/file for story-complete ordering
  // 4. Re-pack within total token budget:
  //    - Priority 1: pivots from highest-priority sub-query
  //    - Priority 2: L0/L1 symbols from other sub-queries (they were important enough to pack at high detail)
  //    - Priority 3: L2/L3 symbols
  //    - Priority 4: file summaries for unpacked clusters
  // 5. Return merged PackResult
}
```

**Acceptance:**
- Merging 3 sub-capsules with 10 symbols each produces ~20-25 unique symbols (some overlap expected)
- No symbol appears twice in merged output
- Merged result respects token budget
- Story completeness is maintained (each cluster has 3+ symbols)

---

### Task 3.4: Formatter Enhancement for Multi-Pass

**Files:**
- Modify: `src/capsule/formatter.ts`

**What this does:** When a capsule was generated via multi-pass, the header shows:
```
--- ContextWeave Capsule ---
Query: find bugs in the capsule pipeline
Mode: review | Strategy: multi-pass (3 sub-queries)
```

And code sections are grouped by sub-query/cluster with clear headers:
```
// === [Cluster: capsule/generator] ===
// === src/capsule/generator.ts ===
...

// === [Cluster: capsule/packer] ===
// === src/capsule/packer.ts ===
...
```

This helps Claude understand the capsule's structure and navigate between code areas.

**Acceptance:** Multi-pass capsules have cluster group headers. Single-pass capsules are unchanged.

---

### Task 3.5: Phase 3 Ratchet Update + Threshold Raise

**Files:**
- Modify: `tests/integration/task-query-quality.test.ts` (raise thresholds)
- Run: `tests/integration/update-baseline.ts`

**After Phase 3, target thresholds:**
- Narrow: 70% (unchanged — already passing)
- Broad: 65% → 75%
- Task: 60% → 70%
- Overall: 65% → 72%

**Acceptance:** All tests pass at new thresholds. Baseline updated.

---

## PHASE 4: Concurrent Agent Support (Tasks 4.1-4.5)

**Problem:** When Claude uses agent teams (6-15 agents), each agent calls `cw_capsule` simultaneously. The current architecture has a single MCP server process with one DB connection and a server session lock (`mcp-server.lock`) that prevents multiple server instances. SQLite WAL mode allows concurrent reads but only one writer at a time. With 15 agents all querying at once, we need to ensure:
1. No `SQLITE_BUSY` errors under concurrent reads
2. Write operations (session_context recording, capsule_log inserts, observation captures) don't block reads
3. The MCP server can handle rapid sequential tool calls without queueing

**Current state analysis:**
- `connection.ts:24`: WAL mode is already enabled
- `connection.ts:28`: `busy_timeout = 5000` — will wait 5s on lock contention (good)
- `server.ts:20`: Single `serverDb` variable — all tool calls share one connection (good for reads, serializes writes)
- `session-lock.ts`: Exclusive lock prevents multiple MCP servers on same project (by design — MCP stdio is 1:1 with Claude process)
- The capsule generation path is **read-heavy**: the only writes are `session_context.record()`, `capsule_log.insert()`, and `captureQueryObservation()` — all at the END after the capsule is already generated

**Key insight:** When Claude spins up 6-15 agents, each agent has its own Claude Code process, each starts its own MCP server instance. But the session lock prevents this. We need a different architecture:
- Option A: Remove the session lock, let multiple MCP servers share the same DB via WAL (reads are concurrent, writes serialize via busy_timeout)
- Option B: Single MCP server that accepts connections from multiple Claude processes (not possible with stdio transport)
- Option C: Read-only mode for secondary instances — they can generate capsules but don't write session context

**Recommended: Option A with guard rails.** WAL mode is designed for exactly this. Multiple processes can read concurrently. Writes serialize but are fast (INSERT into session_context/capsule_log is <1ms). The 5000ms busy_timeout handles any contention.

---

### Task 4.1: Non-Blocking Session Lock

**Files:**
- Modify: `src/mcp/session-lock.ts`
- Test: `tests/mcp/concurrent-lock.test.ts`

**What this does:** Replace the exclusive lock with an advisory lock that allows multiple readers. The first server instance becomes the "primary" (reads + writes). Subsequent instances on the same project become "secondary" (reads + limited writes).

**Implementation:**

```typescript
export type LockMode = "primary" | "secondary";

export interface ServerSessionLock {
  fd: number;
  lockPath: string;
  mode: LockMode;
}

export function acquireServerSessionLock(projectRoot: string): ServerSessionLock {
  const lockPath = resolve(projectRoot, ".contextweave", "mcp-server.lock");

  try {
    // Try exclusive lock first (primary)
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid, mode: "primary", createdAt: Date.now() }));
    return { fd, lockPath, mode: "primary" };
  } catch {
    // Lock exists — check if holder is alive
    const existingPid = readLockPid(lockPath);
    if (existingPid !== null && !isProcessAlive(existingPid)) {
      // Stale lock — take over as primary
      unlinkSync(lockPath);
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, mode: "primary", createdAt: Date.now() }));
      return { fd, lockPath, mode: "primary" };
    }

    // Another server is alive — start as secondary
    return { fd: -1, lockPath, mode: "secondary" };
  }
}
```

**Acceptance:** Primary instance gets exclusive lock. Secondary instances start without error. Both can open the DB (WAL mode handles concurrent access). Test verifies two instances can coexist.

---

### Task 4.2: Concurrent-Safe Capsule Generation

**Files:**
- Modify: `src/capsule/generator.ts` (wrap write operations in try-catch with retry)
- Modify: `src/capsule/session-context.ts` (add busy retry for writes)

**What this does:** The capsule read path (FTS search, BFS traversal, scoring, packing) is already read-only and WAL-safe. The writes at the end (session_context, capsule_log, observations) need to handle `SQLITE_BUSY` gracefully.

**Implementation:**

```typescript
function safeWrite(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes("SQLITE_BUSY")) {
      logger.debug("write skipped due to db contention — non-critical");
      return;  // session_context and capsule_log writes are non-critical
    }
    throw err;
  }
}

// In generateCapsule, wrap the write operations:
safeWrite(() => captureQueryObservation(db, query, pivotSymbolIds, sessionId, params.projectRoot ?? ""));
safeWrite(() => sessionCtx.record(symbolsToRecord, query));
safeWrite(() => capsuleLogQueries(db).insert({ ... }));
```

The key insight: these writes are telemetry/session data. If they fail due to contention, the capsule result is still valid. We should never let a write failure block capsule delivery.

**Acceptance:**
- Capsule generation never throws SQLITE_BUSY
- Capsule results are identical whether writes succeed or are skipped
- Test: spawn 5 concurrent capsule generations, all succeed without error

---

### Task 4.3: Concurrent Agent Stress Test

**Files:**
- Create: `tests/integration/concurrent-agents.test.ts`
- Create: `bench/concurrent-stress.ts`

**What this does:** Simulates 6-15 agents calling `cw_capsule` simultaneously to verify no errors, no corruption, and acceptable latency.

**Implementation:**

```typescript
// tests/integration/concurrent-agents.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

describe("concurrent capsule generation", () => {
  it("handles 10 simultaneous capsule calls without error", async () => {
    // Use worker_threads to simulate concurrent calls
    // Each worker: open DB (same file), call generateCapsule, return result
    // Main thread: verify all 10 succeed, all return valid capsules
  });

  it("maintains consistency under concurrent read+write", async () => {
    // Worker 1: generate capsules in a loop (reads + session writes)
    // Worker 2: reindex a file (heavy writes)
    // Verify: no corruption, no SQLITE_BUSY errors
  });
});
```

```typescript
// bench/concurrent-stress.ts
// Spawn N worker threads, each generating capsules in a loop
// Measure: p50/p95/p99 latency, error rate, throughput
// Targets: p95 < 50ms, 0% error rate, 10+ capsules/second
```

**Acceptance:**
- 10 concurrent capsule generations: 0 errors, all valid results
- p95 latency < 50ms for 1K-symbol project under 10x concurrency
- 0 SQLITE_BUSY errors propagated to users
- bench/concurrent-stress.ts produces a latency report

---

### Task 4.4: Connection Pool (if needed)

**Files:**
- Modify: `src/db/connection.ts` (optional: add read-only connection pool)

**What this does:** If Task 4.3 stress testing reveals that a single DB connection creates a bottleneck under high concurrency, add a simple read-only connection pool.

**Implementation (only if needed):**

```typescript
const READ_POOL_SIZE = 4;
const readPool: Database.Database[] = [];

export function getReadOnlyDb(dbPath: string): Database.Database {
  // Round-robin from read pool
  // Read connections: WAL mode, no writes, query_only=1
  // Write connection: remains the single primary
}
```

**Decision gate:** Run Task 4.3 first. If p95 < 50ms with a single connection, skip the pool. SQLite WAL with `busy_timeout=5000` should handle 10-15 concurrent readers on a single connection without issues. Only add complexity if the data demands it.

**Acceptance:** If implemented: pool distributes reads, write path unchanged. If skipped: document why in a comment.

---

### Task 4.5: Phase 4 Final Validation

**Files:**
- Modify: `tests/integration/task-query-quality.test.ts` (final threshold raise)
- Run: `tests/integration/update-baseline.ts`
- Run: full test suite

**Final target thresholds after all 4 phases:**
- Narrow: 75%
- Broad: 75%
- Task: 70%
- Overall: 73%
- Concurrent: 10 agents, 0 errors, p95 < 50ms

**Acceptance:**
- All tests pass (expected 240+ tests)
- All ratchet thresholds met
- bench/concurrent-stress.ts passes all targets
- Cross-project QA (bench/cross-project-qa.ts) still passes with broad/task queries added

---

## Implementation Order and Dependencies

```
Phase 1 (foundation):
  1.1 → 1.2 → 1.3 → 1.4
  (Self-improving test harness must be in place first)

Phase 2 (intent routing):
  2.1 → 2.2 → 2.3 → 2.4 → 2.5
  (depends on Phase 1 for measurement)

Phase 3 (multi-pass):
  3.1 → 3.2 → 3.3 → 3.4 → 3.5
  (depends on Phase 2 for intent classification)

Phase 4 (concurrency):
  4.1 → 4.2 → 4.3 → 4.4 (conditional) → 4.5
  (independent of Phases 2-3, can run in parallel after Phase 1)
```

**Parallelization opportunity:** Phase 4 (concurrency) is independent of Phases 2-3 (query intelligence). After Phase 1 establishes the test harness, Phases 2+3 and Phase 4 can be worked on in parallel by separate agents.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Multi-pass adds latency | Each sub-pass is scoped to a small cluster (~50 symbols). Budget: 3-4 sub-passes at 5-15ms each = 20-60ms total vs. current 7-30ms single-pass. Acceptable. |
| Intent classification is wrong | Fall back to single-pass on misclassification. Narrow queries always use single-pass (no regression risk). |
| Story packing produces worse results for some queries | Ratchet test catches regressions. If specific queries degrade, add them to the test suite and fix. |
| SQLite contention under 15 agents | WAL mode + busy_timeout handles this. Writes are non-critical telemetry. If all writes fail, capsule quality is unchanged. |
| DB corruption under concurrent access | SQLite WAL is ACID-compliant. WAL mode is specifically designed for concurrent readers + single writer. busy_timeout prevents SQLITE_BUSY. Test with stress harness. |

---

## Success Criteria

After all 4 phases are complete:

1. **Broad queries score 75%+ confidence** (up from 37-52%)
2. **Task queries score 70%+ confidence** (up from unmeasured/low)
3. **No regression on narrow queries** (stays at 81%+)
4. **10-15 concurrent agents** can call `cw_capsule` simultaneously with 0 errors
5. **Self-improving test** catches any quality regression automatically
6. **Claude uses ContextWeave instead of Grep/Explorer** for 90%+ of orientation tasks

The ratchet test ensures scores can only go UP after each improvement. The diagnostic reporter tells you exactly WHAT to fix when scores are low. The multi-pass strategy gives Claude complete stories instead of fragments. The concurrent support enables agent teams to use ContextWeave at full scale.
