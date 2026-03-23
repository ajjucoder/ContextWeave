# ContextWeave Capsule Generation System - Deep Review

**Date:** 2026-03-21  
**Scope:** Core retrieval engine (generator.ts, packer.ts, formatter.ts, confidence.ts, intent-classifier.ts, query-decomposer.ts, pivot-scorer.ts)  
**Lines of Code Analyzed:** ~2,800 (generator.ts) + ~800 supporting files

---

## Executive Summary

The ContextWeave Capsule Generation system is a sophisticated multi-stage retrieval engine that transforms natural language queries into token-budgeted context capsules. It employs a hybrid approach combining symbolic analysis, graph traversal, semantic search, and intelligent compression to deliver relevant code context to LLMs.

**Overall Grade:** A- (Well-architected with sophisticated retrieval logic, but has complexity management challenges)

---

## 1. Architecture: Retrieval Pipeline Stages

### 1.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CAPSULE GENERATION PIPELINE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Phase 0: Query Classification                                           │
│  ├── Tokenize & normalize query                                          │
│  ├── Detect intent: symbol-lookup | narrow | broad | task | debug        │
│  └── Extract focus terms, action verbs, implied modules                  │
│                                                                          │
│  Phase 1: Pivot Discovery (Stage A)                                      │
│  ├── File search via hybrid/lexical retrieval                            │
│  ├── Symbol lookup: exact match → FTS → path search                      │
│  ├── Graph expansion from hybrid results                                 │
│  ├── Memory bridge (observation-based seeding)                           │
│  └── Framework entry detection (Next.js routes, etc.)                    │
│                                                                          │
│  Phase 2: Pivot Ranking                                                  │
│  ├── Multi-factor scoring: lexical + path + signature + kind           │
│  ├── IDF-weighted term relevance                                         │
│  ├── Path-based boosts (route files, server files)                     │
│  └── Kind preference (runtime vs type declarations)                    │
│                                                                          │
│  Phase 3: BFS Traversal                                                  │
│  ├── Weighted BFS from pivot symbols                                     │
│  ├── Scope-constrained by pivot directories                              │
│  └── Lazy evaluation for memory efficiency                             │
│                                                                          │
│  Phase 4: Candidate Scoring (Stage B)                                    │
│  ├── Multi-dimensional scoring:                                          │
│  │   ├── Distance factor (hops from pivot)                               │
│  │   ├── Centrality signal (PageRank)                                    │
│  │   ├── Recency (last seen)                                             │
│  │   ├── Memory signals (observations)                                   │
│  │   ├── Locality boost (same file/dir)                                │
│  │   ├── Hub penalty (high centrality dampening)                         │
│  │   └── Common name dampening                                           │
│  ├── Lexical scoring with query term overlap                             │
│  └── Filter by relevance thresholds                                      │
│                                                                          │
│  Phase 5: Selection & Pruning                                            │
│  ├── Select by lexical threshold + distance                              │
│  ├── File diversity pruning (max per file)                             │
│  ├── UI noise pruning (non-action UI components)                         │
│  └── Broad file spread enforcement                                       │
│                                                                          │
│  Phase 6: Token Budgeting & Packing                                      │
│  ├── Compression levels: L0(full) → L1(skeleton) → L2(summary) → L3(ref) │
│  ├── Story-mode packing (cluster-aware for broad/task)                   │
│  ├── Multi-pass merging (for decomposed queries)                         │
│  ├── Promotion pass (L3→L0 when budget allows)                           │
│  └── Dedup & line-range containment                                      │
│                                                                          │
│  Phase 7: Quality Assessment & Formatting                                │
│  ├── Coverage confidence calculation                                     │
│  ├── Uncertainty level assignment                                        │
│  ├── Diagnostic analysis                                                 │
│  └── Structured output generation                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Architectural Strengths

