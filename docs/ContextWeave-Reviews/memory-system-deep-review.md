# ContextWeave Memory System - Deep Review

**Date:** 2026-03-21  
**Reviewer:** Worker Droid  
**Scope:** Memory architecture, BM25 search, passive/intentional observation balance

---

## 1. Observation Schema Analysis

### SQLite Schema (src/db/schema.ts:51-79)

```sql
CREATE TABLE IF NOT EXISTS observations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL REFERENCES sessions(id),
  agent_id    TEXT    NOT NULL DEFAULT 'claude-code',
  symbol_id   INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  file_id     INTEGER REFERENCES files(id) ON DELETE SET NULL,
  scope       TEXT    NOT NULL,
  note        TEXT    NOT NULL,
  confidence  REAL    NOT NULL DEFAULT 1.0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  stale       INTEGER NOT NULL DEFAULT 0,
  stale_reason TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  hit_count   INTEGER NOT NULL DEFAULT 0,          -- Promotion tracking
  last_hit_at INTEGER                                  -- Recency tracking
);
```

### Scope Types & Semantics

| Scope | Weight | Purpose | Confidence Default |
|-------|--------|---------|-------------------|
| `architecture` | 3.0 | High-level system design decisions | 1.0 (user-defined) |
| `decision` | 2.0 | Design choices and rationale | 1.0 (user-defined) |
| `intent` | 2.0 | Developer intent notes | 1.0 (user-defined) |
| `pattern` | 1.5 | Detected code patterns | 1.0 (user-defined) |
| `passive` | 0.1 | Auto-captured query/file observations | 0.5-0.6 |

**ObservationRecord Interface** (src/core/types.ts:178-192):
```typescript
interface ObservationRecord {
  id: number;
  sessionId: string;
  agentId: string;
  symbolId: number | null;
  fileId: number | null;
  scope: string;
  note: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  stale: boolean;
  staleReason: string | null;
  archived: boolean;
}
```

---

## 2. BM25 Implementation Analysis

### Core Implementation (src/memory/bm25.ts)

**Parameters:**
- `K1 = 1.5` - Term frequency saturation parameter
- `B = 0.75` - Length normalization parameter

**Tokenization Pipeline:**
```typescript
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map((t) => stem(t));  // Porter stemmer
}
```

**Stopwords (19 words):**
```typescript
const STOPWORDS = new Set([
  "the", "a", "an", "is", "it", "and", "or", "of", "to", "in",
  "for", "on", "at", "by", "with", "as", "this", "that", "from", "be",
]);
```

**BM25 Formula Implementation:**
```typescript
const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
const numerator = tf * (K1 + 1);
const denominator = tf + K1 * (1 - B + B * (dl / avgdl));
const termScore = idf * (numerator / denominator);
```

### Index Schema

**bm25_index table** (term → observation mapping):
```sql
CREATE TABLE IF NOT EXISTS bm25_index (
  term           TEXT    NOT NULL,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  tf             REAL    NOT NULL,
  PRIMARY KEY (term, observation_id)
);
CREATE INDEX IF NOT EXISTS idx_bm25_term ON bm25_index(term);
```

**bm25_doc_lengths table** (document length tracking):
```sql
CREATE TABLE IF NOT EXISTS bm25_doc_lengths (
  observation_id INTEGER PRIMARY KEY,
  dl             INTEGER NOT NULL
);
```

**bm25_stats table** (global statistics):
```sql
CREATE TABLE IF NOT EXISTS bm25_stats (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: "doc_count", "avg_dl"
```

### Search with Fallback (3-Layer)

1. **Layer 1:** Direct BM25 search on query tokens
2. **Layer 2:** Trigram fuzzy matching (≥0.4 similarity) for unmatched tokens
3. **Layer 3:** Levenshtein correction (max distance 2) for spelling errors

---

## 3. Passive Capture System

### Query Observations (src/memory/passive.ts:11-35)

**Trigger:** After successful symbol resolution in capsule generation  
**Confidence:** 0.5  
**Scope:** `passive`  

```typescript
export function captureQueryObservation(
  db: Database.Database,
  query: string,
  pivotSymbolIds: Set<number>,
  sessionId: string,
  _projectRoot: string
): void {
  if (pivotSymbolIds.size === 0) return;
  // Captures: [auto] Query: "{query}" resolved to: {symbolNames}
  store.create({
    sessionId,
    scope: "passive",
    note: `[auto] Query: "${query}" resolved to: ${names.join(", ")}`,
    symbolId: pivotArray[0],  // Links to first pivot symbol
    confidence: 0.5,
  });
}
```

