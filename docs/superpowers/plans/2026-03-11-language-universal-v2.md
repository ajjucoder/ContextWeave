# Language-Universal Architecture v2.1 — Complete Review Fix Plan + Augment Parity

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every flaw found across 8 project reviews (88 total), make ContextWeave work flawlessly across all 12 supported languages, close the gap with Augment's Context Engine, and establish quality benchmarks that catch real failures.

**Architecture:** Five pillars — (1) fix systemic pipeline bugs first (root causes that affect ALL languages), (2) fix the noise root cause with pre-pack relevance gating, (3) add language-universal resolution infrastructure (qualified names, decorators, module resolvers, type-aware edges), (4) fix flow tracing completeness (the #1 weakness across all reviews), (5) add semantic intelligence (query intent classification, LSP bridge, improved recall). No rewrites — all changes are additive to the existing pipeline.

**Augment Parity Strategy:** Augment's Context Engine uses embeddings + type-aware resolution. We close that gap via: (a) query intent classification to route queries intelligently instead of BM25-for-everything, (b) LSP bridge for type-aware edge resolution, (c) pre-pack relevance gating to eliminate the noise problem that makes capsules worse than grep+read, (d) flow completeness to match Augment's cross-file tracing.

**Tech Stack:** TypeScript ESM, tree-sitter 0.21/0.23, better-sqlite3, vitest

**Supersedes:** `docs/superpowers/plans/2026-03-10-language-universal-architecture.md` (previous plan missed systemic root causes) and the v2 draft of this plan (missed 6 critical gaps identified during deep review analysis)

---

## Flaw-to-Fix Traceability Matrix

Every flaw maps to a specific task. After completing all tasks, all 88 flaws should be resolved.

### Already Fixed (commit 88c06bb) — 35 flaws
| Flaws | Category | Fix Applied |
|-------|----------|-------------|
| 3, 23, 32, 42 | Definition missing/truncated | Packer primary anchor at compressionLevel=0 |
| 9, 18, 40, 66 | Duplicate content | Line-range containment dedup |
| 47, 74 | Test files in capsules | testFilePenalty=0.5 |
| 50, 59, 63 | Index pollution | .qa-temp, .worktrees, .claude exclusion |
| 60 | No symbol-not-found signal | symbolNotFound flag + prepended note |
| 30 | Flow "no outgoing flows" | path.length > 0 fix |
| 35 | Convex mutation lookup | Convex plugin |
| 12 | Impact depth leakage | import/reexport skip at depth≥1 |
| 6, 19, 24, 38, 46, 56, 65, 75 | Stats inflated | TARGETED_READ_FRACTION=0.3 + disclosure |
| 2, 14, 22 | Noise in capsules | Relevance floor, test-file penalty |
| 8, 16, 25 | Budget underutilization (partial) | Backfill + promotion + 0.85 target |

### Needs Fixing — 53 flaws (addressed by tasks below)

| Flaws | Root Cause | Fix Task |
|-------|-----------|----------|
| — | .qa-temp-probes/ polluting results NOW | Task 0 (immediate) |
| 1, 15, 34, 41, 53, 62, 69, 80 | Confidence miscalibration | Task 1 |
| 79, 33, 54, 61, 71 | Budget still underutilized | Task 2 |
| 81, 43, 72 | Backfill adds noise by centrality | Task 3 |
| 82 | JSX callbacks not indexed | Task 4 |
| 26, 58, 67, 76 | Previously-shown wastes tokens | Task 5 |
| 84 | No semantic validation pass | Task 6 |
| 2, 14, 22 (partial) | Noise: irrelevant symbols from relevant files | Task 6.5 (NEW — pre-pack gate) |
| 85, 88 | Stats/benchmarks not honest | Task 7 |
| 87, 29, 36, 49, 78 | Overview shallow | Task 8 |
| 4, 27, 64, 73, 77 | Follow-ups irrelevant | Task 9 |
| 28, 39 | cw_read path issues | Task 10 |
| 10, 17, 37, 48, 68 | Recall empty/wrong | Task 18 |
| 5, 31 | Legacy/irrelevant files rank high | Task 11 |
| 11, 13, 20, 44, 70 | Flow tracing quality — missing edges + path diversity | Task 19 (EXPANDED — flow completeness overhaul) |
| 21, 51 | Cross-boundary flows untraced | Task 17, 20 (UPGRADED — AST-aware) |
| 45 | Cannot trace incoming | Task 19 (already works, needs docs fix) |
| 52, 57 | Impact/flow fails for non-JS | Task 12, 14, 15, 22 (LSP promoted) |
| 55 | Language bias (Rust over TSX) | Task 21 |
| 7 | HTTP flow shallow | Task 17, 20 |
| — | Conceptual queries fail ("error handling" → handleTimestampClick) | Task 25 (NEW — query intent classifier) |
| 83 | BFS missing edge weights | Already fixed (verified in code) |
| 86 | Pattern detection not wired | Already wired (verified at generator.ts:2157) |

---

## Part 0: Immediate Fixes (Before Anything Else)

### Task 0: Fix Active Index Pollution

**Fixes:** Live bug — `.qa-temp-probes/` files appearing at relevance 1.0 in capsule results right now
**Files:** `src/core/discovery.ts` (or wherever EXCLUDED_DIRS is defined)

Commit 88c06bb added `.qa-temp` and `.worktrees` to exclusions, but `.qa-temp-probes/` is a separate directory that's still being indexed. A live capsule test for "packer compression" returned `.qa-temp-probes/zod/packages/zod/src/v4/core/standard-schema.ts` at relevance 1.0 with HIGH confidence — this is actively degrading results.

- [ ] **Step 1: Add `.qa-temp-probes` to exclusion list**

```typescript
// Add to EXCLUDED_DIRS or equivalent:
".qa-temp-probes",
```

Also audit for any other probe/test directories that may have been created since the last exclusion update.

- [ ] **Step 2: Reindex the ContextWeave project itself to verify**

```bash
# After fix, reindex and verify no .qa-temp-probes files appear
npx vitest run tests/core/discovery -v
```

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(index): exclude .qa-temp-probes from indexing"
```

---

## Part 1: Systemic Pipeline Fixes

These are the root causes from the ANALYSIS review. They affect ALL languages and ALL tools. Fix these first.

### Task 1: Confidence Calibration Overhaul

**Fixes:** Flaws 1, 15, 34, 41, 53, 62, 69, 80
**Files:** `src/capsule/confidence.ts`

The ANALYSIS identified three escape hatches that let wrong answers report HIGH confidence:

- [ ] **Step 1: Remove intent-gated escape from utilization caps**

Current (line 136): `if (tokenUtilization <= 0.60 || pivotCoverage <= 0.60)` caps at 0.89 but has no further scaling. The cap should be proportional:

```typescript
// Replace lines 131-138 with graduated caps:
if (tokenUtilization < 0.20) {
  confidence = Math.min(confidence, 0.30);
} else if (tokenUtilization < 0.30) {
  confidence = Math.min(confidence, 0.40);
} else if (tokenUtilization < 0.40) {
  confidence = Math.min(confidence, 0.50);
} else if (tokenUtilization < 0.50) {
  confidence = Math.min(confidence, 0.60);
} else if (tokenUtilization < 0.60) {
  confidence = Math.min(confidence, 0.70);
}

// Pivot coverage gate — applies to ALL intents including narrow
if (pivotCoverage < 0.30) {
  confidence = Math.min(confidence, 0.45);
} else if (pivotCoverage < 0.50) {
  confidence = Math.min(confidence, 0.60);
} else if (pivotCoverage < 0.70) {
  confidence = Math.min(confidence, 0.80);
}
```

- [ ] **Step 2: Add query-term-in-result validation**

After computing the base confidence, verify that query terms actually appear in the packed symbols:

```typescript
// Add after all other confidence adjustments, before return:
if (packedSymbolNames && queryTerms && queryTerms.length > 0) {
  const packedNameSet = new Set(
    packedSymbolNames.flatMap((n) => tokenizeForMatch(n))
  );
  const termHits = queryTerms.filter((t) => packedNameSet.has(t.toLowerCase())).length;
  const termCoverage = termHits / queryTerms.length;
  if (termCoverage < 0.3 && intent !== "broad") {
    confidence = Math.min(confidence, 0.50);
  }
}
```

This catches the Kuvio "showToast" case — if the query says "showToast" but no packed symbol contains "toast", confidence drops.

- [ ] **Step 3: Update computeCoverageConfidence signature**

Add `packedSymbolNames: string[]` and `queryTerms: string[]` parameters. Pass them from the generator.

- [ ] **Step 4: Update quality-baseline.json after confidence changes**

Run eval suite, regenerate baseline, verify thresholds still make sense.

- [ ] **Step 5: Test + commit**

```bash
npx vitest run tests/capsule/ tests/integration/ -v
git commit -m "fix(confidence): remove escape hatches, add query-term validation"
```

---

### Task 2: Budget Utilization — Fill to Target

**Fixes:** Flaws 33, 54, 61, 71, 79
**Files:** `src/capsule/generator.ts`

The refill loop already targets 85% (`BROAD_TASK_TARGET_UTILIZATION = 0.85`) and triggers at <60% (`BROAD_TASK_MIN_UTILIZATION = 0.6`). But the gate `intent !== "broad" || tokenBudget < 9000` on `backfillWithinSelectedFiles` is too restrictive.

- [ ] **Step 1: Lower backfill gate**

Change `backfillWithinSelectedFiles` gate from `tokenBudget < 9000` to `tokenBudget < 4000`:

```typescript
if (intent !== "broad" || tokenBudget < 4000 || selectedCandidates.length >= 10) {
```

Also apply to `ensureBroadFileSpread`.

- [ ] **Step 2: Enable refill for task intent**

The refill loop at line 1746 gates on `intent === "broad" || intent === "task"`. Verify this is working — the ANALYSIS says "task" queries still underutilize.

Check if `BROAD_TASK_MIN_UTILIZATION` applies to task intent:

```typescript
// Should be:
if (
  (intent === "broad" || intent === "task") &&
  tokenBudget >= 500 &&
  tokensUsed < tokenBudget * BROAD_TASK_MIN_UTILIZATION &&
  candidates.length > selected.length
)
```

- [ ] **Step 3: Add a final "fill to 85%" pass**

After all existing refill passes, if still under 75%, add one more pass that pulls in ANY remaining scored candidate (not just from selected files):

```typescript
if (tokensUsed < tokenBudget * 0.75 && candidates.length > selected.length) {
  // Last resort: add highest-scored unselected candidates
  const remaining = candidates
    .filter((c) => !selectedIds.has(c.symbol.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  // ... pack and check if utilization improves
}
```

- [ ] **Step 4: Test + commit**

---

### Task 3: Backfill Scoring — Query Relevance Over Centrality

**Fixes:** Flaws 43, 72, 81
**Files:** `src/capsule/generator.ts`

The `backfillWithinSelectedFiles` scoring already uses `queryOverlap * 6` as primary signal (line 1413). But the `ensureBroadFileSpread` function (around line 1348) scores by `lexicalScore * 1.4 + centrality * 4 + 0.5` — centrality dominates.

- [ ] **Step 1: Fix ensureBroadFileSpread scoring**

Change the scoring to prioritize query relevance:

```typescript
score: bestSymbol.lexicalScore * 4 + computeQueryOverlap(bestSymbol.symbol.name) * 6 + bestSymbol.symbol.centrality * 1 + 0.25,
```

Centrality goes from weight 4 to weight 1. Query overlap becomes primary.

- [ ] **Step 2: Add hub node cap in backfill**

Skip symbols that are hub nodes (high centrality but no query relevance):

```typescript
if (queryOverlap === 0 && symbol.centrality > hubCentralityThreshold && !hasDirectEdgeToPivot(symbol.id)) {
  continue; // Skip hub nodes that aren't query-relevant
}
```

- [ ] **Step 3: Test + commit**

---

### Task 4: JSX Callback Edge Indexing

**Fixes:** Flaw 82
**Files:** `src/core/parser.ts`

The parser only creates callback edges when a function identifier appears inline as a JSX prop value. `onClick={handleClick}` doesn't create an edge because `handleClick` is already captured by `callExpressions` but the connection `ParentComponent` → `handleClick` via JSX prop is missing.

- [ ] **Step 1: Write failing test**

```typescript
it("creates callback edge for onClick={handleClick}", async () => {
  writeFileSync(join(root, "Button.tsx"), `
export function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Click</button>;
}
`);
  writeFileSync(join(root, "App.tsx"), `
import { Button } from "./Button";
export function App() {
  const handleClick = () => console.log("clicked");
  return <Button onClick={handleClick} />;
}
`);
  await indexProject(db, root);
  const edges = edgeQueries(db);
  const app = symbolQueries(db).getByName("App")[0];
  const handleClick = symbolQueries(db).getByName("handleClick")[0];
  const outgoing = edges.getBySource(app.id);
  expect(outgoing.some(e => e.targetSymbolId === handleClick.id && e.kind === "callback")).toBe(true);
});
```

- [ ] **Step 2: Fix JSX callback detection in parser**

In the JSX usage query processing section, ensure that when `@prop_value` captures an identifier that matches a symbol in the same file, a callback edge is created:

```typescript
// When processing jsxUsages query results:
if (propName && isCallbackProp(propName) && propValueNode?.type === "identifier") {
  const calleeName = propValueNode.text;
  calls.push({
    callerSymbol: enclosingSymbol.name,
    calleeName,
    line: propValueNode.startPosition.row + 1,
    edgeKind: "callback",
  });
}
```

The `isCallbackProp` check already exists. The issue is that `@prop_value` captures may not be reaching this code path for simple identifier references.

- [ ] **Step 3: Test + commit**

---

### Task 5: Eliminate Previously-Shown Token Waste

**Fixes:** Flaws 26, 58, 67, 76
**Files:** `src/capsule/formatter.ts`, `src/capsule/generator.ts`

- [ ] **Step 1: Remove inline `[previously shown]` markers entirely**

In `formatter.ts`, remove any code that generates `[previously shown]` text inline. Instead, add a metadata-only note at the end:

```typescript
// Instead of inline markers, just add to metadata:
if (dedupDroppedNames.length > 0) {
  metadata.previouslyCovered = dedupDroppedNames;
  // Add ONE line to footer (not per-symbol):
  footer += `\n(${dedupDroppedNames.length} symbols from prior capsules omitted)`;
}
```

- [ ] **Step 2: Reclaim token budget from dropped symbols**

When symbols are dropped as previously-shown, their token budget should be reallocated to remaining symbols:

```typescript
const reclaimedBudget = tokensUsed - droppedTokens;
// Re-pack remaining symbols with the reclaimed budget
```

- [ ] **Step 3: Test + commit**

---

### Task 6: Semantic Validation Pass (Lightweight Reranking)

**Fixes:** Flaw 84 (cross-encoder reranking alternative)
**Files:** `src/capsule/generator.ts`

Full cross-encoder requires an ML model. Instead, add a lightweight validation pass that checks packed results against query intent:

- [ ] **Step 1: Add post-pack validation**

After packing but before formatting, validate that packed symbols have meaningful query overlap:

```typescript
function validatePackedRelevance(
  packed: PackedNode[],
  queryTerms: string[],
  intent: string
): PackedNode[] {
  if (intent === "broad" || queryTerms.length === 0) return packed;

  const queryTermSet = new Set(queryTerms.map(t => t.toLowerCase()));
  const validated: PackedNode[] = [];
  let removedTokens = 0;

  for (const node of packed) {
    const nameTokens = tokenizeSymbolName(node.name);
    const signatureTokens = node.signature.toLowerCase().split(/\W+/);
    const allTokens = new Set([...nameTokens, ...signatureTokens]);

    const hasOverlap = [...queryTermSet].some(t => allTokens.has(t));
    const isPivot = node.distance === 0;
    const isHighScore = node.score >= packed[0].score * 0.5;

    if (hasOverlap || isPivot || isHighScore) {
      validated.push(node);
    } else {
      removedTokens += node.tokensUsed;
      logger.debug("validation-drop", { name: node.name, reason: "no query overlap" });
    }
  }

  return validated;
}
```

This catches the Kuvio case: `logos` array, `LandingHowItWorks`, `isProtectedPath` have zero query overlap with "showToast function" and would be dropped.

- [ ] **Step 2: Test + commit**

---

### Task 6.5: Pre-Pack Per-Symbol Relevance Gate (Noise Root Cause Fix)

**Fixes:** The #1 noise problem across ALL 8 reviews — irrelevant symbols from relevant files consuming 40-70% of budget
**Files:** `src/capsule/generator.ts`

**Root cause identified from code review:** When a file is selected as relevant in the BFS/scoring phase, ALL its symbols become packing candidates. This is why Kuvio's `queries.ts` (relevant because it imports `showToast`) contributes `getWorkspaceEditors`, `getAllProfiles`, and other completely unrelated symbols. The file is relevant; the individual symbols are not.

Task 6 adds post-pack validation, but by then the budget is already consumed. This task gates symbols BEFORE they enter the packer, so the budget is spent on actually relevant symbols.

**This is the single highest-ROI fix for closing the gap with Augment.** Augment's Context Engine doesn't have this problem because it scores at the symbol level, not the file level.

- [ ] **Step 1: Add pre-pack symbol relevance filter**

After candidate selection but before packing, filter each symbol for query relevance:

```typescript
function filterCandidatesBySymbolRelevance(
  candidates: ScoredCandidate[],
  queryTerms: string[],
  intent: string
): ScoredCandidate[] {
  if (intent === "broad" || queryTerms.length === 0) return candidates;

  const queryTermSet = new Set(queryTerms.map(t => t.toLowerCase()));

  return candidates.filter(candidate => {
    // Always keep pivots (distance 0)
    if (candidate.distance === 0) return true;

    // Always keep direct dependencies of pivots (distance 1)
    if (candidate.distance === 1) return true;

    // For distance 2+, require query relevance OR direct edge to a kept symbol
    const nameTokens = tokenizeSymbolName(candidate.symbol.name);
    const sigTokens = candidate.symbol.signature?.toLowerCase().split(/\W+/) ?? [];
    const allTokens = new Set([...nameTokens, ...sigTokens]);

    const hasQueryOverlap = [...queryTermSet].some(t => allTokens.has(t));
    const hasHighScore = candidate.score >= candidates[0].score * 0.4;

    return hasQueryOverlap || hasHighScore;
  });
}
```

- [ ] **Step 2: Wire into generator pipeline**

Call `filterCandidatesBySymbolRelevance` after `scoreCandidates` and before `packNodesStoryMode`. Log how many symbols were filtered and their names for debugging:

```typescript
const beforeCount = candidates.length;
candidates = filterCandidatesBySymbolRelevance(candidates, queryTerms, intent);
const filtered = beforeCount - candidates.length;
if (filtered > 0) {
  logger.debug("pre-pack-filter", {
    removed: filtered,
    remaining: candidates.length,
    reclaimedEstimate: `~${filtered * 80} tokens`, // rough estimate
  });
}
```

- [ ] **Step 3: Ensure budget is reclaimed for remaining symbols**

After filtering, the same token budget applies to fewer symbols. The packer should naturally give more budget to each remaining symbol — verify that filtered symbols' budget allocation flows to remaining candidates rather than being wasted.

- [ ] **Step 4: Write targeted regression tests**

Test with the exact Kuvio scenario:
```typescript
it("filters irrelevant symbols from relevant files", async () => {
  // File A: exports showToast (the target)
  // File B: imports showToast, also exports getWorkspaceEditors, getAllProfiles
  // Query: "showToast"
  // Assert: getWorkspaceEditors and getAllProfiles are NOT in packed results
  // Assert: showToast definition IS in packed results at full fidelity
});

it("keeps direct dependencies of pivots even without query overlap", async () => {
  // showToast calls getContainer (an internal helper)
  // Assert: getContainer IS kept because it's distance 1 from pivot
});

it("does not filter on broad intent", async () => {
  // Query: "how does the data layer work" (broad)
  // Assert: all selected candidates pass through unfiltered
});
```

- [ ] **Step 5: Test + commit**

```bash
npx vitest run tests/capsule/ tests/integration/ -v
git commit -m "fix(capsule): add pre-pack per-symbol relevance gate to eliminate noise"
```

---

### Task 7: Stats Honesty + Benchmark Tightening

**Fixes:** Flaws 85, 88
**Files:** `src/mcp/tools/stats.ts`, `tests/eval/quality-baseline.json`

- [ ] **Step 1: Remove savings percentage claim entirely**

Replace with factual comparison only:

```typescript
const statsOutput = [
  `Indexed: ${fileCount} files, ${symbolCount} symbols, ${edgeCount} edges`,
  `Token usage: ${avgTokensUsed} avg per capsule`,
  `Quality: ${qualityTier}`,
  // NO savings percentage — let the user judge
];
```

- [ ] **Step 2: Tighten quality benchmark thresholds**

In `tests/eval/quality-baseline.json`, after all fixes are applied, the baseline should reflect tighter standards:

```json
{
  "precision": 0.50,    // was ~0.40
  "recall": 0.75,       // keep
  "avgConfidence": 0.50, // was ~0.46
  "avgTokenEfficiency": 0.75
}
```

Reduce TOLERANCE values in `threshold-ratchet.test.ts`:

```typescript
const TOLERANCE = {
  precision: 0.015,      // was 0.02
  recall: 0.02,
  avgConfidence: 0.015,  // was 0.02
};
```

- [ ] **Step 3: Test + commit**

---

### Task 8: Overview — Entry Points + Body-Aware Search

**Fixes:** Flaws 29, 36, 49, 78, 87
**Files:** `src/mcp/tools/overview.ts`

- [ ] **Step 1: Add entry point section**

```typescript
// After directory tree, add:
const entryPoints = db.prepare(`
  SELECT s.name, s.kind, s.centrality, f.path
  FROM symbols s JOIN files f ON s.file_id = f.id
  WHERE s.is_exported = 1 AND s.centrality > 0
  ORDER BY s.centrality DESC LIMIT 10
`).all() as { name: string; kind: string; centrality: number; path: string }[];

sections.push("## Key Entry Points");
for (const ep of entryPoints) {
  const relPath = ep.path.replace(resolvedPath + "/", "");
  sections.push(`- **${ep.name}** (${ep.kind}) — ${relPath}`);
}
```

- [ ] **Step 2: Fix query-focused search to use summary text**

The `buildSummarySnippet` function exists but isn't surfaced prominently enough. When a query match comes from summary text only (not symbol name), show the summary context instead of "no direct symbol name match":

```typescript
// Replace "no direct symbol name match" with actual context:
if (symbolMatches.length === 0 && summarySnippet) {
  focusLines.push(`  — *${summarySnippet}*`);
} else if (symbolMatches.length === 0) {
  // Don't add the line at all — skip files with no match
  continue;
}
```

- [ ] **Step 3: Test + commit**

---

### Task 9: Follow-Up Suggestion Quality

**Fixes:** Flaws 4, 27, 64, 73, 77
**Files:** `src/capsule/formatter.ts`

- [ ] **Step 1: Filter suggestions by query relevance score**

Only suggest symbols that have measurable relevance to the query:

```typescript
const suggestions = candidateSymbols
  .filter(s => {
    const overlap = computeQueryOverlap(s.name, queryTerms);
    return overlap > 0 || s.score >= topScore * 0.6;
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, 4);
```

- [ ] **Step 2: Use qualified names in suggestions**

```typescript
// Instead of: cw_read(file: "service.ts", symbol: "validate")
// Show: cw_read(file: "src/auth/service.ts", symbol: "AuthService.validate")
```

Use full relative path and qualified name.

- [ ] **Step 3: Deduplicate suggestions**

Remove suggestions for symbols already shown in the capsule body.

- [ ] **Step 4: Test + commit**

---

### Task 10: cw_read Path Normalization

**Fixes:** Flaws 28, 39
**Files:** `src/mcp/tools/read.ts`

- [ ] **Step 1: Accept both relative and absolute paths**

When the user passes a path from capsule output (e.g., `lib/ratelimit.ts`), try multiple resolution strategies:

```typescript
const candidates = [
  inputPath,                              // exact
  resolve(projectRoot, inputPath),        // relative to project root
  // fuzzy: find files ending with this path
];
const file = candidates
  .map(p => files.getByPath(p))
  .find(f => f !== undefined);
```

- [ ] **Step 2: Test + commit**

---

### Task 11: Legacy/Irrelevant File Downranking

**Fixes:** Flaws 5, 31
**Files:** `src/capsule/generator.ts`, `src/core/weighted-bfs.ts`

- [ ] **Step 1: Add content-type awareness to scoring**

For the "auth query returned UI pages" issue (Flaw 31), detect UI-only files vs logic files:

```typescript
function isRenderOnlyFile(symbols: LightSymbolRecord[]): boolean {
  const hasLogic = symbols.some(s =>
    s.kind === "function" || s.kind === "method" || s.kind === "class"
  );
  const hasOnlyJsx = symbols.every(s =>
    s.kind === "arrow" || s.kind === "variable"
  );
  return !hasLogic && hasOnlyJsx;
}
```

Apply a 0.4x penalty to render-only files when the query intent is not UI-related.

- [ ] **Step 2: Test + commit**

---

## Part 2: Language-Universal Resolution (All 12 Languages)

### Task 12: Schema Migration v19 — Qualified Names + Parent Tracking

**Fixes:** Foundation for Flaws 52, 55, 57 + all edge disambiguation
**Files:** `src/db/migrations.ts`, `src/db/schema.ts`, `src/db/queries/symbols.ts`

- [ ] **Step 1: Add migration**

```typescript
{ version: 19, up(db) {
  db.exec(`ALTER TABLE symbols ADD COLUMN parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL`);
  db.exec(`ALTER TABLE symbols ADD COLUMN qualified_name TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_parent ON symbols(parent_symbol_id)`);
}}
```

- [ ] **Step 2: Update base schema + queries**

Add columns to CREATE TABLE, update insert/mapRow in `symbols.ts`, add `getByQualifiedName` and `getByParent` queries.

- [ ] **Step 3: Test + commit**

---

### Task 13: Parser — Parent Tracking for All 12 Languages

**Fixes:** Foundation for edge disambiguation across all languages
**Files:** `src/core/parser.ts`, `src/core/types.ts`

- [ ] **Step 1: Add `parentName` to ParsedSymbol**

```typescript
export interface ParsedSymbol {
  // ... existing ...
  parentName?: string;
}
```

- [ ] **Step 2: Implement `assignParentNames`**

General strategy: methods/functions whose AST line range falls within a class/struct/impl are children.

```typescript
function assignParentNames(symbols: ParsedSymbol[], language: string, tree?: Parser.Tree): void {
  // Universal: line-range containment for class→method
  const containers = symbols.filter(s =>
    s.kind === "class" || s.kind === "interface" || s.kind === "enum"
  );
  for (const sym of symbols) {
    if (sym.kind === "method" || sym.kind === "function" || sym.kind === "arrow") {
      const parent = containers.find(c =>
        c.startLine < sym.startLine && c.endLine > sym.endLine && c.name !== sym.name
      );
      if (parent) { sym.parentName = parent.name; continue; }
    }
  }

  // Go: receiver method detection from signature
  if (language === "go") assignGoReceiverParents(symbols);

  // Rust: impl block detection from AST
  if (language === "rust" && tree) assignRustImplParents(symbols, tree);
}
```

Language-specific handlers:

**Go** — parse `func (r *Receiver) Method()` from signature:
```typescript
function assignGoReceiverParents(symbols: ParsedSymbol[]): void {
  const structs = new Map(symbols.filter(s => s.kind === "class").map(s => [s.name, s]));
  for (const sym of symbols) {
    if (sym.kind !== "function" || sym.parentName) continue;
    const match = sym.signature.match(/^func\s*\(\s*\w+\s+\*?(\w+)\s*\)/);
    if (match && structs.has(match[1])) sym.parentName = match[1];
  }
}
```

**Rust** — walk AST for `impl_item` nodes:
```typescript
function assignRustImplParents(symbols: ParsedSymbol[], tree: Parser.Tree): void {
  // Walk tree, find impl_item nodes, extract type name from child
  // For each symbol within impl block's line range, set parentName to type name
}
```

**Languages covered:**
- TypeScript/JavaScript/TSX/JSX: class→method (line-range)
- Python: class→method (line-range)
- Go: struct→method (receiver signature)
- Rust: struct→method (impl block AST walking)
- Java: class→method (line-range)
- C#: class→method (line-range)
- C/C++: struct→function (line-range for member functions in header)
- Ruby: class/module→method (line-range)
- PHP: class→method (line-range)
- Bash: no classes, no parent tracking needed

- [ ] **Step 3: Build qualified names in indexer**

After inserting symbols, update with `parent_symbol_id` and `qualified_name = parentName ? parentName + "." + name : name`.

- [ ] **Step 4: Write comprehensive multi-language tests**

Test TypeScript, Python, Go, Rust, Java, C# parent tracking (see previous plan for exact test code).

- [ ] **Step 5: Test + commit**

---

### Task 14: Edge Resolution — Qualified Name Disambiguation

**Fixes:** Reduces false edges for ALL 12 languages
**Files:** `src/core/indexer.ts`

- [ ] **Step 1: Prefer qualified matches in call edge creation**

When resolving a call to `validate` and there are 5 candidates, prefer the one whose parent class is imported or in scope:

```typescript
function resolveCallWithQualification(
  calleeName: string,
  fileImports: ParsedImport[],
  fileSymbols: SymbolRecord[],
  allCandidates: SymbolRecord[]
): SymbolRecord[] {
  if (allCandidates.length <= 1) return allCandidates;

  const importedNames = new Set(fileImports.flatMap(i => i.names));
  const localParents = new Set(
    fileSymbols.filter(s => ["class", "interface"].includes(s.kind)).map(s => s.name)
  );

  // Prefer candidates whose parent is imported or local
  const scoped = allCandidates.filter(c => {
    if (!c.qualifiedName?.includes(".")) return false;
    const parent = c.qualifiedName.split(".")[0];
    return importedNames.has(parent) || localParents.has(parent);
  });

  return scoped.length > 0 ? scoped : allCandidates;
}
```

- [ ] **Step 2: Accept qualified names in flow/impact/capsule tools**

All tools that accept a symbol name should first try `getByQualifiedName`, then fall back to `getByName`.

- [ ] **Step 3: Test + commit**

---

### Task 15: Decorator/Annotation Extraction

**Fixes:** Enables framework plugins for Python, Java, Rust, C#, TS, PHP
**Files:** `src/core/parser.ts`, `src/core/queries/*.ts`, `src/core/types.ts`

- [ ] **Step 1: Add `ParsedDecorator` type and `decorators` to ParsedSymbol**

```typescript
export interface ParsedDecorator {
  name: string;
  fullText: string;
  args?: string[];
}
```

- [ ] **Step 2: Add `decoratorQueries` to LanguageQuerySet**

```typescript
decoratorQueries?: string;  // optional — languages without decorators skip this
```

- [ ] **Step 3: Write tree-sitter queries for 6 languages**

| Language | Node Types | Query |
|----------|-----------|-------|
| Python | `decorator`, `attribute` | `(decorated_definition (decorator) @decorator definition: (_) @definition)` |
| Java | `marker_annotation`, `annotation` | `(marker_annotation name: (identifier) @decorator_name) @decorator` |
| Rust | `attribute_item` | `(attribute_item (attribute) @decorator_name) @decorator` |
| C# | `attribute_list`, `attribute` | `(attribute_list (attribute name: (identifier) @decorator_name) @decorator)` |
| TypeScript | `decorator` | `(decorator (identifier) @decorator_name) @decorator` |
| PHP | `attribute_list` | `(attribute_list (attribute (name) @decorator_name) @decorator)` |

**Note:** Exact node types may vary by tree-sitter grammar version. Run `tree-sitter parse` on test files to verify. Wrap query compilation in try/catch for resilience.

- [ ] **Step 4: Implement `parseDecorators` function**

Associate each decorator with its target symbol by matching decorator line to the next symbol's start line.

- [ ] **Step 5: Write tests for all 6 languages, commit**

---

### Task 16: Module Resolvers (8 Languages)

**Fixes:** Import graph completeness for non-JS languages
**Files:** `src/core/resolvers/` (new directory)

Create `ModuleResolver` interface and 8 implementations:

| Language | Strategy | Key Logic |
|----------|----------|-----------|
| Python | `from pkg.mod import X` → `pkg/mod.py` | Split on `.`, check `__init__.py`, handle relative (`.`/`..`) |
| Go | `import "module/pkg"` → parse `go.mod` for module name, strip prefix, resolve to dir | |
| Rust | `use crate::mod::Type` → `src/mod.rs` or `src/mod/mod.rs` | Handle `crate::`, `super::`, `self::` |
| Java | `import com.example.X` → `com/example/X.java` | Search `src/main/java/`, `src/` |
| C# | `using Namespace.X` → `Namespace/X.cs` | Convention-based |
| C/C++ | `#include "file.h"` → relative to source dir, project root | Skip `<system>` includes |
| Ruby | `require_relative './x'` → resolve + `.rb` | `require 'x'` → search `lib/` |
| PHP | `use App\Models\X` → parse `composer.json` PSR-4 map | `\` → `/` + `.php` |

Each resolver: ~30-50 lines. Each test: ~20-30 lines.

- [ ] **Step 1-8: Implement one resolver at a time with tests**
- [ ] **Step 9: Wire into indexer import edge creation**
- [ ] **Step 10: Commit**

---

### Task 17: Framework Plugins 2.0

**Fixes:** Flaws 7, 21, 51 (cross-boundary edges)
**Files:** `src/frameworks/plugins/` (new plugins), `src/frameworks/registry.ts`

**Priority order** (by framework popularity across 8 reviews):

| Priority | Plugin | Language | Pattern |
|----------|--------|----------|---------|
| 1 | FastAPI | Python | `@app.get("/path")` decorator |
| 2 | Django | Python | `urlpatterns` config → view function |
| 3 | Flask | Python | `@app.route("/path")` decorator |
| 4 | Spring Boot | Java | `@GetMapping`, `@PostMapping` annotations |
| 5 | ASP.NET | C# | `[HttpGet]`, `[Route]` attributes |
| 6 | Rails | Ruby | `routes.rb` DSL → controller actions |
| 7 | Gin/Echo | Go | `r.GET("/path", handler)` regex |
| 8 | Axum/Actix | Rust | `#[get("/path")]` attribute / `Router::route()` |
| 9 | Laravel | PHP | `Route::get("/path", [Controller, "method"])` |
| 10 | Celery/Sidekiq | Python/Ruby | `@shared_task` decorator / `perform` method |

Each plugin: ~40-80 lines using the decorator data from Task 15 (for languages with decorators) or regex extraction (for Go, Rails, Laravel).

- [ ] **Steps: Implement each plugin with test, register in registry.ts**
- [ ] **Final commit per 2-3 plugins**

---

## Part 3: Cross-Boundary Edge Synthesis

### Task 20: Cross-Language Event/IPC Edge Synthesis (UPGRADED — AST-Aware)

**Fixes:** Flaws 21, 51 + Nudgy IPC, Tauri invoke, HTTP flows
**Files:** `src/core/event-edge-synthesis.ts`, `src/core/queries/*.ts`

**Previous approach:** Regex patterns like `/(\w+)\s*<-\s/g`. **Problem:** Fragile, false-positive-prone, doesn't understand AST context.

**New approach:** Use tree-sitter queries scoped to each language for structured extraction, falling back to regex only where tree-sitter grammars don't expose the needed nodes.

#### Part A: AST-Aware Extraction

- [ ] **Step 1: Define language-specific event/IPC tree-sitter queries**

Add `eventQueries` to `LanguageQuerySet`:

```typescript
eventQueries?: string; // optional — extracts send/emit/publish patterns
```

**Go channels** (tree-sitter-go has `send_statement` and `receive_expression`):
```
(send_statement
  channel: (identifier) @channel
  value: (_) @value) @send

(receive_expression
  (unary_expression
    operand: (identifier) @channel)) @receive
```

**Rust tokio/crossbeam** (tree-sitter-rust matches method calls):
```
(call_expression
  function: (field_expression
    value: (identifier) @channel
    field: (field_identifier) @method (#match? @method "^(send|send_async)$"))) @send

(call_expression
  function: (field_expression
    value: (identifier) @channel
    field: (field_identifier) @method (#match? @method "^(recv|recv_async)$"))) @receive
```

**Python Django signals** (tree-sitter-python matches method calls):
```
(call
  function: (attribute
    object: (identifier) @signal
    attribute: (identifier) @method (#match? @method "^(send|send_robust)$"))) @send

(call
  function: (attribute
    object: (identifier) @signal
    attribute: (identifier) @method (#eq? @method "connect")))
  arguments: (argument_list (identifier) @handler)) @receive
```

**C# events** (tree-sitter-c-sharp):
```
(invocation_expression
  function: (member_access_expression
    expression: (conditional_access_expression
      (identifier) @event)
    name: (identifier) @method (#eq? @method "Invoke"))) @raise

(assignment_expression
  left: (identifier) @event
  operator: "+="
  right: (identifier) @handler) @subscribe
```

- [ ] **Step 2: Implement `parseEventPatterns` function**

```typescript
interface EventEdge {
  kind: "channel_send" | "channel_recv" | "signal_send" | "signal_connect"
       | "event_raise" | "event_subscribe" | "ipc_emit" | "ipc_listen";
  channelOrEventName: string;
  enclosingSymbol: string;
  line: number;
}

function parseEventPatterns(
  tree: Parser.Tree,
  language: string,
  lang: Parser.Language,
  symbols: ParsedSymbol[]
): EventEdge[] {
  // Use AST queries for structured languages
  // Fall back to regex only for Tauri invoke/listen patterns
  // (which are string-based and don't have dedicated AST nodes)
}
```

- [ ] **Step 3: Regex fallback ONLY for string-based IPC patterns**

Some IPC patterns are string-based and can't be extracted via tree-sitter structure:

```typescript
// Tauri IPC — regex is acceptable here because it matches string literals
const TAURI_EMIT = /emit_all?\s*\(\s*["']([^"']+)["']/g;
const TAURI_LISTEN = /listen\s*\(\s*["']([^"']+)["']/g;

// Spring @EventListener — handled by decorator extraction (Task 15)
// Java publishEvent — use AST: (method_invocation name: (identifier) @method (#eq? @method "publishEvent"))
```

#### Part B: Cross-File Edge Synthesis

- [ ] **Step 4: Build channel/event name → symbol maps across the codebase**

After all files are parsed, match senders to receivers by event name:

```typescript
function synthesizeEventEdges(
  db: Database.Database,
  allEventEdges: Map<number, EventEdge[]> // fileId → edges
): void {
  const sendersByEvent = new Map<string, Array<{ symbolId: number; fileId: number }>>();
  const receiversByEvent = new Map<string, Array<{ symbolId: number; fileId: number }>>();

  for (const [fileId, edges] of allEventEdges) {
    for (const edge of edges) {
      const symbolId = resolveEnclosingSymbol(db, fileId, edge.enclosingSymbol, edge.line);
      if (!symbolId) continue;

      if (edge.kind.includes("send") || edge.kind.includes("emit") || edge.kind.includes("raise")) {
        const bucket = sendersByEvent.get(edge.channelOrEventName) ?? [];
        bucket.push({ symbolId, fileId });
        sendersByEvent.set(edge.channelOrEventName, bucket);
      } else {
        const bucket = receiversByEvent.get(edge.channelOrEventName) ?? [];
        bucket.push({ symbolId, fileId });
        receiversByEvent.set(edge.channelOrEventName, bucket);
      }
    }
  }

  // Create synthetic edges: sender → receiver
  const edgeQ = edgeQueries(db);
  for (const [eventName, senders] of sendersByEvent) {
    const receivers = receiversByEvent.get(eventName) ?? [];
    for (const sender of senders) {
      for (const receiver of receivers) {
        if (sender.symbolId !== receiver.symbolId) {
          edgeQ.insert(sender.symbolId, receiver.symbolId, "event", Date.now());
        }
      }
    }
  }
}
```

- [ ] **Step 5: Wire into indexer post-processing**

Call `synthesizeEventEdges` after all files have been individually indexed, during the batch post-processing phase.

- [ ] **Step 6: Write cross-language event synthesis tests**

```typescript
describe("cross-language event synthesis", () => {
  it("connects Tauri emit to TypeScript listen", async () => {
    writeFileSync(join(root, "backend.rs"), `
      fn run_session(app: &AppHandle) {
        app.emit_all("gap_start", &payload);
      }
    `);
    writeFileSync(join(root, "frontend.tsx"), `
      export function GapOverlay() {
        listen('gap_start', (event) => { /* handle */ });
      }
    `);
    await indexProject(db, root);
    const edges = edgeQueries(db);
    const runSession = symbolQueries(db).getByName("run_session")[0];
    const gapOverlay = symbolQueries(db).getByName("GapOverlay")[0];
    const outgoing = edges.getBySource(runSession.id);
    expect(outgoing.some(e =>
      e.targetSymbolId === gapOverlay.id && e.kind === "event"
    )).toBe(true);
  });

  it("connects Go channel send to receive", async () => {
    writeFileSync(join(root, "producer.go"), `
      func produce(ch chan string) {
        ch <- "message"
      }
    `);
    writeFileSync(join(root, "consumer.go"), `
      func consume(ch chan string) {
        msg := <-ch
        process(msg)
      }
    `);
    await indexProject(db, root);
    // Verify event edge between produce → consume via channel name
  });

  it("connects Python Django signal send to connect", async () => {
    writeFileSync(join(root, "signals.py"), `
      from django.dispatch import Signal
      user_created = Signal()
    `);
    writeFileSync(join(root, "handlers.py"), `
      from .signals import user_created
      def send_welcome_email(sender, **kwargs):
        pass
      user_created.connect(send_welcome_email)
    `);
    writeFileSync(join(root, "views.py"), `
      from .signals import user_created
      def create_user(request):
        user_created.send(sender=User)
    `);
    await indexProject(db, root);
    // Verify event edge: create_user → send_welcome_email
  });
});
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(events): AST-aware cross-language event/IPC edge synthesis"
```

---

## Part 4: Semantic Recall + Tool Improvements

### Task 18: Recall Quality

**Fixes:** Flaws 10, 17, 37, 48, 68
**Files:** `src/memory/search.ts`

- [ ] **Step 1: Expand synonym map from 14 to 40+ entries**

Add domain-specific synonyms:

```typescript
const SYNONYM_MAP: Record<string, string[]> = {
  auth: ["authentication", "authorization", "login", "session", "jwt", "token", "oauth", "credentials", "password"],
  db: ["database", "sql", "query", "schema", "migration", "model", "repository", "orm", "table"],
  api: ["endpoint", "route", "handler", "controller", "rest", "graphql", "request", "response"],
  ui: ["component", "view", "template", "render", "layout", "page", "screen", "widget"],
  error: ["exception", "failure", "crash", "bug", "fault", "panic", "throw"],
  config: ["configuration", "settings", "environment", "options", "preferences"],
  cache: ["memoize", "store", "redis", "memcached", "ttl", "invalidate"],
  queue: ["job", "worker", "task", "background", "async", "celery", "sidekiq"],
  event: ["listener", "handler", "emit", "publish", "subscribe", "dispatch", "signal"],
  middleware: ["interceptor", "filter", "hook", "plugin", "pipe"],
  validation: ["validate", "sanitize", "check", "verify", "constraint", "rule", "guard"],
  state: ["store", "redux", "zustand", "context", "atom", "signal", "reactive"],
  // ... continue to 40+ entries
};
```

- [ ] **Step 2: Auto-populate observations from HIGH-confidence capsules**

After generating a capsule with confidence >= HIGH:

```typescript
if (metadata.quality.confidence === "HIGH" && coverageConfidence >= 0.70) {
  const insight = `[auto] ${query} → ${topSymbols.join(", ")} in ${topFiles.join(", ")}`;
  observationQueries(db).upsertByNote(sessionId, "capsule-insight", insight, coverageConfidence);
}
```

- [ ] **Step 3: Improve broad query handling**

When a query has >3 words and no camelCase, expand with synonyms and search with OR logic:

```typescript
if (isBroadQuery(query)) {
  const expanded = expandQueryWithSynonyms(query);
  const expandedResults = this.bm25.search(expanded.join(" "), limit);
  results = mergeResults(results, expandedResults);
}
```

- [ ] **Step 4: Test + commit**

---

### Task 19: Flow Completeness Overhaul (EXPANDED — Highest Priority Fix)

**Fixes:** Flaws 11, 13, 20, 44, 45, 70 + addresses the #1 weakness across ALL reviews
**Files:** `src/core/parser.ts`, `src/core/indexer.ts`, `src/mcp/tools/flow.ts`, `src/core/queries/*.ts`

**Why this is critical:** `cw_flow` scored 1-2/10 across 5 of 8 reviews. It returned "No outgoing flows found" for functions that clearly call other functions:
- `handleSubmit` → `submitComment` (lawn — same-file call, 0 results)
- `uploadFilesToProject` → `createVideo` (lawn — 4 API calls, 0 results)
- `run_session` → `emit_all`, `get_window`, `elapsed_ms` (Nudgy — method calls, 0 results)
- `_run_single_client` → download/verify/report (EBPS — only 1/4 branches found)

**Root cause analysis (verified in code):** The call extraction in `parser.ts` uses tree-sitter queries that match `(call_expression function: (identifier) @callee)` and `(call_expression function: (member_expression property: (property_identifier) @callee))`. These extract callee NAMES correctly. But edge resolution in `indexer.ts:pickTargets()` only finds targets if they are (1) local to the file, (2) imported by name, or (3) a global fallback by name. For method calls like `state.lock()` or `app.emit_all()`, the extracted callee name is `lock` or `emit_all` — which may not match any imported or local symbol name, producing NO edge.

This is a **three-part fix**: (A) verify call extraction completeness, (B) add method-receiver tracking for type-aware resolution, (C) fix flow path diversification.

#### Part A: Call Extraction Completeness Audit

- [ ] **Step 1: Write call extraction verification tests for all 12 languages**

For each language, create a test file with diverse call patterns and verify `parseCalls` extracts ALL of them:

```typescript
describe("call extraction completeness", () => {
  it("TypeScript: extracts all call patterns", async () => {
    const code = `
      import { Service } from "./service";
      export function handler() {
        const svc = new Service();
        svc.validate();           // member_expression → "validate"
        doSomething();            // direct call → "doSomething"
        await fetchData();        // await call → "fetchData"
        arr.map(transform);       // callback arg → "transform"
        const result = fn?.();    // optional call
        obj["method"]();          // computed access (may miss — document)
      }
    `;
    const result = parseFile(code, "typescript");
    const calleeNames = result.calls.map(c => c.calleeName);
    expect(calleeNames).toContain("validate");
    expect(calleeNames).toContain("doSomething");
    expect(calleeNames).toContain("fetchData");
    expect(calleeNames).toContain("map");
    // Document which patterns are NOT captured
  });

  it("Python: extracts method calls and function calls", async () => {
    const code = `
def handler():
    svc = Service()
    svc.validate()
    do_something()
    result = await fetch_data()
    items = list(map(transform, data))
    `;
    const result = parseFile(code, "python");
    const calleeNames = result.calls.map(c => c.calleeName);
    expect(calleeNames).toContain("validate");
    expect(calleeNames).toContain("do_something");
  });

  it("Go: extracts method calls on receivers", async () => {
    const code = `
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    s.validate(r)
    result := s.db.Query("SELECT *")
    fmt.Fprintf(w, result)
}
    `;
    const result = parseFile(code, "go");
    const calleeNames = result.calls.map(c => c.calleeName);
    expect(calleeNames).toContain("validate");
    expect(calleeNames).toContain("Query");
    expect(calleeNames).toContain("Fprintf");
  });

  it("Rust: extracts method calls and function calls", async () => {
    const code = `
impl Server {
    fn handle(&self) {
        self.validate();
        let result = db.query("SELECT *");
        emit_all("event", &payload);
    }
}
    `;
    const result = parseFile(code, "rust");
    const calleeNames = result.calls.map(c => c.calleeName);
    expect(calleeNames).toContain("validate");
    expect(calleeNames).toContain("query");
    expect(calleeNames).toContain("emit_all");
  });

  // Similar tests for Java, C#, Ruby, PHP, C, C++
});
```

- [ ] **Step 2: Fix any missing call extraction queries**

For each language where the verification test fails, update the tree-sitter call expression queries in `src/core/queries/<language>.ts`. Common patterns to check:

| Pattern | TS Query |
|---------|----------|
| `await foo()` | Should already match — verify |
| `foo?.()` | `(call_expression function: (optional_chain ...))` |
| `arr.map(callback)` | Extract `callback` as callee from argument position |
| `new Foo()` | `(new_expression constructor: (identifier) @callee)` |

For Go specifically, ensure the call query handles:
```
(call_expression function: (selector_expression field: (field_identifier) @callee))
```

For Rust, ensure:
```
(call_expression function: (field_expression field: (field_identifier) @callee))
(call_expression function: (scoped_identifier name: (identifier) @callee))
```

- [ ] **Step 3: Test + commit**

```bash
git commit -m "fix(parser): verify and fix call extraction for all 12 languages"
```

#### Part B: Method-Receiver Tracking (Type-Aware Edge Resolution)

- [ ] **Step 4: Add receiver/variable type tracking to ParseResult**

When parsing `const svc = new Service()` or `let s = SessionState::new()`, record the mapping `svc → Service`, `s → SessionState`. This enables resolving `svc.validate()` to `Service.validate`.

```typescript
export interface VariableTypeBinding {
  variableName: string;
  typeName: string;
  line: number;
}

// Add to ParseResult:
export interface ParseResult {
  // ... existing ...
  variableBindings?: VariableTypeBinding[];
}
```

- [ ] **Step 5: Extract variable-to-type bindings from AST**

For each language, extract `new X()`, constructor calls, and explicit type annotations:

```typescript
function parseVariableBindings(
  tree: Parser.Tree,
  language: string,
  lang: Parser.Language
): VariableTypeBinding[] {
  const bindings: VariableTypeBinding[] = [];

  // TypeScript/JavaScript:
  // const x = new Foo()  → x: Foo
  // const x: Foo = ...   → x: Foo
  // let x = Foo.create() → x: Foo (static factory)

  // Python:
  // x = Foo()            → x: Foo
  // x: Foo = ...         → x: Foo

  // Go:
  // x := NewFoo()        → x: Foo (by convention New<Type>)
  // var x Foo            → x: Foo

  // Rust:
  // let x = Foo::new()   → x: Foo
  // let x: Foo = ...     → x: Foo

  return bindings;
}
```

Language-specific tree-sitter queries:

**TypeScript/JavaScript:**
```
(variable_declarator
  name: (identifier) @var_name
  value: (new_expression
    constructor: (identifier) @type_name)) @binding

(variable_declarator
  name: (identifier) @var_name
  type: (type_annotation (type_identifier) @type_name)) @binding
```

**Python:**
```
(assignment
  left: (identifier) @var_name
  right: (call function: (identifier) @type_name)) @binding
```

**Go:**
```
(short_var_declaration
  left: (expression_list (identifier) @var_name)
  right: (expression_list (call_expression
    function: (identifier) @type_name))) @binding
```

**Rust:**
```
(let_declaration
  pattern: (identifier) @var_name
  value: (call_expression
    function: (scoped_identifier
      path: (identifier) @type_name
      name: (identifier) @_method))) @binding
```

- [ ] **Step 6: Use variable bindings in edge resolution**

In `indexer.ts:resolveEdges`, when resolving a method call like `svc.validate()`:

```typescript
// When calleeName is from a member_expression (e.g., "validate" from "svc.validate()"):
// 1. Check if we know the type of "svc" from variable bindings
// 2. If svc → Service, look for Service.validate in qualified names
// 3. Create edge to the resolved qualified symbol

for (const call of parseResult.calls) {
  if (call.receiverName && parseResult.variableBindings) {
    const binding = parseResult.variableBindings.find(
      b => b.variableName === call.receiverName
    );
    if (binding) {
      const qualifiedName = `${binding.typeName}.${call.calleeName}`;
      const qualified = symbols.getByQualifiedName(qualifiedName);
      if (qualified.length > 0) {
        // Create edge to qualified target — highest priority resolution
        for (const target of qualified.slice(0, MAX_EDGE_TARGETS_PER_REFERENCE)) {
          edges.insert(callerId, target.id, call.edgeKind ?? "call", now);
        }
        continue; // Skip fallback resolution
      }
    }
  }
  // ... existing resolution logic as fallback
}
```

- [ ] **Step 7: Add `receiverName` to call extraction**

Update `parseCalls` to record the receiver for member expressions:

```typescript
// When extracting from member_expression:
// obj.method() → calleeName: "method", receiverName: "obj"
const memberExpr = calleeCapture.node.parent;
if (memberExpr?.type === "member_expression") {
  const obj = memberExpr.childForFieldName("object");
  if (obj?.type === "identifier") {
    call.receiverName = obj.text;
  }
}
```

- [ ] **Step 8: Test method-receiver resolution**

```typescript
it("resolves method calls through variable bindings", async () => {
  writeFileSync(join(root, "service.ts"), `
    export class UserService {
      validate(input: string): boolean { return true; }
    }
  `);
  writeFileSync(join(root, "handler.ts"), `
    import { UserService } from "./service";
    export function handle() {
      const svc = new UserService();
      svc.validate("test");
    }
  `);
  await indexProject(db, root);
  const flow = buildFlowResult(db, "handle", undefined, 3);
  expect(flow.paths.some(p =>
    p.some(step => step.name.includes("validate"))
  )).toBe(true);
});
```

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(indexer): add method-receiver tracking for type-aware edge resolution"
```

#### Part C: Flow Path Diversification

- [ ] **Step 10: Implement first-hop diversification in traceOutgoing**

The EBPS review showed all 10 paths going through the extraction branch, missing download/verify/report. Fix by ensuring each direct callee of the source gets at least one traced path:

```typescript
function traceOutgoing(db, sourceId, maxHops): FlowStep[][] {
  const edges = edgeQueries(db);
  const firstHopEdges = edges.getBySource(sourceId);

  // Phase 1: Get one path per distinct first-hop target
  const pathsByFirstHop = new Map<number, FlowStep[][]>();
  for (const edge of firstHopEdges) {
    if (pathsByFirstHop.size >= MAX_PATHS) break;
    const subPaths = dfsFromNode(edge.targetSymbolId, maxHops - 1, 2); // limit per branch
    pathsByFirstHop.set(edge.targetSymbolId, subPaths);
  }

  // Phase 2: Collect paths, ensuring diversity
  const diversePaths: FlowStep[][] = [];
  for (const [hopId, paths] of pathsByFirstHop) {
    diversePaths.push(...paths.slice(0, Math.max(1, Math.floor(MAX_PATHS / pathsByFirstHop.size))));
  }

  // Phase 3: Fill remaining slots with highest-quality paths
  // ... existing quality scoring logic
  return diversePaths.slice(0, MAX_PATHS);
}
```

- [ ] **Step 11: Edge-kind quality scoring for path ranking**

```typescript
const FLOW_EDGE_QUALITY: Record<string, number> = {
  call: 1.0, dynamic_dispatch: 0.9, callback: 0.85,
  "server-action": 0.85, event: 0.8, jsx_render: 0.7,
  framework_entry: 0.7, implements: 0.6, inheritance: 0.6,
  type_usage: 0.3, import: 0.2, reexport: 0.1, reference: 0.1,
};
```

Score each path by average edge quality. Paths crossing file boundaries get +0.3 bonus. Sort by score descending.

- [ ] **Step 12: Filter import-only paths**

```typescript
paths = paths.filter(path =>
  path.some(step => step.edgeKind !== "import" && step.edgeKind !== "reexport")
);
```

- [ ] **Step 13: Verify incoming direction works (Flaw 45)**

Verify with a test. If it works, this flaw is already fixed — update documentation.

- [ ] **Step 14: Use qualified names in output**

Display `AuthService.validate` instead of just `validate` in flow step descriptions.

- [ ] **Step 15: Write flow completeness regression tests**

```typescript
describe("flow completeness", () => {
  it("traces all branches from a multi-call function", async () => {
    // Simulate EBPS: _run_single_client calls download, extract, verify, report
    writeFileSync(join(root, "pipeline.ts"), `
      import { download } from "./download";
      import { extract } from "./extract";
      import { verify } from "./verify";
      import { report } from "./report";
      export function runPipeline() {
        download();
        extract();
        verify();
        report();
      }
    `);
    // ... create the 4 target files
    await indexProject(db, root);
    const flow = buildFlowResult(db, "runPipeline", undefined, 2);
    const firstHops = flow.paths.map(p => p[0]?.name);
    expect(firstHops).toContain("download");
    expect(firstHops).toContain("extract");
    expect(firstHops).toContain("verify");
    expect(firstHops).toContain("report");
  });

  it("traces method calls through variable bindings", async () => {
    // Simulate Nudgy: run_session calls state.lock(), app.emit_all()
    // After Task 19B, these should produce edges
  });
});
```

- [ ] **Step 16: Test + commit**

```bash
git commit -m "fix(flow): add first-hop diversification, edge-kind scoring, method-receiver resolution"
```

---

### Task 21: Language-Balanced Scoring

**Fixes:** Flaw 55
**Files:** `src/capsule/generator.ts`

In Tauri apps (Rust+TS), capsules bias toward Rust because Rust has more explicit edges (no dynamic dispatch). Fix:

- [ ] **Step 1: Detect multi-language projects**

```typescript
const languageCounts = db.prepare(`
  SELECT language, COUNT(*) as cnt FROM files
  WHERE language NOT IN ('markdown', 'yaml', 'json', 'toml')
  GROUP BY language
`).all() as { language: string; cnt: number }[];

const isPolyglot = languageCounts.length >= 2;
```

- [ ] **Step 2: Apply language diversity in candidate selection**

When selecting candidates for a broad/task query in a polyglot project, ensure representation from all languages:

```typescript
if (isPolyglot && (intent === "broad" || intent === "task")) {
  const byLanguage = groupBy(candidates, c => c.file.language);
  // Ensure at least 1 candidate from each language with >10% of files
  for (const [lang, langCandidates] of byLanguage) {
    if (!selected.some(s => s.file.language === lang)) {
      const best = langCandidates.sort((a, b) => b.score - a.score)[0];
      if (best) selected.push(best);
    }
  }
}
```

- [ ] **Step 3: Add IPC boundary bonus**

When a file sits on a cross-language boundary (e.g., TS file calling Rust via Tauri invoke), boost its relevance:

```typescript
// If file has both incoming AND outgoing cross-language edges, it's a boundary file
if (hasIncomingFromLanguage(symbolId, "rust") && file.language === "typescript") {
  score *= 1.3; // IPC boundary boost
}
```

- [ ] **Step 4: Test + commit**

---

### Task 22: LSP Bridge — Type-Aware Edge Resolution (PROMOTED — Required for Augment Parity)

**Fixes:** Flaw 57 (Rust method resolution), closes the accuracy gap with Augment's Context Engine
**Files:** `src/core/lsp-bridge.ts` (new), `src/core/indexer.ts`

**Why this is required, not optional:** Augment's Context Engine has type-aware resolution built in. Without LSP, ContextWeave resolves `svc.validate()` by name-matching "validate" across the entire codebase — producing false edges or missing edges. Task 19B (method-receiver tracking) handles simple `const x = new Foo()` cases, but LSP handles ALL cases: generics, trait implementations, interface satisfaction, type narrowing, dynamic dispatch. This is the difference between "useful tool" and "competitive with Augment."

**Design:** The LSP bridge is opportunistic — it tries to connect to running language servers. If none are available, everything falls back gracefully to AST-based resolution. Zero configuration required from the user.

- [ ] **Step 1: Define LSP client interface**

```typescript
export interface LspBridge {
  isAvailable(language: string): boolean;
  resolveDefinition(filePath: string, line: number, column: number): Promise<{
    file: string;
    line: number;
    symbolName: string;
  } | null>;
  getReferences(filePath: string, line: number, column: number): Promise<Array<{
    file: string;
    line: number;
  }>>;
  shutdown(): Promise<void>;
}
```

- [ ] **Step 2: Implement LSP server detection and connection**

Detect running language servers or spawn them:

```typescript
interface LspServerConfig {
  language: string;
  command: string;
  args: string[];
  initOptions?: Record<string, unknown>;
  detectInstalled: () => boolean; // Check if binary exists
}

const LSP_SERVERS: LspServerConfig[] = [
  {
    language: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    detectInstalled: () => commandExists("typescript-language-server"),
  },
  {
    language: "python",
    command: "pyright-langserver",
    args: ["--stdio"],
    detectInstalled: () => commandExists("pyright-langserver") || commandExists("pylsp"),
  },
  {
    language: "go",
    command: "gopls",
    args: ["serve"],
    detectInstalled: () => commandExists("gopls"),
  },
  {
    language: "rust",
    command: "rust-analyzer",
    args: [],
    detectInstalled: () => commandExists("rust-analyzer"),
  },
];
```

Connection strategy:
1. Check if language server binary is installed (`which <command>`)
2. If installed, spawn via stdio with LSP protocol
3. Send `initialize` with project root
4. Cache the connection — reuse across the indexing session
5. Shutdown on indexing completion
6. If connection fails at any point, log warning and fall back to AST resolution

- [ ] **Step 3: Implement LSP definition resolution with batching**

For performance, batch all call sites in a file and resolve them in parallel:

```typescript
async function resolveCallEdgesViaLsp(
  lsp: LspBridge,
  filePath: string,
  calls: ParsedCall[],
  language: string
): Promise<Map<ParsedCall, { file: string; line: number; symbolName: string }>> {
  if (!lsp.isAvailable(language)) return new Map();

  const resolved = new Map();
  const batchSize = 20;

  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(call =>
        lsp.resolveDefinition(filePath, call.line, call.column ?? 0)
      )
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        resolved.set(batch[j], result.value);
      }
    }
  }

  return resolved;
}
```

- [ ] **Step 4: Use LSP in edge resolution as highest-priority resolver**

```typescript
// In resolveEdges(), before existing name-based resolution:
if (lspBridge?.isAvailable(language)) {
  const lspResolutions = await resolveCallEdgesViaLsp(
    lspBridge, filePath, parseResult.calls, language
  );

  for (const [call, resolution] of lspResolutions) {
    const targetFile = files.getByPath(relative(projectRoot, resolution.file));
    if (!targetFile) continue;
    const targetSymbols = symbols.getByFileId(targetFile.id)
      .filter(s => s.startLine === resolution.line || s.name === resolution.symbolName);
    if (targetSymbols.length > 0) {
      const callerId = resolveCallerId(call.callerSymbol, call.line);
      if (callerId) {
        edges.insert(callerId, targetSymbols[0].id, call.edgeKind ?? "call", now);
        lspResolvedCalls.add(call); // Track to skip fallback resolution
      }
    }
  }
}
// Fall back to qualified name resolution → name-only resolution for unresolved calls
```

- [ ] **Step 5: Add graceful degradation and metrics**

```typescript
// Track LSP resolution stats for diagnostics
interface LspStats {
  available: boolean;
  language: string;
  callsAttempted: number;
  callsResolved: number;
  connectionErrors: number;
  avgResolutionMs: number;
}