**1. Intent-Aware Routing (Lines 76-82 in generator.ts)**
```typescript
const classified = classifyQueryIntent(query);
const intent = classified.intent;
// For pipeline routing, symbol-lookup and debug behave like narrow (focused retrieval)
const retrievalBudget = Math.max(
  tokenBudget,
  Math.round(tokenBudget * classified.suggestedBudgetMultiplier)
);
```
Different query intents get different budget multipliers:
- `symbol-lookup`: 0.75x (focused)
- `narrow`: 1.0x (standard)
- `debug`: 1.25x (more context needed)
- `broad`: 1.5x (exploratory)
- `task`: 2.0x (implementation requires full context)

**2. Multi-Pass Architecture for Broad/Task Queries**
```typescript
const subQueries =
  intent === "broad"
    ? decomposeForBroad(query, classified, clusterHints)
    : intent === "task"
      ? decomposeForTask(query, classified, clusterHints)
      : [];
const useMultiPass = intent !== "narrow" && subQueries.length > 1;
```

Decomposes queries into sub-queries with budget fractions, then merges results intelligently.

**3. Lazy BFS Traversal (Lines 770-780)**
```typescript
const skipBfs = isOverBudget(0.5);
const baseDepth = getDepthForBudget(retrievalBudget);
const maxDepth = /* intent-specific depth calculation */;
const effectiveBfsDepth = skipBfs ? 1 : maxDepth;
```
Adaptive depth based on time budget to prevent timeout cascades.

---

## 2. Intent Handling System

### 2.1 Intent Classification (intent-classifier.ts)

**Five Intent Categories:**

| Intent | Trigger | Behavior |
|--------|---------|----------|
| `symbol-lookup` | Single identifier match | Exact symbol retrieval, minimal BFS |
| `narrow` | 2-4 terms, no action verbs | Focused retrieval, strict lexical matching |
| `broad` | "architecture", "explain", "flow", "system" | Multi-pass, cluster-aware, higher diversity |
| `task` | Action verbs (implement, fix, refactor) | Maximum budget, story-mode packing, test focus |
| `debug` | Error/bug signals | Error-context aware, recency-weighted |

**Classification Logic (Lines 75-113):**
```typescript
function classifyIntent(
  actionVerbs: string[],
  normalizedTerms: string[],
  hasQuestionWord: boolean,
  rawQuery: string
): QueryIntent {
  const trimmed = rawQuery.trim();
  if (IDENTIFIER_RE.test(trimmed)) return "symbol-lookup";
  if (normalizedTerms.some((t) => DEBUG_SIGNALS.has(t))) return "debug";
  if (actionVerbs.length > 0) return "task";
  
  const hasBroadSignal = /* check BROAD_SIGNALS set */;
  if (hasBroadSignal) return "broad";
  
  if (hasQuestionWord) {
    return normalizedTerms.length >= 5 ? "broad" : "narrow";
  }
  
  if (normalizedTerms.length <= 2) return "narrow";
  if (normalizedTerms.length >= 5) return "broad";
  return "narrow";
}
```

### 2.2 Query Decomposition (query-decomposer.ts)

**Smart Bundle System:** Task queries get context-aware sub-queries:

```typescript
const TASK_PATTERN_BUNDLES: Record<string, string[][]> = {
  implement: [
    ["registration", "server", "tool"],
    ["schema", "validation", "types"],
    ["integration", "handler", "tests"]
  ],
  optimize: [
    ["performance", "queries", "hotpaths"],
    ["cache", "latency", "loops"],
    ["index", "batch", "throughput"]
  ],
  // ... more verbs
};
```

Example: "implement user authentication" decomposes into:
1. Sub-query 1: `user authentication registration server tool`
2. Sub-query 2: `user authentication schema validation types`
3. Sub-query 3: `user authentication integration handler tests`

### 2.3 Domain Bundle Mapping

```typescript
const DOMAIN_BUNDLES: Record<string, string[][]> = {
  auth: [["login", "session", "token"], ["password", "credential", "hash"], ["middleware", "guard", "permission"]],
  api: [["route", "handler", "controller"], ["endpoint", "middleware", "request"], ["response", "schema", "validation"]],
  // ... more domains
};
```

**Observation:** The decomposition system is sophisticated but the bundle coverage is limited. New domains require manual bundle definition.

---

## 3. Token Budgeting & Compression

### 3.1 Compression Levels (compressor.ts)

