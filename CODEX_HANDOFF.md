# ContextWeave v2 — Implementation Handoff

## What Is ContextWeave

ContextWeave is a local-first MCP server that gives AI coding agents (Claude Code, Cursor, Codex, etc.) precise, token-budgeted code context — so they stop grepping endlessly and burning 20,000-50,000 tokens on blind exploration.

It is an open-source alternative to Augment's Context Engine. Same architecture (AST parsing + embeddings + hybrid search + knowledge graph), but 100% local, free, and private — no code leaves your machine.

**The value proposition:** One `cw_capsule` call costs 3,000-5,000 tokens and returns the right code. An Explorer Agent doing grep-read-grep-read costs 20,000-50,000 tokens for the same answer. That's 60-70% real token savings, and faster results with higher confidence.

**Stack:** TypeScript ESM, Node 22, tree-sitter (12 languages), better-sqlite3, MCP SDK (stdio), @huggingface/transformers (local all-MiniLM-L6-v2 embeddings), sqlite-vec (vector similarity search), code-chunk (AST-aware chunking).

---

## What's Already Built (Phases 1-4, ~90-95% complete)

These are shipped and functional. Do NOT rebuild them:

- **AST-aware chunking** (Phase 1): `src/core/chunker.ts` uses `code-chunk` to split code at function/class boundaries with scope chains, imports, and sibling signatures baked in. Chunks stored in `chunks` table.
- **Local embedding pipeline** (Phase 2): `src/core/embedder.ts` runs `all-MiniLM-L6-v2` locally via ONNX (384-dim, q8 quantized). `src/core/vector-store.ts` stores vectors in sqlite-vec. No API keys, no cloud.
- **Hybrid search with RRF** (Phase 3): `src/core/hybrid-ranker.ts` fuses three signals via Reciprocal Rank Fusion — BM25 (weight 1), vector similarity (weight 1), exact symbol-name match (weight 2), K=60. Recency boost for recently-modified files.
- **Capsule pipeline overhaul** (Phase 4): Rewritten intent classifier (5 semantic intents: symbol-lookup, narrow, broad, debug, task), graph expansion after hybrid search (top 10 seeds → up to 20 neighbors via edge walk), structured JSON output (`StructuredCapsuleOutput`), file-qualified follow-ups, query-aware follow-up ranking.

---

## How Augment Works (What We're Matching)

From reverse-engineering their blog posts, SDK docs, co-founder interviews, and architecture descriptions (see `research/augment-vs-contextweave.md` for full sourced analysis):

1. **Semantic embeddings** — code chunks become vectors that capture meaning. "authentication logic" finds `verifyCredentials()` even without the word "authentication."
2. **AST-aware chunking** — splits at function/class boundaries, enriches each chunk with scope chain + imports + siblings before embedding.
3. **Hybrid search (BM25 + vector + RRF)** — keyword precision + semantic recall, fused with Reciprocal Rank Fusion.
4. **Knowledge graph expansion** — vector search finds starting points, then graph traversal finds connected context (callers, callees, type relationships).
5. **Pattern detection** — learns "every dashboard page follows pattern X" from structural analysis.

ContextWeave has #1-4 implemented. What's missing: completing the bug fixes that make retrieval reliable, building the intelligence layer (#5 and deeper features), and production hardening.

---

## What's Left to Build

### Current Repo State

Run `git status` first. As of the last inspection, there are unstaged modifications in 5 files implementing Phase 4 features:
- `src/capsule/formatter.ts` (query-aware follow-up ranking, `buildStructuredOutput`)
- `src/capsule/generator.ts` (graph expansion, structured output wiring, hybrid search integration)
- `src/capsule/intent-classifier.ts` (5 semantic intents replacing word-count heuristic)
- `src/core/types.ts` (`StructuredCapsuleOutput`, `StructuredCapsuleFile`, `StructuredCapsuleSuggestedRead`)
- `src/mcp/tools/capsule.ts` (structured output surfaced via MCP response)
- `package-lock.json` (dependency updates)

**If these changes exist:** Stage them and commit: `feat(capsule): structured output, semantic intents, graph expansion`
**If the repo is clean:** Skip this step and proceed directly to Phase 0.

---