### File Change Observations (src/memory/passive.ts:37-67)

**Trigger:** After file re-indexing detects changes  
**Confidence:** 0.6 (slightly higher than query observations)  
**Scope:** `passive`

```typescript
export function captureFileChangeObservation(
  db: Database.Database,
  filePath: string,
  diff: IndexDiff,  // added, deleted, modified, renamed
  fileId: number,
  sessionId: string,
  projectRoot: string
): void {
  // Captures: [auto] Modified: {path} — added: [...], removed: [...], changed: [...]
  store.create({
    sessionId,
    scope: "passive",
    note: `[auto] Modified: ${relativePath} — added: [...], removed: [...], changed: [...]`,
    fileId,
    confidence: 0.6,
  });
}
```

### Capsule Auto-Population (src/memory/search.ts:79-115)

**Trigger:** High-confidence capsules (≥0.65 confidence threshold)  
**Confidence:** Capped at 0.6 (min of input confidence, 0.6)  
**Note format:** `capsule for "{query}" included: {fileList}; symbols: {symbolList}`

---

## 4. Scope Weighting Analysis

### Weight Hierarchy (src/memory/search.ts:28-40)

```typescript
const SCOPE_WEIGHTS: Record<string, number> = {
  architecture: 3.0,   // 30x passive weight
  decision: 2.0,       // 20x passive weight
  intent: 2.0,         // 20x passive weight
  pattern: 1.5,        // 15x passive weight
  passive: 0.1,        // Baseline
};
```

### Combined Scoring Formula

```typescript
const combinedScore = obs.confidence * bm25Score * getScopeWeight(obs.scope);
```

**Example Scores:**
- Architecture observation (conf=1.0, bm25=2.0): 1.0 × 2.0 × 3.0 = **6.0**
- Passive observation (conf=0.5, bm25=2.0): 0.5 × 2.0 × 0.1 = **0.1**

**Intentional vs Passive Ratio:** Up to **60:1** advantage for intentional observations

### 7-Day Expiration (src/memory/search.ts:24)

```typescript
const PASSIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 604,800,000 ms

function isExpiredPassive(obs: ObservationRecord): boolean {
  return obs.scope === "passive" && Date.now() - obs.updatedAt > PASSIVE_TTL_MS;
}
```

**Behavior:** Expired passive observations are filtered out during search but remain in database until GC.

---

## 5. Capsule Integration

### Memory Injection During Retrieval (src/capsule/generator.ts:303-316)

```typescript
const memorySearch = new MemorySearch(db);
const observationBudget = Math.floor(tokenBudget * OBSERVATION_BUDGET_FRACTION);  // 20% of budget
const { observations } = memorySearch.getRelevantForCapsule(query, observationBudget);
```

**Budget Allocation:**
- Default token budget: 4000 tokens
- Observation budget: 800 tokens (20%)

### Memory Bridge for Low-Result Queries (src/capsule/generator.ts:588-614)

```typescript
if (rawPivotIds.size < 3 && memoryCandidateSymbolIds.size > 0) {
  // Memory bridge activates when few pivots found
  for (const symbolId of memoryCandidateSymbolIds) {
    rawPivotIds.add(symbolId);  // Inject memory-linked symbols
  }
  logger.info("memory bridge activated", { addedPivots: added, totalPivots: rawPivotIds.size });
}
```

### Observation Count Tracking for Scoring (src/capsule/generator.ts:708-719)

```typescript
const observationCountBySymbol = new Map<number, number>();
const observationCountByFile = new Map<number, number>();
for (const obs of observations) {
  if (obs.symbolId != null) {
    observationCountBySymbol.set(obs.symbolId, (observationCountBySymbol.get(obs.symbolId) ?? 0) + 1);
  }
  if (obs.fileId != null) {
    observationCountByFile.set(obs.fileId, (observationCountByFile.get(obs.fileId) ?? 0) + 1);
  }
}
// Used in scoreNode() to boost symbols/files with observations
```

### Observation Selection for Formatting (src/capsule/formatter.ts:17-39)