| Level | Name | Content | Typical Tokens |
|-------|------|---------|----------------|
| L0 | Full | Complete source with header | 50-600 (capped) |
| L1 | Skeleton | Export prefix + signature + docComment | 10-50 |
| L2 | Summary | Kind + name + signature + deps (max 5) | 5-20 |
| L3 | Reference | Kind + name + location only | 2-5 |

**L0 Truncation Strategy (Lines 27-51):**
```typescript
if (level === 0) {
  const cap = maxL0Tokens ?? 600;
  if (countTokens(full) <= cap) return full;
  
  // Smart truncation: keep signature + head lines + tail lines
  const sigLine = lines[0] ?? "";
  const tailLines = lines.slice(-3);
  const headLines: string[] = [sigLine];
  
  // Fill until 70% of cap
  for (let i = 1; i < lines.length - 3; i++) {
    if (tokens + nextTokens > cap * 0.7) break;
    headLines.push(lines[i]!);
  }
}
```

### 3.2 Packer Strategies

**Standard Packing (packer.ts: Lines 48-175):**
- Primary candidate reservation (40% budget for top pivot)
- Iterative packing by score, trying L0→L3
- Promotion pass: upgrade L3→L2→L1→L0 when budget allows
- Adjacent node backfill for remaining budget

**Story-Mode Packing (Lines 197-354):**
- Groups symbols by cluster/file
- Computes group priority: `topScore + pivotBonus*2 + bridgeBonus*0.9 - avgDistance*0.35`
- Fair-share budget allocation per group
- Relevance-based promotion regardless of distance

**Multi-Pass Merging (merger.ts):**
```typescript
export function mergeSubCapsules(
  subResults: SubCapsuleResult[],
  tokenBudget: number,
  codeRatio: number,
  clusterBySymbolId: ReadonlyMap<number, number>
): MergedCapsuleResult
```

Merges sub-capsules while:
- Preserving cluster diversity
- Preventing symbol duplication
- Rebalancing token budgets across clusters

### 3.3 Budget Utilization Targets

| Intent | Min Utilization | Target Utilization |
|--------|-----------------|-------------------|
| narrow | 45% | 60% |
| broad/task | 85% | 85% |

**Auto-Promotion Strategy (generator.ts: Lines 1952-1980):**
When utilization is below target, the system:
1. Promotes existing nodes to better compression
2. Adds same-file/same-directory candidates
3. Runs refill passes with relaxed thresholds
4. Falls back to dense packing (higher L3 cap)

---

## 4. Confidence Calibration

### 4.1 Coverage Confidence Formula (confidence.ts: Lines 63-151)

**Base Formula (narrow intent):**
```
confidence = relevantCoverage*0.5 + dependencyCoverage*0.2 + (1-noiseRatio)*0.15 + summaryBoost + 0.05
```

**Broad Intent Formula:**
```
confidence = moduleCoverage*0.35 + relevantCoverage*0.25 + (1-noiseRatio)*0.15 + summaryBoost + 0.10
structuralHealth = moduleCoverage*0.45 + relevantCoverage*0.35 + (1-noiseRatio)*0.2
breadthFactor = retrievalSurfaceScore >= 0.75 ? max(lexicalSurface, structuralHealth*0.52) : lexicalSurface
confidence = confidence * (0.35 + 0.65 * breadthFactor)
```

**Task Intent Formula:**
```
confidence = storyCompleteness*0.3 + moduleCoverage*0.25 + relevantCoverage*0.2 + (1-noiseRatio)*0.1 + 0.15
```

### 4.2 Confidence Caps by Token Utilization

| Utilization | Max Confidence |
|-------------|----------------|
| < 15% | 25% |
| < 25% | 35% |
| < 35% | 45% |
| < 50% | 55% |
| < 60% | 65% |
| < 70% | 72% |

### 4.3 Uncertainty Levels

```typescript
type CapsuleUncertainty = "very_low" | "low" | "medium" | "high" | "critical";

function buildUncertainty(
  lowConfidence: boolean,
  reasonCount: number,
  coverageConfidence: number,
  tokenUtilization?: number
): CapsuleUncertainty {
  if (!lowConfidence && coverageConfidence >= 0.7) return "very_low";
  if (!lowConfidence) return "low";
  if (reasonCount >= 4 || coverageConfidence < 0.2) return "critical";
  if (reasonCount >= 3 || coverageConfidence < 0.35) return "high";
  // ... more conditions
}
```