## PHASE 0: Critical Bug Fixes (6 remaining items)

These fix specific flaws found in 5 real-world field reviews. Each one has a named file, exact logic, and acceptance test.

### 0.1 — Symbol-Name Exact Boost — MISSING

**File:** `src/capsule/pivot-scorer.ts`
**Existing test file:** `tests/capsule/pivot-scorer.test.ts`

**Problem:** When a user queries "useDataLayer", the exact symbol `useDataLayer` doesn't reliably rank #1. A high-centrality neighbor function in the same file can outscore it. Found in 4 of 5 field reviews.

**Implementation:**

In `scorePivotRelevance()`, add an exact-match detection step before the existing scoring logic:

1. For each pivot candidate, check if `candidate.name` case-insensitively equals any query term
2. Also check if `candidate.name` matches after camelCase splitting (e.g., `useDataLayer` should match query terms `["use", "data", "layer"]` and the full query `"useDataLayer"`)
3. Apply additive flat boosts to the final score:
   - Exact name match (case-insensitive): **+50**
   - CamelCase-split match (all split terms present in query): **+25**
   - File path contains a query term as a path segment: **+10**
4. Set a boolean flag `exactNameMatch: true` on the scored pivot result object when any boost fires. This flag is consumed by 0.2 below.

**Acceptance:** Query "useDataLayer" returns the `useDataLayer` symbol definition as result #1, regardless of PageRank or centrality scores of neighboring symbols.

**Test to add:** In `tests/capsule/pivot-scorer.test.ts`, create a test where `useDataLayer` has lower centrality than a neighbor function, verify it still ranks #1 after the boost.

### 0.2 — Kill Content Fallback for Exact Matches — MISSING

**File:** `src/capsule/generator.ts`

**Problem:** When < 3 pivots are found, the generator triggers `contentFallbackSearch()` which injects 90+ extra symbols from 10 files, drowning the exact match the user asked for. Found in Codex and Claud-ometer reviews.

**Implementation:**

Find the content fallback gate (currently `if (rawPivotIds.size < 3 && !hybridSearchEnabled)`). Add a preceding check:

```
if at least one pivot in the scored set has exactNameMatch === true:
  - Skip contentFallbackSearch() entirely
  - Instead, enrich the result with:
    1. The matched symbol's full_source
    2. Its direct callers (SELECT from edges WHERE target_id = symbolId AND kind IN ('call', 'import'))
    3. Its direct callees (SELECT from edges WHERE source_id = symbolId AND kind IN ('call', 'import'))
  - This produces a focused, precise capsule for narrow queries
```

**Depends on:** 0.1 (needs the `exactNameMatch` flag)

**Acceptance:** Query "recommendFanout" on a codebase returns only that function + its direct callers/callees. No 90-pivot explosion.

### 0.3 — Fill Token Budget to 85% — PARTIAL

**Files:** `src/capsule/packer.ts`, `src/capsule/generator.ts`
**Existing test file:** `tests/capsule/story-packing.test.ts`

**Problem:** Budget 8,000 tokens requested, capsule returns 468 (6% utilization). Found in all 5 reviews. The `>= 2000` refill gate and conservative skeletonization are the cause.

**What already exists:** A promotion pass in the packer that upgrades L3 compressed nodes to better compression levels. A refill pass in generator.ts that adds more candidates when utilization is below 60% for broad/task queries.

**What's missing — add to `packer.ts`:**

After the existing promotion pass, add an iterative budget-filling loop:
```
while utilization < 0.85 AND there are packed symbols at skeleton/compressed level:
  1. Take the next highest-scored symbol that is currently skeletonized
  2. Replace its skeleton representation with full_source
  3. Recalculate utilization = tokensUsed / tokenBudget
while utilization < 0.85 AND there are adjacent-file symbols NOT yet included:
  1. Add them at skeleton compression level
  2. Recalculate utilization
```

**What's missing — fix in `generator.ts`:**

Lower the refill gate from `tokenBudget >= 2000` to `tokenBudget >= 500` so small budgets also get filled.

**Acceptance:** Budget 8000 query on any codebase returns >= 5000 tokens of content (>60% utilization).

### 0.4 — Confidence Calibration Tightening — PARTIAL