// Log stats after indexing each file:
logger.info("lsp-resolution", {
  file: filePath,
  attempted: stats.callsAttempted,
  resolved: stats.callsResolved,
  hitRate: `${((stats.callsResolved / stats.callsAttempted) * 100).toFixed(1)}%`,
});
```

- [ ] **Step 6: Add LSP status to cw_status output**

Show which language servers are connected:

```typescript
// In cw_status:
if (lspBridge) {
  sections.push("## LSP Servers");
  for (const lang of ["typescript", "python", "go", "rust"]) {
    const status = lspBridge.isAvailable(lang) ? "connected" : "not available";
    sections.push(`- ${lang}: ${status}`);
  }
}
```

- [ ] **Step 7: Write integration tests**

```typescript
describe("LSP bridge", () => {
  it("falls back gracefully when no LSP server available", async () => {
    const bridge = createLspBridge(projectRoot);
    // No language servers installed in test env
    expect(bridge.isAvailable("typescript")).toBe(false);
    // Indexing still works without LSP
    await indexProject(db, root);
    expect(symbolQueries(db).getAll().length).toBeGreaterThan(0);
  });

  // Integration test with actual language server (skip in CI):
  it.skipIf(!commandExists("typescript-language-server"))(
    "resolves TypeScript method calls via LSP", async () => {
      // ... test with actual tsserver
    }
  );
});
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(lsp): add LSP bridge for type-aware edge resolution"
```

---

## Part 5: Semantic Intelligence (Augment Parity)

### Task 25: Query Intent Classifier (NEW — Closes the Semantic Gap)

**Fixes:** The "error handling" → `handleTimestampClick` class of failures (lawn, EBPS), "authentication patterns" → sign-in CSS (lawn), all conceptual query failures
**Files:** `src/capsule/query-classifier.ts` (new), `src/capsule/generator.ts`

**Why this is essential for Augment parity:** Augment's Context Engine uses embeddings to understand that "error handling" means try/catch blocks, not functions with "handle" in their name. We can't match embedding quality without a model, but we CAN close 80% of the gap with a deterministic intent classifier that routes queries to different retrieval strategies.

**The problem:** BM25 matches "handle" in `handleTimestampClick` to "error handling." Path-based matching puts `auth/-sign-in.tsx` above `convex/auth.ts` for "authentication patterns." These are fundamentally different query types that need different retrieval strategies.

- [ ] **Step 1: Define query intent taxonomy**

```typescript
export type QueryIntent =
  | "symbol_lookup"      // "showToast function", "UserService class"
  | "flow_trace"         // "how does X reach Y", "trace from UI to API"
  | "architectural"      // "how does auth work", "error handling patterns"
  | "conceptual"         // "rate limiting", "state management"
  | "implementation"     // "where is X implemented", "how does X work internally"
  | "broad"              // "overview of the codebase", "all Tauri commands"
  ;