### 4.4 Quality Flags Generated

- `symbolNotFound`: No exact symbol match
- `pivotCoverage < 50%`: Missing too many pivots
- `dependencyCoverage < 25%`: Dependencies not packed
- `noiseRatio > 60%`: Too many low-relevance symbols
- `queryTermCoverage < 60%`: Weak lexical overlap

---

## 5. Edge Cases & Error Handling

### 5.1 Empty/Thin Retrieval Scenarios

**Raw Pivot Count < 3 (Lines 448-493):**
```typescript
if (rawPivotIds.size < 3 && !hybridSearchEnabled) {
  const preFallbackCandidates = buildPivotCandidates(rawPivotIds);
  const preFallbackRanking = rankPivotsWithScores(/* ... */);
  
  // Try exact match fast path: expand related symbols
  if (exactPivot) {
    const relatedRows = [
      ...(getDirectCallerIds.all(exactPivot.id) as Array<{ symbolId: number }>),
      ...(getDirectCalleeIds.all(exactPivot.id) as Array<{ symbolId: number }>),
    ];
    // Add related symbols
  } else {
    // Content fallback: search full_source
    const contentMatches = contentFallbackSearch(db, expandedQueryTerms);
  }
}
```

**Memory Bridge Fallback (Lines 495-510):**
```typescript
if (rawPivotIds.size < 3 && memoryCandidateSymbolIds.size > 0) {
  // Seed from observation-linked symbols
  for (const symbolId of memoryCandidateSymbolIds) {
    rawPivotIds.add(symbolId);
  }
}
```

### 5.2 Very Low Confidence Scenarios

**Symbol Not Found (Lines 2596-2600):**
```typescript
if (symbolNotFound) {
  const note = `Note: No symbol named '${query}' found in the index. Showing related symbols.\n`;
  content = note + content;
}
```

**Same Name Collision (Lines 2601-2608):**
```typescript
if (hasSameNameCollision) {
  const note = `Note: Found ${sameNameDefinitions.length} definitions of '${query}'. 
    Showing top-ranked from ${topDef.filePath}. Alternatives: ${altPaths}\n`;
}
```

**Budget Underutilization (formatter.ts: Lines 189-194):**
```typescript
const utilization = metadata.tokenBudget > 0 ? metadata.tokensUsed / metadata.tokenBudget : 1;
if (utilization < 0.30 && metadata.tokenBudget >= 2000) {
  parts.push(`Budget underutilized: ${metadata.tokensUsed}/${metadata.tokenBudget} tokens used (${Math.round(utilization * 100)}%). 
    Retrieval found limited relevant symbols. Consider narrowing your query or using cw_grep for broader text coverage.`);
}
```

### 5.3 Timeout Protection

```typescript
const isOverBudget = (fraction: number) => elapsed() > maxQueryTimeMs * fraction;
const skipBfs = isOverBudget(0.5);
const skipPromotion = isOverBudget(0.8);
```

**Time-Limited Flag (Line 2539):**
```typescript
const timeLimited = skipBfs || skipPromotion || elapsed() > maxQueryTimeMs;
// Passed to metadata for downstream awareness
```

### 5.4 Database Lock Contention

**Safe Write Wrapper (Lines 2623-2633):**
```typescript
const safeWrite = (label: string, fn: () => void): void => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && /SQLITE_BUSY/i.test(error.message)) {
      logger.debug("non-critical write skipped due to lock contention", { label });
      return;
    }
    throw error;
  }
};
```

---

## 6. Framework Boundary Tracing

### 6.1 HTTP Entry Point Detection

**Framework Entry Patterns (pivot-scorer.ts: Lines 10-15):**
```typescript
const FRAMEWORK_ENTRY_RE = /(^|\/)app\/.+\/route\.[cm]?[jt]sx?$/i;
const ROUTE_PATH_RE = /(^|\/)(api|routes?)(\/|$)/i;
const SERVER_PATH_RE = /(^|\/)(server|services?|controllers?|auth|db|data|repositories?|stores?|models?)(\/|$)/i;
```