**File:** `src/capsule/confidence.ts`
**Existing test file:** `tests/unit/confidence-calibration.test.ts`

**Problem:** Reports HIGH confidence when retrieval is thin. Found in all 5 reviews. The existing caps are gated on `thinRetrieval && intent !== "narrow"`, allowing escape.

**What to fix:**
1. Make `tokenUtilization` a **required** field in `ConfidenceParams` (remove the `?` optional marker)
2. Apply these caps **unconditionally for ALL intents** (remove the `thinRetrieval` and `intent !== "narrow"` gates):
   - `tokenUtilization < 0.30` → cap confidence at 0.40 (LOW)
   - `tokenUtilization < 0.50` → cap confidence at 0.60 (MEDIUM)
3. Hard ceiling: **never** return > 0.90 unless `tokenUtilization > 0.60 AND pivotCoverage > 0.60`. Remove the `compactButGrounded` escape hatch that currently allows bypassing this.
4. Update all callers of `computeCoverageConfidence` to pass `tokenUtilization` as required.

**Acceptance:** A query that uses 320/1800 tokens (18% utilization) never reports HIGH confidence. Reports MEDIUM or LOW.

### 0.5 — Directory Weighting Completion — PARTIAL

**File:** `src/utils/directory-weights.ts`
**Existing test file:** `tests/unit/directory-costs.test.ts`

**Problem:** `src/main/resources/static/` ranked same as `src/main/java/`. Legacy and build output dirs pollute results. Found in KisanSathi and Sitecraft reviews.

**What exists:** Downweights for legacy, demo, vendor, docs, mocks, tests.

**What to add:**

1. **Missing downweight patterns:**
   - `resources/static/*`: 0.2
   - `assets/*`: 0.3
   - `public/*`: 0.3
   - `dist/*`, `build/*`, `out/*`, `.next/*`: 0.1

2. **Upweight patterns (new capability — the function currently only returns <= 1.0):**
   Modify the function to return values > 1.0 for high-signal directories:
   - `src/main/java/*`: 1.5 (Java/Spring repos)
   - `src/app/*`, `src/lib/*`, `src/core/*`: 1.5 (Next.js/React)
   - `packages/*`, `libs/*`: 1.3 (monorepos)

3. **Config-driven overrides:**
   Support `.contextweave/config.json` fields `primaryDirs` (string array, upweight 1.5) and `archiveDirs` (string array, downweight 0.1). Load via existing `src/utils/config.ts`.

**Acceptance:** Broad query on a Java/Spring project returns `src/main/java/` controller files, not `resources/static/` JS bundle files.

### 0.6 — TSX Parser Tolerance — MISSING

**File:** `src/core/parser.ts`
**Existing test file:** `tests/unit/parser.test.ts`

**Problem:** Valid TSX files with `&` in JSX text (like `&amp;`, `Terms & Conditions`) trigger tree-sitter ERROR nodes. The parser marks these files as having syntax errors, which lowers their confidence and can exclude their symbols. Found in FocusPact and Claud-ometer reviews.

**Implementation:**

After the existing `if (tree.rootNode.hasError)` block (~line 1278), add a classification pass:

```
1. Walk the tree, collect all nodes where node.type === 'ERROR'
2. For each ERROR node, check if parent.type is one of:
   'jsx_text', 'jsx_expression', 'jsx_attribute', 'jsx_self_closing_element'
3. If ALL error nodes have a JSX parent type:
   - Classify as "benign parse warning"
   - Set file error to null (not broken)
   - Continue extracting all symbols normally
4. If ANY error node has a non-JSX parent type:
   - Keep existing error behavior ("Syntax errors detected in {filePath}")
```

**Acceptance:** A TSX file containing `<p>Terms & Conditions</p>` is NOT flagged as having syntax errors. All its symbols are extracted normally.

---

## PHASE 5: Intelligence Layer (almost entirely missing)

This is what makes ContextWeave go beyond search into real code understanding — matching what makes Augment feel "magical."

### 5.1 — Pattern Detection Engine — MISSING

**New file to create:** `src/core/pattern-detector.ts`
**New test file:** `tests/core/pattern-detector.test.ts`