export interface ClassifiedQueryResult {
  intent: QueryIntent;
  confidence: number;
  symbolHints: string[];           // extracted symbol names from query
  conceptHints: string[];          // extracted concepts/patterns
  negativePatterns: string[];      // words that should NOT match literally
  retrievalStrategy: RetrievalStrategy;
}

export interface RetrievalStrategy {
  useSymbolNameMatching: boolean;  // Match by symbol name
  useFilePathMatching: boolean;    // Match by file path keywords
  useSummarySearch: boolean;       // Search file summaries
  usePatternDetection: boolean;    // Look for code patterns (try/catch, decorators)
  scoringWeights: {
    nameMatch: number;
    pathMatch: number;
    summaryMatch: number;
    centralityWeight: number;
  };
}
```

- [ ] **Step 2: Implement the classifier**

```typescript
export function classifyQueryIntent(query: string): ClassifiedQueryResult {
  const lower = query.toLowerCase();
  const tokens = lower.split(/\s+/);

  // Signal 1: Contains camelCase or PascalCase → symbol_lookup
  const hasCamelCase = /[a-z][A-Z]|^[A-Z][a-z]+[A-Z]/.test(query);
  const hasExactSymbol = /`[^`]+`|"[^"]+"/.test(query);

  // Signal 2: Contains flow/trace keywords → flow_trace
  const flowKeywords = ["flow", "trace", "from", "through", "to", "reaches", "calls", "chain", "path"];
  const hasFlowIntent = flowKeywords.filter(k => tokens.includes(k)).length >= 2;

  // Signal 3: Contains pattern/architecture keywords → architectural
  const archKeywords = ["pattern", "patterns", "architecture", "how does", "system", "design", "approach", "strategy"];
  const conceptKeywords = ["error handling", "authentication", "authorization", "rate limiting",
    "state management", "caching", "logging", "validation", "middleware", "routing"];
  const hasArchIntent = archKeywords.some(k => lower.includes(k));
  const hasConceptIntent = conceptKeywords.some(k => lower.includes(k));

  // Signal 4: Extract negative patterns — words that appear in the query
  // as concepts but should NOT be matched literally to symbol names
  const negativePatterns: string[] = [];
  if (lower.includes("error handling")) {
    // "handle" should NOT match handleTimestampClick, handleDragEnter, etc.
    negativePatterns.push("handle");
  }
  if (lower.includes("authentication") || lower.includes("authorization")) {
    // "auth" in path should NOT outweigh actual auth logic
    negativePatterns.push("sign-in", "sign-up", "login-page");
  }

  // Classify
  let intent: QueryIntent;
  if (hasCamelCase || hasExactSymbol) {
    intent = "symbol_lookup";
  } else if (hasFlowIntent) {
    intent = "flow_trace";
  } else if (hasArchIntent || hasConceptIntent) {
    intent = "architectural";
  } else if (tokens.length <= 3 && !hasFlowIntent) {
    intent = "conceptual";
  } else {
    intent = "broad";
  }

  // Build retrieval strategy based on intent
  const strategy = buildRetrievalStrategy(intent, negativePatterns);

  return {
    intent,
    confidence: 0.8, // heuristic-based
    symbolHints: extractSymbolHints(query),
    conceptHints: extractConceptHints(query),
    negativePatterns,
    retrievalStrategy: strategy,
  };
}

function buildRetrievalStrategy(intent: QueryIntent, negativePatterns: string[]): RetrievalStrategy {
  switch (intent) {
    case "symbol_lookup":
      return {
        useSymbolNameMatching: true,
        useFilePathMatching: false,
        useSummarySearch: false,
        usePatternDetection: false,
        scoringWeights: { nameMatch: 10, pathMatch: 0.5, summaryMatch: 1, centralityWeight: 0.3 },
      };

    case "architectural":
      return {
        useSymbolNameMatching: false,  // Don't match "handle" to handleTimestampClick
        useFilePathMatching: true,
        useSummarySearch: true,        // Search file summaries for concepts
        usePatternDetection: true,     // Look for try/catch, decorators, etc.
        scoringWeights: { nameMatch: 1, pathMatch: 3, summaryMatch: 5, centralityWeight: 1 },
      };

    case "conceptual":
      return {
        useSymbolNameMatching: true,
        useFilePathMatching: true,
        useSummarySearch: true,
        usePatternDetection: true,
        scoringWeights: { nameMatch: 3, pathMatch: 2, summaryMatch: 4, centralityWeight: 1 },
      };

    case "flow_trace":
      return {
        useSymbolNameMatching: true,
        useFilePathMatching: false,
        useSummarySearch: false,
        usePatternDetection: false,
        scoringWeights: { nameMatch: 8, pathMatch: 1, summaryMatch: 1, centralityWeight: 2 },
      };

    default:
      return {
        useSymbolNameMatching: true,
        useFilePathMatching: true,
        useSummarySearch: true,
        usePatternDetection: false,
        scoringWeights: { nameMatch: 4, pathMatch: 2, summaryMatch: 2, centralityWeight: 1 },
      };
  }
}
```