**Path-Based Scoring Boosts (Lines 135-152):**
```typescript
if (FRAMEWORK_ENTRY_RE.test(pathLower)) {
  score += 3.5;  // Highest priority
} else if (ROUTE_PATH_RE.test(pathLower)) {
  score += 2.4;
} else if (SERVER_PATH_RE.test(pathLower)) {
  score += 1.8;
} else if (CLIENT_PATH_RE.test(pathLower)) {
  score += 1.2;
} else if (PAGE_PATH_RE.test(pathLower)) {
  score += 1.4;
}
```

### 6.2 Next.js-Specific Detection

**Framework Query Hints (generator.ts: Lines 147-152):**
```typescript
const FRAMEWORK_QUERY_HINT_TERMS = new Set([
  "next", "nextjs", "middleware", "route", "routes", 
  "handler", "page", "layout"
]);

// Activates hint-based file discovery
if (intent !== "narrow" && rawPivotIds.size < maxStageARaw &&
    allQueryTerms.some((term) => FRAMEWORK_QUERY_HINT_TERMS.has(term))) {
  // Search for middleware, route, page, layout files
}
```

### 6.3 UI Component Filtering

**UI Path Detection (signals.ts: Lines 22-23):**
```typescript
export const UI_COMPONENT_PATH_RE = /(^|[/\\])(ui|components?|views?|pages?|templates?|marketing)([/\\]|$)/i;
export const PAGE_ENTRY_PATH_RE = /(^|[/\\])(page|layout)\.[cm]?[jt]sx?$/i;
```

**UI Noise Pruning (generator.ts: Lines 1846-1888):**
- Non-UI queries filter out UI-like paths
- Exception: UI components with action signals (handle, submit, etc.) are preserved
- Applies to broad, task, and debug intents

---

## 7. Code Quality Assessment

### 7.1 Complexity Metrics

| File | Lines | Functions | Max Nesting | Cognitive Complexity |
|------|-------|-----------|-------------|---------------------|
| generator.ts | ~2,800 | ~45 | 6+ | Very High |
| packer.ts | ~520 | 4 | 4 | High |
| formatter.ts | ~480 | 6 | 3 | Medium |
| confidence.ts | ~280 | 5 | 4 | Medium |
| intent-classifier.ts | ~140 | 6 | 2 | Low |
| query-decomposer.ts | ~220 | 8 | 2 | Low |
| pivot-scorer.ts | ~280 | 5 | 3 | Medium |

### 7.2 Maintainability Issues

**Issue 1: generator.ts Excessive Length**
- 2,800 lines in a single file
- 45+ functions, many anonymous
- Multiple nested loops with complex conditions

**Recommendation:** Split into:
- `generator-pivot-discovery.ts`
- `generator-ranking.ts`
- `generator-selection.ts`
- `generator-packing-controller.ts`

**Issue 2: Deep Nesting in Selection Logic**
```typescript
// Example from lines 1775-1815 (6 levels of nesting)
if (intent === "broad" || intent === "task") {
  if (selected.length > 0 && selected.length < baseCandidateLimit) {
    const coveredLayers = new Set<string>();
    for (const c of selected) {
      for (const lp of LAYER_PATTERNS) {
        if (lp.re.test(c.file.path)) {
          coveredLayers.add(lp.name);
        }
      }
    }
    if (coveredLayers.size < 2) {
      // ... more nesting
    }
  }
}
```

**Issue 3: Magic Numbers Throughout**
Dozens of untyped constants scattered across the code:
- `FILE_SEARCH_LIMIT = intent === "narrow" ? 50 : 80`
- `MAX_CANDIDATE_FILES = 60`
- `GRAPH_EXPAND_LIMIT = 30`
- `perTermSymbolCap = intent === "narrow" ? 15 : intent === "broad" ? 10 : 12`