```typescript
export function selectObservations(
  observations: ObservationRecord[],
  metadata: CapsuleMetadata
): ObservationRecord[] {
  const intent = metadata.strategy?.intent;
  const docFocused = DOC_QUERY_RE.test(metadata.query);

  // Filter out documentation scopes for narrow non-doc queries
  if (!docFocused && intent === "narrow") {
    return observations.filter((observation) => !DOC_SCOPES.has(observation.scope));
  }

  // Budget-based selection for documentation scopes
  let docBudget = 200;
  for (const observation of observations) {
    if (DOC_SCOPES.has(observation.scope)) {
      if (!docFocused) continue;
      const estimatedTokens = estimateObservationTokens(observation.note);
      if (estimatedTokens > docBudget) continue;
      docBudget -= estimatedTokens;
      selected.push(observation);
    }
  }
}
```

---

## 6. Staleness Management

### Confidence Decay (src/memory/staleness.ts:85-103)

**Soft Stale Propagation:**
```typescript
private propagateSoftStale(
  symbolId: number,
  currentDepth: number,
  maxDepth: number,
  visited: Set<number>
): void {
  const decayedConfidence = Math.max(
    0,
    obs.confidence - DEFAULT_CONFIDENCE_DECAY_PER_HOP * currentDepth  // 0.3 per hop
  );
}
```

**Hard Stale Marking:**
```typescript
private markDirectObservationsHardStale(symbolId: number, reason: string): void {
  this.queries.markStale(obs.id, reason);  // stale = 1, stale_reason = reason
}
```

**Triggers:**
- **Symbol deleted:** Hard stale with reason "symbol_deleted"
- **Symbol modified:** Hard stale with reason "symbol_modified"
- **Symbol renamed:** Updates symbol_id reference (not marked stale)

### Garbage Collection (src/memory/staleness.ts:105-139)

```typescript
runGC(options: GCOptions = {}): number {
  const {
    staleOlderThan = Date.now() - 30 * 24 * 60 * 60 * 1000,  // 30 days
    confidenceThreshold = 0.1,
    archiveOrphans = true,
  } = options;

  // Archive stale observations past threshold
  for (const obs of expired) {
    this.queries.archive(obs.id);
    this.bm25.removeObservation(obs.id);
  }

  // Archive orphan observations (symbol deleted)
  if (archiveOrphans) {
    for (const obs of active) {
      if (obs.symbolId == null) continue;
      const symbol = this.symbols.getById(obs.symbolId);
      if (symbol) continue;
      this.queries.archive(obs.id);
      this.bm25.removeObservation(obs.id);
    }
  }
}
```

### Hit-Based Promotion (src/memory/observations.ts:11-24)

```typescript
export function promoteFrequentObservations(db: Database.Database): number {
  const result = db.prepare(`
    UPDATE observations
    SET scope = 'convention', confidence = 0.9, updated_at = ?
    WHERE hit_count >= 3 AND scope != 'convention' AND archived = 0
  `).run(Date.now());
  return result.changes;
}
```

**Promotion Rule:** 3+ hits → promoted to `convention` scope with 0.9 confidence

---

## 7. Recall Behavior (src/mcp/tools/recall.ts)

### Default Exclusions

```typescript
const results = search.search(query, {
  scope,
  includeStale: include_stale,   // Default: false
  includePassive: false,          // Default: excludes passive!
  limit: limit ?? 10,
});
```

**Key Finding:** `cw_recall` **excludes passive observations by default** (`includePassive: false`)

### Scope Filtering Options

| Parameter | Type | Default | Behavior |
|-----------|------|---------|----------|
| `query` | string (required) | - | BM25 search query |
| `scope` | string (optional) | undefined | Filter to specific scope |
| `include_stale` | boolean (optional) | false | Include stale observations |
| `limit` | number (optional) | 10 | Max results (1-500) |

### Output Formatting

```typescript
// Intentional observations grouped first
renderGroup("Intentional observations", intentional);
renderGroup("Passive observations", passive);

// Format: - [scope][STALE] (confidence: 0.85) note text
const staleTag = obs.stale ? " [STALE]" : "";
const confidenceTag = obs.confidence < 1.0 ? ` (confidence: ${obs.confidence.toFixed(2)})` : "";
lines.push(`- [${obs.scope}]${staleTag}${confidenceTag} ${obs.note}`);
```

---

## 8. Remember Tool (src/mcp/tools/remember.ts)

### API Schema

```typescript
{
  scope: z.string().max(100),      // architecture, bug, pattern, decision, todo, convention
  note: z.string().max(10000),     // The observation text
  symbol: z.string().optional(),   // Symbol name to associate
  confidence: z.number().min(0).max(1).optional(),  // Default: 1.0
}
```