**What it does:** Finds structural patterns across files. When 3+ files share the same import shape, export shape, hook usage, and directory pattern, that's a detected pattern. This lets the capsule say "all files in `src/app/*/page.tsx` follow this pattern" without showing every file.

**Interfaces:**
```typescript
export interface CodePattern {
  id: string;                     // SHA-256 hash of the signature
  name: string;                   // e.g., "Dashboard Page Pattern"
  description: string;            // "imports useDataLayer, exports default function, uses useState/useEffect"
  files: string[];                // file paths following this pattern
  confidence: number;             // higher with more instances (3 files = 0.6, 5+ = 0.9)
  signature: PatternSignature;
}

export interface PatternSignature {
  importShape: string[];          // sorted list of import sources
  exportShape: string[];          // kinds of exports (function, class, const, default)
  hookUsage: string[];            // React hooks used (useState, useEffect, useRouter, etc.)
  symbolKinds: string[];          // kinds of symbols defined
  directoryPattern: string;       // e.g., "src/app/*/page.tsx"
}

export function detectPatterns(db: Database): CodePattern[]
```

**Logic:**
1. For each file in the `files` table, query its symbols and edges to compute a `PatternSignature`
2. Hash each signature: `createHash('sha256').update(JSON.stringify(sortedSignature)).digest('hex')`
3. Group files by hash
4. Groups with 3+ files become a `CodePattern`. Name it based on directory pattern + dominant imports.
5. Store in a new `patterns` table — add DB migration:
```sql
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  files TEXT NOT NULL,
  signature TEXT NOT NULL,
  confidence REAL NOT NULL,
  detected_at INTEGER NOT NULL
);
```
6. Call `detectPatterns()` after `indexProject()` completes in `src/core/indexer.ts`
7. In `src/capsule/formatter.ts`: when a broad query's results overlap with a pattern's files, include the pattern description in the capsule output

**Tests:** 3+ files with same import/export shape are grouped. Pattern naming works. < 3 files are not grouped. Pattern is included in capsule output for matching broad queries.

### 5.2 — Body-Aware File Summaries — PARTIAL

**File:** `src/core/file-summaries.ts`

**Problem:** File summaries only contain path tokens, symbol names, signatures, and kinds. They don't index string literals, JSX text, SQL table names, or API calls. This is why `cw_overview("realtime supabase session")` returns nothing even though the code uses `supabase.from("sessions")`.

**What to add to `buildSummaryText()`:** For each symbol's `full_source` in the file, extract and append:

1. **String literals:** Quoted strings > 4 chars. Regex: `/(["'])(?:(?!\1).){4,}?\1/g`. Captures API endpoints, table names, channel names.
2. **JSX text content:** Text inside JSX elements. Simple regex: `/>([^<]{4,})</g` for extractable text.
3. **SQL identifiers:** Table names after FROM/INTO/UPDATE/JOIN. Regex: `/\b(?:FROM|INTO|UPDATE|JOIN)\s+[`"]?(\w+)[`"]?/gi`
4. **Important function calls:** Callee names from: `fetch(`, `supabase.from(`, `prisma.`, `axios.`, `console.`. Regex: `/\b(fetch|axios\.\w+|supabase\.from|prisma\.\w+)\s*\(/g`
5. **Route paths:** String args from decorators/handlers: `@Get("...")`, `@Post("...")`, `app.get("..."`. Regex: `/(?:@(?:Get|Post|Put|Delete|Patch)|app\.(?:get|post|put|delete))\s*\(\s*["']([^"']+)["']/g`
6. **Environment variables:** `process.env.VARIABLE_NAME` references. Regex: `/process\.env\.(\w+)/g`

**DB changes:** Add `body_features TEXT DEFAULT ''` column to `file_summaries` table (migration). Store extracted features as space-separated tokens. Include `body_features` in the FTS index rebuild.

**Tests:** File with `supabase.from("sessions")` has "sessions" and "supabase" in body_features. File with `<h1>Welcome to Dashboard</h1>` has "Welcome to Dashboard" indexed. File with `process.env.DATABASE_URL` has "DATABASE_URL" indexed.

### 5.3 — IDF-Style Term Suppression — MISSING

**File:** `src/capsule/query-decomposer.ts`

**Problem:** Common code words like "get", "page", "query", "route" contaminate ranking because they appear in nearly every file. The current `STOP_WORDS` set only filters natural-language function words ("a", "the", "in"), not high-frequency code terms.

**What to add:**

1. New function:
```typescript
export function computeTermIDF(db: Database, terms: string[]): Map<string, number>
```
   - For each term, query: `SELECT COUNT(DISTINCT file_id) FROM symbols WHERE LOWER(name) LIKE '%' || LOWER(?) || '%'`
   - Get total file count: `SELECT COUNT(*) FROM files`
   - Compute: `IDF = Math.log(totalFiles / (1 + filesContainingTerm))`

2. In `decomposeQuery()`, after extracting and sanitizing terms, call `computeTermIDF()` and attach IDF weights to each term in the returned result. Add an `idfWeights: Map<string, number>` field to the return type.

3. Thread IDF weights through to consumers:
   - In `src/capsule/pivot-scorer.ts`: multiply each term's contribution to the name/signature score by its IDF weight
   - In `src/core/hybrid-ranker.ts`: when building BM25 query terms, weight high-IDF terms higher
   - Terms with IDF < 0.5 (appear in >60% of files) should have their scoring contribution halved

**Tests:** In a test codebase where 80% of files have a `get*` function, the term "get" gets IDF < 0.5 and is suppressed. The term "validateEmail" (appearing in 1 file) gets high IDF and is boosted. A query "getValidateEmail" ranks the `validateEmail` symbol above any `getSomething` function.

### 5.4 — Improved Flow Tracing — MISSING

**Files:** `src/core/indexer.ts` (edge creation), `src/mcp/tools/flow.ts` (traversal), `src/core/types.ts` (EdgeKind)

**Problem:** `cw_flow` does basic BFS over call/import edges only. It can't trace callbacks, server actions, or route handlers. The tool itself documents this: "Prop callbacks, higher-order functions, and dynamic dispatch patterns may be missing."

**What to add in `src/core/types.ts`:**
Add to the `EdgeKind` type: `'callback' | 'server-action' | 'route-handler'`

**What to add in `src/core/indexer.ts` (during tree-sitter AST traversal):**

1. **Import resolution:** When creating an import edge for `import { foo } from './bar'`, resolve to the specific exported symbol `foo` in `bar.ts` (not just the file). Use existing `src/utils/tsconfig-paths.ts` for alias resolution.

2. **Callback tracking:** Detect when a function identifier is passed as an argument:
   - Function call: `someFunction(myHandler)` → create `callback` edge from `someFunction` to `myHandler`
   - JSX prop: `<Component onClick={handleClick} />` → create `callback` edge from JSX component render to `handleClick`
   - Detection: in call_expression nodes, check if any argument is an identifier that resolves to a known symbol

3. **Server action / route handler edges:**
   - Next.js: if a function's body starts with `'use server'` string literal → create `server-action` edge
   - Express: `app.get('/path', handler)` → create `route-handler` edge from the route to the handler function
   - Detection: look for call expressions where callee is `app.get/post/put/delete` and second+ arg is a function identifier

**What to add in `src/mcp/tools/flow.ts`:**
1. Include `callback`, `server-action`, and `route-handler` edge kinds in the BFS traversal
2. Apply 0.7x weight to these edges (lower confidence than direct call edges)
3. Show edge type in output: `"handleClick ──[callback]──> validateForm"`

**Tests:** Test that `onClick={handleClick}` creates a callback edge. Test that `app.get('/users', listUsers)` creates a route-handler edge. Test that flow tracing follows these edges with correct types shown.

### 5.5 — Observation Promotion — MISSING

**File:** `src/memory/observations.ts`

**Problem:** All observations have equal weight. A doc quote stored during bootstrap and a pattern learned across 10 sessions rank the same. There's no mechanism to promote frequently-relevant observations or demote stale ones.

**What to add:**

1. **DB migration:** Add `hit_count INTEGER DEFAULT 0` and `last_hit_at INTEGER` columns to the `observations` table.

2. **Hit tracking:** In `src/capsule/formatter.ts`, in the `selectObservations()` function, after selecting matching observations, increment `hit_count` and set `last_hit_at = Date.now()` for each matched observation:
   ```sql
   UPDATE observations SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?
   ```

3. **Promotion function** in `observations.ts`:
   ```typescript
   export function promoteFrequentObservations(db: Database): number
   ```
   - Find observations where `hit_count >= 3 AND scope != 'convention'`
   - Set `scope = 'convention'`, `confidence = 0.9`
   - Return count of promoted observations

4. **Demotion function** in `observations.ts`:
   ```typescript
   export function demoteStaleObservations(db: Database): number
   ```
   - Find observations where `last_hit_at < (now - 30 days)` OR (`last_hit_at IS NULL AND created_at < (now - 30 days)`)
   - Reduce confidence by 0.1 per 30-day stale period
   - Soft-delete (set `archived = 1` or just delete) if confidence drops below 0.1
   - Return count of demoted observations

5. **Wire into startup:** Call both functions in `scheduleDerivedDataBackfill()` in `src/mcp/server.ts`

**Tests:** Observation with 3 hits gets promoted to convention scope with confidence 0.9. Observation with no hits for 30+ days gets confidence reduced. Observation below 0.1 confidence gets archived.

---

## PHASE 6: Operational Excellence (partially done)

### 6.1 — Retrieval Quality Benchmark Suite — MISSING

**New file:** `bench/retrieval-quality.ts`

Create a benchmark that measures capsule quality against known-good queries from the field reviews. This is how we prove ContextWeave actually works.

```typescript
interface BenchmarkQuery {
  name: string;
  query: string;
  expectedFiles: string[];       // must appear in capsule output
  expectedSymbols: string[];     // must appear in capsule output
  mustNotInclude?: string[];     // must NOT appear
  mode: 'narrow' | 'broad';
  minUtilization: number;        // minimum budget utilization (0-1)
}
```

Include at least 10 benchmark queries spanning:
- Narrow symbol lookups (e.g., "useDataLayer", "SecurityConfig")
- Broad architecture queries (e.g., "how does auth connect to dashboard", "end-to-end shopping flow")
- Debug queries (e.g., "session search filtering error")

For each query, the benchmark should:
1. Run `generateCapsule` with the query
2. Check: capsule contains expected files/symbols (recall)
3. Check: capsule does NOT contain must-not-include items (precision)
4. Check: confidence is calibrated (not HIGH on thin retrieval)
5. Check: budget utilization >= minUtilization
6. Report precision, recall, F1 per query, plus aggregate scores

Add `"bench:quality": "npx tsx bench/retrieval-quality.ts"` to package.json scripts.

### 6.2 — Honest Token Savings Metrics — PARTIAL

**File:** `src/mcp/tools/stats.ts`

**Problem:** Current savings metric uses flat `÷ 4` bytes-to-tokens approximation and compares capsule tokens against "all files in project" (misleading — no agent reads all files).

**What to fix:**
1. Replace `÷ 4` with actual tokenization using the existing `gpt-tokenizer` dependency (already in the project). Count real tokens.
2. Add new metrics:
   - `budgetUtilization`: average `tokensUsed / tokenBudget` across capsule log entries
   - `firstPassHitRate`: percentage of capsules where `followedUp === false` (capsule answered without follow-up)
   - `averageFollowUpReads`: average number of follow-up tool calls after a capsule (lower = better)
3. Remove or relabel the "savings vs entire project" metric — replace with "savings vs equivalent grep+read cost" (number of files touched × average file token count)

### 6.3 — Project-Relative Paths in DB — PARTIAL

**File:** `src/core/indexer.ts`

**Problem:** Absolute paths stored in `files` table. Leaks machine-local paths, breaks portability.

**What to fix:**
1. In file discovery / `writeParseResult()`: store `relativePath` (already computed as a variable) instead of `fullPath` in the `files` table
2. Add DB migration: strip the project root prefix from existing paths. Make it idempotent (skip files already relative — check if path starts with `/` or drive letter).
3. Update all code that reads `files.path` to resolve relative → absolute for filesystem access: `path.resolve(projectRoot, relativePath)`
4. Verify output formatters already use relative paths (most do via `toProjectRelativePath` — this change makes them the source of truth)

**Caution:** This is a schema-changing migration. Test that existing indexes and queries work after migration. Test both fresh index and migration from existing absolute-path DB.

### 6.4 — Delete semantic-reranker.ts — Cleanup

**File to delete:** `src/capsule/semantic-reranker.ts`

The implementation plan (Phase 3) said hybrid search replaces this. It's still in the codebase as an opt-in layer (off by default, behind `CW_ENABLE_SEMANTIC_RERANK` env var). Since `hybrid-ranker.ts` now handles all ranking with real vector similarity:

1. Delete `src/capsule/semantic-reranker.ts`
2. Remove all imports and references in `src/capsule/generator.ts`
3. Remove `semanticRerank` parameter from `CapsuleParams` in `src/core/types.ts`
4. Remove the `CW_ENABLE_SEMANTIC_RERANK` env var check
5. Remove any related test files
6. Grep the entire codebase for "semanticRerank" and "semantic-reranker" to catch any remaining references

---

## Execution Order

```
Step 0: npm install (if node_modules missing)
Step 1: git status → commit existing Phase 4 changes if they exist
Step 2: Phase 0 fixes (0.1 → 0.2 sequentially, then 0.3/0.4/0.5/0.6 in parallel)
Step 3: Phase 5 features (5.1/5.2/5.3/5.4/5.5 — all independent, can parallelize)
Step 4: Phase 6 items (6.1 depends on Phase 0+5 being done; 6.2/6.3/6.4 independent)
Step 5: Final validation
```

**Within each step, commit after completing each numbered item.** Use conventional commits:
- `fix(capsule): add exact symbol-name boost to pivot scorer`
- `fix(capsule): skip content fallback for exact-match pivots`
- `feat(core): add structural pattern detection engine`
- etc.

---

## Reference Documents

Read these files in the repo for full context:

- `research/IMPLEMENTATION_PLAN.md` — the complete 7-phase plan with all architectural details
- `research/augment-vs-contextweave.md` — deep analysis of how Augment works and where ContextWeave stands
- `.claude/CLAUDE.md` — project conventions and tool descriptions

---

## Conventions

- TypeScript ESM (`import`/`export`, no CommonJS, no `require`)
- `const` over `let`, `async/await` over `.then()`, named imports, never use `any`
- No code comments unless logic is genuinely non-obvious
- Conventional commits: `feat(scope):`, `fix(scope):`, `refactor(scope):` — no emojis
- Tests use **vitest**, located at `tests/<module>/<name>.test.ts`
- DB migrations go in `src/db/migrations.ts` with incrementing version numbers
- Run tests: `npm test`
- Run build: `npm run build`
- Run specific test: `npx vitest run tests/path/to/test.test.ts`

---

## Final Validation Checklist

After all work is complete, verify ALL of these pass:

```
[ ] npm run build — compiles without errors
[ ] npm test — all tests pass (existing 536+ plus new tests)
[ ] Exact symbol queries rank the exact symbol as result #1
[ ] Exact-name queries do NOT trigger content fallback explosion
[ ] Budget utilization > 60% on both narrow and broad queries
[ ] Confidence is never HIGH when token utilization < 30%
[ ] TSX files with & entities in JSX text are not flagged as syntax errors
[ ] Pattern detection groups 3+ structurally similar files
[ ] File summaries index string literals, JSX text, SQL table names, API calls
[ ] IDF suppression reduces noise from ubiquitous terms like "get" and "page"
[ ] Flow tracing follows callback and server-action edges
[ ] Observation promotion fires after 3+ hits, demotion after 30 days stale
[ ] Retrieval benchmark suite runs and reports metrics
[ ] Token savings metrics use real tokenization, not ÷4 approximation
[ ] File paths in DB are project-relative, not absolute
[ ] No references to semantic-reranker.ts remain anywhere in the codebase
[ ] No regressions in existing functionality
```

---

## Why This Matters

The current state: `cw_capsule` uses 6% of its token budget, reports HIGH confidence on garbage retrieval, and agents don't trust it — so they fall back to grep+read anyway, wasting the capsule tokens on top.

The target state: `cw_capsule` uses 60-85% of budget, returns the right code on the first call with honest confidence, and agents proceed directly without follow-up exploration. 60-70% real token savings. One tool call replaces 10-15 grep+read cycles.

That's what makes ContextWeave a legitimate open-source alternative to Augment — same retrieval quality, zero cost, complete privacy.