**Recommendation:** Centralize configuration:
```typescript
// config/retrieval-config.ts
export const RETRIEVAL_CONFIG = {
  narrow: { fileSearchLimit: 50, perTermSymbolCap: 15, /* ... */ },
  broad: { fileSearchLimit: 80, perTermSymbolCap: 10, /* ... */ },
  // ...
} as const;
```

### 7.3 Error Handling Strengths

**Good Pattern - Graceful Degradation:**
```typescript
export async function generateCapsuleWithRuntime(
  db: Database.Database,
  params: CapsuleParams,
  embeddingRuntime: EmbeddingRuntime | null | undefined
): Promise<CapsuleOutput> {
  if (!embeddingRuntime) {
    return generateCapsule(db, params);  // Fallback to lexical
  }
  try {
    // Try hybrid search
  } catch (error) {
    logger.warn("hybrid runtime unavailable; falling back to lexical retrieval");
    return generateCapsule(db, params);  // Fallback on error
  }
}
```

**Good Pattern - Database Contention Handling:**
```typescript
const safeWrite = (label: string, fn: () => void): void => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && /SQLITE_BUSY/i.test(error.message)) {
      logger.debug("non-critical write skipped due to lock contention", { label });
      return;
    }
    throw error;
  }
};
```

### 7.4 Type Safety

**Strength:** Comprehensive TypeScript interfaces:
```typescript
interface RankedCandidate {
  symbol: LightSymbolRecord;
  file: FileRecord;
  score: number;
  distance: number;
  isPivot: boolean;
  lexicalScore: number;
  degree: number;
}

interface PackResult {
  packed: ScoredNode[];
  observationBudget: number;
  tokensUsed: number;
  fileSummaries: string[];
}
```

**Weakness:** Some `any` types in database query results:
```typescript
const rows = getConnectedSymbols.all(symbolId, symbolId, symbolId) as Array<{ symbolId: number; fileId: number }>;
```

---

## 8. Performance Analysis

### 8.1 Caching Strategies

**Statement Caching:**
```typescript
const idfStmtCache = new WeakMap<Database.Database, ReturnType<Database.Database["prepare"]>>();
const obsHitStmtCache = new WeakMap<Database.Database, Database.Statement<[number, number]>>();
const edgeStmtCache = new WeakMap<Database.Database, CachedEdgeStmts>();
```

**File Cache:**
```typescript
const fileCache = new Map<number, FileRecord | undefined>();
const getFile = (fileId: number): FileRecord | undefined => {
  if (!fileCache.has(fileId)) fileCache.set(fileId, files.getById(fileId));
  return fileCache.get(fileId);
};
```

**Path Candidate Cache:**
```typescript
const pathCandidateCache = new Map<string, FileRecord>();
```

### 8.2 Batch Processing

**Edge Batch Fetching (Lines 1693-1721):**
```typescript
function batchFetchOutgoingEdges(symbolIds: number[]): Map<number, EdgeSummary[]> {
  const result = new Map<number, EdgeSummary[]>();
  if (symbolIds.length === 0) return result;

  for (let i = 0; i < symbolIds.length; i += EDGE_BATCH_CHUNK_SIZE) {
    const chunk = symbolIds.slice(i, i + EDGE_BATCH_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    // Batch query with IN clause
  }
}
```

### 8.3 Lazy Evaluation

**BFS Time Budget Check:**
```typescript
const skipBfs = isOverBudget(0.5);
const effectiveBfsDepth = skipBfs ? 1 : maxDepth;
```

**Promotion Skip:**
```typescript
const skipPromotion = isOverBudget(0.8);
```

### 8.4 Memory Efficiency

**WeakMap for Statement Caching:**
- Allows garbage collection when database connection closes
- No memory leaks from orphaned prepared statements

**Incremental Processing:**
- Generator functions not used, but iterative processing with early termination
- `isOverBudget()` checks at multiple stages

### 8.5 Performance Bottlenecks

**Potential Issue: Large IN Clauses**
```typescript
const placeholders = topFileIds.map(() => "?").join(",");
// Could create very large queries for broad queries
```