- [ ] **Step 3: Add pattern detection for architectural queries**

When the intent is "architectural" and the query mentions error handling, actually search for error-handling patterns:

```typescript
function detectCodePatterns(
  db: Database.Database,
  conceptHints: string[]
): Array<{ symbolId: number; pattern: string; score: number }> {
  const results: Array<{ symbolId: number; pattern: string; score: number }> = [];

  for (const concept of conceptHints) {
    switch (concept) {
      case "error handling":
        // Find functions containing try/catch, .catch(), throw, raise, panic
        // Use file summaries or grep the indexed content for these patterns
        const errorSymbols = db.prepare(`
          SELECT s.id, s.name, s.kind, f.path
          FROM symbols s JOIN files f ON s.file_id = f.id
          WHERE s.kind IN ('function', 'method', 'arrow')
          AND (s.signature LIKE '%Error%' OR s.signature LIKE '%Exception%'
               OR s.name LIKE '%Error%' OR s.name LIKE '%error%'
               OR s.name LIKE '%Exception%')
        `).all();
        for (const sym of errorSymbols) {
          results.push({ symbolId: sym.id, pattern: "error_handling", score: 5 });
        }
        break;

      case "authentication":
      case "authorization":
        // Find functions with auth-related logic, not auth UI pages
        const authSymbols = db.prepare(`
          SELECT s.id, s.name, s.kind, f.path
          FROM symbols s JOIN files f ON s.file_id = f.id
          WHERE s.is_exported = 1
          AND (s.name LIKE '%require%' OR s.name LIKE '%check%' OR s.name LIKE '%verify%'
               OR s.name LIKE '%assert%' OR s.name LIKE '%guard%' OR s.name LIKE '%auth%')
          AND s.kind IN ('function', 'method', 'arrow', 'class')
          AND f.path NOT LIKE '%sign-in%' AND f.path NOT LIKE '%sign-up%'
          AND f.path NOT LIKE '%login%page%'
        `).all();
        for (const sym of authSymbols) {
          results.push({ symbolId: sym.id, pattern: "auth_logic", score: 5 });
        }
        break;

      case "rate limiting":
        const rlSymbols = db.prepare(`
          SELECT s.id, s.name FROM symbols s
          WHERE s.name LIKE '%rateLimit%' OR s.name LIKE '%rate_limit%'
                OR s.name LIKE '%throttle%' OR s.name LIKE '%RateLimit%'
        `).all();
        for (const sym of rlSymbols) {
          results.push({ symbolId: sym.id, pattern: "rate_limiting", score: 8 });
        }
        break;

      // Add more concept patterns as needed
    }
  }

  return results;
}
```