### Symbol Linking

```typescript
if (symbol) {
  const allNames = symbols.getAllNames();
  const matches = fuzzyMatch(symbol, allNames, 0.6);  // 0.6 threshold
  if (matches.length > 0) {
    const syms = symbols.getByName(matches[0]!.name);
    linkedSymbolId = syms[0]!.id;
  }
}
```

### Storage Flow

1. Ensure session exists in `sessions` table
2. Fuzzy match symbol name (if provided)
3. Create observation with linked `symbol_id` and/or `file_id`
4. Index in BM25 (note + scope + symbol name)

---

## 9. Search Quality Analysis

### Query Expansion for Broad Queries (src/memory/search.ts:85-95)

```typescript
function isBroadNaturalQuery(query: string): boolean {
  const words = query.trim().split(/\s+/);
  if (words.length <= 3) return false;
  const hasCamelCase = /[a-z][A-Z]/.test(query);
  const hasSnakeCase = /[a-z]_[a-z]/.test(query);
  return !hasCamelCase && !hasSnakeCase;  // Natural language detection
}
```

**Broad Query Strategy:**
- Synonym expansion via `expandQueryWithSynonyms()`
- OR-logic: Run expanded query + individual terms
- Union merge of all result sets

### Fuzzy Fallback (src/memory/search.ts:142-181)

When BM25 returns no results:
1. Load all active observations (up to 500)
2. Compute trigram similarity for fuzzy matching
3. Score = confidence × text_similarity × scope_weight
4. Filter threshold: score ≥ 0.15

---

## 10. Architecture Strengths

1. **Clean Separation:** Observation storage, BM25 indexing, and search are well-decoupled
2. **Scope-Based Prioritization:** 30x weight differential effectively suppresses passive noise
3. **Multi-Layer Fallback:** BM25 → trigram → Levenshtein ensures robust recall
4. **Automatic Promotion:** Hit-count based promotion surfaces valuable observations
5. **Staleness Propagation:** Dependency-aware confidence decay tracks code changes
6. **Session Context:** Observations linked to sessions enable temporal queries

---

## 11. Potential Issues

1. **Passive Observation Exclusion:** Recall tool excludes passive by default, limiting discovery of auto-captured context
2. **7-Day TTL Hardcoded:** No configuration for passive expiration
3. **BM25 Stopword List:** Very short (19 words) compared to standard lists
4. **Single Symbol Linking:** Query observations only link to first pivot symbol
5. **No Hit Count in Search Ranking:** Frequent observations promoted but hit count doesn't affect search ranking directly
6. **Observation Budget Fixed:** 20% of token budget regardless of observation relevance

---

## 12. Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| src/memory/search.ts | 228 | BM25 retrieval, scope filtering, capsule integration |
| src/memory/observations.ts | 172 | Storage schema, CRUD operations, promotion/demotion |
| src/memory/passive.ts | 67 | Auto-capture of queries and file changes |
| src/memory/bm25.ts | 288 | Full-text search implementation with fallback |
| src/memory/staleness.ts | 139 | Confidence decay, garbage collection, orphan handling |
| src/mcp/tools/recall.ts | 71 | cw_recall tool implementation |
| src/mcp/tools/remember.ts | 61 | cw_remember tool implementation |
| src/db/schema.ts | 170 | SQLite schema definitions |
| src/db/queries/observations.ts | 123 | SQL query layer for observations |
| src/core/types.ts | 350+ | TypeScript type definitions |
| src/capsule/generator.ts | 2799 | Capsule generation with memory bridge |
| src/capsule/formatter.ts | 306 | Observation formatting for capsules |

---

## 13. Key Metrics Summary

| Metric | Value |
|--------|-------|
| BM25 K1 | 1.5 |
| BM25 B | 0.75 |
| Passive TTL | 7 days |
| GC Stale Threshold | 30 days |
| GC Confidence Floor | 0.1 |
| Observation Budget | 20% of token budget |
| Scope Weight Range | 0.1 (passive) to 3.0 (architecture) |
| Passive Confidence | 0.5 (query), 0.6 (file change), capped 0.6 (capsule) |
| Promotion Hit Threshold | 3 hits → convention scope |
| Confidence Decay Per Hop | 0.3 |
| Max BFS Depth for Staleness | 2 hops |
| Fuzzy Match Threshold | 0.4 (trigram), 0.6 (symbol linking) |
| Levenshtein Max Distance | 2 |