**Potential Issue: Synchronous BFS on Large Graphs**
```typescript
const bfsNodes = weightedBfsTraversal(db, [...pivotSymbolIds], effectiveBfsDepth, scopeDirs, { 
  maxVisitedNodes, 
  maxHops: MAX_BFS_HOPS,
  incomingEdgeCostMultiplier: bfsIncomingMult 
});
```
- Synchronous traversal could block event loop
- Mitigated by `maxVisitedNodes` cap

---

## 9. Recommendations

### 9.1 High Priority

1. **Refactor generator.ts into modules**
   - Split by phase: discovery, ranking, selection, packing controller
   - Reduces file size from 2,800 to ~400-600 lines per module
   - Improves testability and maintainability

2. **Centralize configuration**
   - Create `src/capsule/config.ts` with intent-specific constants
   - Document each configuration parameter
   - Enable runtime tuning via environment variables

3. **Add comprehensive unit tests**
   - Current coverage appears minimal
   - Test each scoring function in isolation
   - Test budget utilization edge cases

### 9.2 Medium Priority

4. **Implement query result caching**
   - Cache capsules by query hash
   - TTL-based invalidation
   - Significant speedup for repeated queries

5. **Add structured logging**
   - Replace `logger.debug()` with structured spans
   - Enable performance tracing per phase
   - Facilitate bottleneck identification

6. **Optimize broad query performance**
   - Consider async/parallel sub-query execution
   - Implement streaming results for large capsules

### 9.3 Low Priority

7. **Documentation improvements**
   - Add architecture decision records (ADRs)
   - Document scoring formula rationale
   - Create flow diagrams for each intent

8. **Type safety improvements**
   - Replace remaining `as` type assertions
   - Add strict null checks where missing

---

## 10. Security & Robustness

### 10.1 Input Sanitization

**Query Term Tokenization:**
```typescript
const normalizedTerms = decomposeTerms(terms);
// Removes special characters, normalizes case
```

**Path Validation:**
```typescript
const withinPath = (relPath: string, scopePath: string): boolean => {
  // Prevents directory traversal
};
```

### 10.2 Resource Limits

All bounded:
- Max BFS visited: 500 nodes
- Max BFS hops: 8
- Max edge batch: 400
- Max L3 ratio: 30%
- Max query time: 500ms default

---

## Appendix: Key Code Snippets

### A.1 Multi-Pass Capsule Merging
```typescript
// From merger.ts
export interface SubCapsuleResult {
  packed: ScoredNode[];
  fileSummaries: string[];
  pivotSymbolIds: Set<number>;
  clusterIds: Set<number>;
}

export function mergeSubCapsules(
  subResults: SubCapsuleResult[],
  tokenBudget: number,
  codeRatio: number,
  clusterBySymbolId: ReadonlyMap<number, number>
): MergedCapsuleResult {
  // Rebalances budgets across clusters
  // Handles cluster overlap conflicts
  // Preserves diversity
}
```

### A.2 Hub Penalty Calculation
```typescript
// From scorer.ts
function computeHubPenalty(centrality: number, isPivot: boolean): number {
  const hubThreshold = 0.08;
  const hubRange = 0.22;
  const hubIntensity = Math.max(0, Math.min(1, (centrality - hubThreshold) / hubRange));
  const minPenalty = isPivot ? 0.7 : 0.4;
  return 1 - hubIntensity * (1 - minPenalty);
}
```

### A.3 Common Name Dampening
```typescript
// From generator.ts: Lines 1086-1098
const nameFileCounts = new Map<string, number>();
{
  const nameFileIds = new Map<string, Set<number>>();
  for (const candidate of candidates) {
    const name = candidate.symbol.name.toLowerCase();
    let s = nameFileIds.get(name);
    if (!s) { s = new Set(); nameFileIds.set(name, s); }
    s.add(candidate.file.id);
  }
  for (const [name, fileIds] of nameFileIds) {
    nameFileCounts.set(name, fileIds.size);
  }
}
// Later applied: if (nameFreq > 5) candidate.score *= Math.min(1.0, 5.0 / nameFreq);
```

---

**Review completed by:** Worker Droid  
**Review duration:** ~45 minutes  
**Files analyzed:** 10 core files  
**Lines analyzed:** ~4,000 lines