- [ ] **Step 4: Wire classifier into the generator pipeline**

In `generator.ts`, replace the existing intent detection with the new classifier:

```typescript
// Early in the capsule generation pipeline:
const classified = classifyQueryIntent(query);

// Use classified.retrievalStrategy.scoringWeights in pivot scoring
// Use classified.negativePatterns to filter out false-positive name matches
// Use classified.intent to adjust confidence calculation
// If classified.intent === "architectural", add pattern detection results

if (classified.retrievalStrategy.usePatternDetection) {
  const patternHits = detectCodePatterns(db, classified.conceptHints);
  // Merge pattern hits into candidate list with their scores
  for (const hit of patternHits) {
    boostCandidate(hit.symbolId, hit.score);
  }
}

// Apply negative patterns to filter false positives
if (classified.negativePatterns.length > 0) {
  candidates = candidates.filter(c => {
    const name = c.symbol.name.toLowerCase();
    return !classified.negativePatterns.some(neg =>
      name.includes(neg) && !classified.symbolHints.some(h => name.includes(h.toLowerCase()))
    );
  });
}
```

- [ ] **Step 5: Add synonym-aware BM25 for conceptual queries**

Extend the existing BM25 search to expand conceptual queries with domain synonyms:

```typescript
// When intent is "architectural" or "conceptual":
if (classified.intent === "architectural" || classified.intent === "conceptual") {
  const expandedTerms = expandWithSynonyms(queryTerms, CONCEPT_SYNONYM_MAP);
  // Use expanded terms in BFS seed selection
  // This helps find "rateLimit" when searching for "throttle"
}

const CONCEPT_SYNONYM_MAP: Record<string, string[]> = {
  "error": ["exception", "throw", "catch", "panic", "raise", "fault", "failure"],
  "auth": ["authentication", "authorization", "permission", "role", "guard", "require"],
  "cache": ["memoize", "store", "ttl", "invalidate", "redis"],
  "validate": ["sanitize", "check", "verify", "constraint", "schema", "parse"],
  "state": ["store", "redux", "zustand", "context", "reactive", "signal"],
  "route": ["endpoint", "handler", "controller", "path", "url", "api"],
  "middleware": ["interceptor", "filter", "hook", "pipe", "guard"],
  "queue": ["job", "worker", "task", "background", "celery", "sidekiq", "bull"],
  "event": ["listener", "emit", "publish", "subscribe", "dispatch", "signal"],
  "test": ["spec", "fixture", "mock", "stub", "assert", "expect"],
};
```

- [ ] **Step 6: Write comprehensive classifier tests**

```typescript
describe("query intent classifier", () => {
  it("classifies camelCase queries as symbol_lookup", () => {
    const result = classifyQueryIntent("showToast function definition");
    expect(result.intent).toBe("symbol_lookup");
  });

  it("classifies flow queries correctly", () => {
    const result = classifyQueryIntent("trace from UI form through API to database");
    expect(result.intent).toBe("flow_trace");
  });

  it("classifies architectural pattern queries", () => {
    const result = classifyQueryIntent("error handling patterns across the application");
    expect(result.intent).toBe("architectural");
    expect(result.negativePatterns).toContain("handle");
    expect(result.retrievalStrategy.usePatternDetection).toBe(true);
  });

  it("classifies auth queries and excludes UI pages", () => {
    const result = classifyQueryIntent("authentication and authorization patterns");
    expect(result.intent).toBe("architectural");
    expect(result.retrievalStrategy.useSymbolNameMatching).toBe(false);
    expect(result.retrievalStrategy.useSummarySearch).toBe(true);
  });

  it("classifies conceptual queries", () => {
    const result = classifyQueryIntent("rate limiting");
    expect(result.intent).toBe("conceptual");
  });

  it("classifies broad queries", () => {
    const result = classifyQueryIntent("all Tauri commands and their parameters");
    expect(result.intent).toBe("broad");
  });
});

describe("pattern detection", () => {
  it("finds error handling functions, not handle* functions", async () => {
    // Create test fixtures with:
    // - handleTimestampClick (NOT error handling)
    // - handleDragEnter (NOT error handling)
    // - ErrorBoundary (IS error handling)
    // - checkRateLimitOrThrow (IS error handling)
    // - tryCatchWrapper (IS error handling)
    await indexProject(db, root);

    const patterns = detectCodePatterns(db, ["error handling"]);
    const names = patterns.map(p => symbolQueries(db).getById(p.symbolId)?.name);

    expect(names).toContain("ErrorBoundary");
    expect(names).toContain("checkRateLimitOrThrow");
    expect(names).not.toContain("handleTimestampClick");
    expect(names).not.toContain("handleDragEnter");
  });
});
```

- [ ] **Step 7: Test + commit**

```bash
npx vitest run tests/capsule/ tests/integration/ -v
git commit -m "feat(capsule): add query intent classifier for semantic-aware retrieval"
```

---

## Part 6: Verification

### Task 23: Multi-Language Test Fixture

**Files:** `bench/scenarios/polyglot-fullstack/` (new)

Create a small polyglot project with:
- TypeScript (Next.js frontend with JSX callbacks)
- Python (FastAPI backend with decorators)
- Go (gRPC service with interface satisfaction)
- Rust (Tauri commands with impl blocks)

~20 files total, testing cross-boundary flow, qualified names, decorator detection, and module resolution.

- [ ] **Step 1: Create fixture files**
- [ ] **Step 2: Write integration tests**
- [ ] **Step 3: Commit**

---

### Task 24: Re-Run All 8 Project Reviews

- [ ] **Step 1: Re-index each of the 8 projects**
- [ ] **Step 2: Run the same queries that found flaws**
- [ ] **Step 3: Verify each flaw is resolved**
- [ ] **Step 4: Update quality-baseline.json**
- [ ] **Step 5: Final commit + push**

---

## Execution Order

### Wave 0 — Immediate (before anything else, 5 minutes)
Task 0: Fix `.qa-temp-probes/` exclusion. This is actively degrading results now.

### Wave 1 — Systemic Fixes (no dependencies, highest ROI)
Tasks 1-11, 6.5 in parallel. These fix the root causes that affect ALL languages.
Task 6.5 (pre-pack gate) is the single highest-ROI fix — do it early in the wave.

### Wave 2 — Language-Universal Resolution (depends on schema migration)
Tasks 12-16 sequentially (schema → parser → edge resolution → decorators → resolvers)

### Wave 3 — Flow + Cross-Boundary (depends on schema + parser changes)
Tasks 19 (expanded — flow completeness overhaul), 20 (upgraded — AST-aware events)
Task 19 Parts A-C are sequential (audit → receiver tracking → diversification).
Task 20 can run in parallel with Task 19 Part C.

### Wave 4 — Plugins + Semantic Intelligence
Tasks 17 (framework plugins), 25 (query intent classifier) in parallel.
Task 25 depends on nothing — it's a new module with its own tests.
Task 17 depends on Task 15 (decorators from Wave 2).

### Wave 5 — Recall + LSP + Scoring
Tasks 18 (recall quality), 21 (language-balanced scoring), 22 (LSP bridge) in parallel.
Task 22 is now REQUIRED, not optional — it's the key Augment parity feature.
LSP bridge is self-contained and can be tested independently.

### Wave 6 — Verification
Tasks 23 (polyglot test fixture), 24 (re-run all 8 project reviews)

---

## Success Criteria

After all tasks complete:

| Metric | Current | Target | Augment Parity? |
|--------|---------|--------|-----------------|
| Tests passing | 931 | 1150+ (new tests added) | N/A |
| TypeScript errors | 0 | 0 | N/A |
| Review flaws fixed | 35/88 (40%) | 87/88 (99%) | N/A |
| Languages with qualified names | 0 | 12 | Matches |
| Languages with decorator support | 0 | 6 | Matches |
| Languages with module resolution | 2 (JS/TS) | 10 | Matches |
| Framework plugins | 3 (Next/Express/Convex) | 13 | Matches |
| Confidence accuracy (precision) | ~0.40 | 0.60+ | Close |
| Budget utilization (broad 8k) | 14-31% | 75%+ | Close |
| Noise ratio (irrelevant symbols in capsule) | 40-70% | <15% | Matches |
| Flow tracing success rate | 10-20% | 70%+ | Close |
| Flow: same-file direct calls | Broken | 100% | Matches |
| Flow: method calls via variable | 0% | 60%+ | Close (LSP: 90%+) |
| Flow: cross-boundary (IPC/events) | 0% | 50%+ | Ahead (unique feature) |
| Recall hit rate | ~20% | 60%+ | Close |
| Conceptual query accuracy | ~10% | 50%+ | Closing gap |
| Stats savings claim accuracy | 0% (inflated) | removed (factual only) | Honest |
| LSP servers supported | 0 | 4 (TS/Py/Go/Rust) | Matches |
| Query intent classification | None | 6 intent types | Ahead (unique) |

### Augment Context Engine Comparison (Post-Plan)

| Capability | ContextWeave (after plan) | Augment |
|---|---|---|
| Precise symbol lookup | Strong (9/10) | Strong |
| Impact analysis | Excellent (best-in-class) | Comparable |
| Cross-file flow tracing | Strong with LSP (7/10) | Strong |
| Broad/architectural queries | Good with intent classifier (6/10) | Strong (embeddings) |
| Cross-language boundaries | Strong (event synthesis) | Unknown |
| Multi-language support | 12 languages | All major |
| Semantic understanding | Intent classifier + synonyms (no embeddings) | Embeddings |
| Type-aware resolution | LSP bridge (opportunistic) | Built-in |
| Token-budgeted output | Unique feature — designed for LLM consumption | No equivalent |
| Local-first / privacy | Unique feature — zero cloud | Cloud-based |

### 1 Flaw Intentionally Deferred (1/88)
| Flaw | Reason |
|------|--------|
| Flaw 84 (full cross-encoder reranking) | Requires ML model; lightweight validation pass + intent classifier substituted |

**Note:** Flaws 57 (Rust method resolution) and 88 (benchmark severity) are now addressed by Task 22 (LSP bridge) and Task 25 (intent classifier) respectively. Previously deferred, now covered.
