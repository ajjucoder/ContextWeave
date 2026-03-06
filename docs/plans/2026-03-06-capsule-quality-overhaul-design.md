# Capsule Quality Overhaul — Hybrid Retrieval Design

**Date:** 2026-03-06
**Approach:** B — Hybrid Retrieval + Intent-Directed BFS + Foundation Fixes
**Goal:** Make ContextWeave capsules genuinely useful across all query types (narrow, broad, task) in all real-world codebases

## Problem Statement

Deep analysis of the capsule pipeline revealed 8 critical weaknesses that cause poor retrieval quality in real-world usage:

1. **CamelCase blindness** — FTS5 treats `getUserById` as one token; query `"user"` finds nothing
2. **`fix` missing from TASK_PATTERN_BUNDLES** — most common task verb gets generic fallback
3. **Task decomposition is action-fixed** — `"find all API endpoints"` decomposes to `["error","handling","validation"]`
4. **BFS traverses both directions regardless of intent** — "how does X work" pulls in every caller (noise)
5. **No L0 size guard** — single 500-line function eats entire budget
6. **File summaries don't split camelCase** — same blindspot at file-level search
7. **No content-level fallback** — concepts in comments/strings are invisible to AST-only search
8. **Capsule doesn't guide follow-up reads** — Claude doesn't know which degraded symbols to read next

## Design

### Change 1: CamelCase-Aware FTS Tokenizer

**File:** `src/utils/camel-split.ts` (new)
**Files modified:** `src/core/file-summaries.ts`, `src/db/queries/symbols.ts`

Add a utility that splits compound identifiers into sub-tokens:
- `getUserById` → `["get", "user", "by", "id"]`
- `snake_case_name` → `["snake", "case", "name"]`
- `HTTPSConnection` → `["https", "connection"]`
- `XMLParser` → `["xml", "parser"]`

Rules:
- Split on `_`, `-`, `.`, `/`
- Split on camelCase boundaries (lowercase→uppercase transition)
- Split on acronym boundaries (multiple uppercase followed by lowercase: `HTTP` stays together, `HTTPSc` splits to `HTTPS` + `c`)
- Filter tokens shorter than 2 chars
- Lowercase all tokens

**Integration points:**
1. `buildSummaryText()` in `file-summaries.ts`: split each symbol name before concatenating into FTS text
2. FTS search queries: split user query terms the same way before matching
3. `getByNameCI()` fallback: when exact match fails, try matching against split tokens

**Migration:** DB migration v10 — rebuild all `file_summaries_fts` entries with split tokens. No schema change needed; just re-run `upsertFileSummary` for all files.

### Change 2: Fix Task Decomposition

**File:** `src/capsule/query-decomposer.ts`

Two sub-changes:

**2a: Add missing verbs to TASK_PATTERN_BUNDLES:**
- `fix` → same bundles as `debug` (error handling, edge cases, pipeline flow)
- `remove`/`delete` → `["usages", "references", "imports"], ["cleanup", "orphaned", "unused"], ["tests", "coverage", "safety"]`
- `replace`/`extract` → `["interfaces", "types", "contracts"], ["modules", "boundaries", "dependencies"], ["tests", "coverage", "safety"]`

**2b: Make bundles content-adaptive:**

Replace the static bundle lookup with a function that uses the *content terms* from the query (not just the verb) to select relevant bundles. When content terms match known domain areas (from the synonym map + module synonyms), use domain-specific bundles instead of verb-generic ones.

Example: `"find all API endpoints"` — content terms are `["api", "endpoints"]`. These match the `api` module synonym. Instead of using `find`'s generic bundles, generate: `["route", "handler", "controller"], ["endpoint", "middleware", "request"], ["response", "schema", "validation"]`.

Implementation: a small `DOMAIN_BUNDLES` map keyed by implied module names from `MODULE_SYNONYMS`:
```
auth → [["login", "session", "token"], ["password", "credential", "hash"], ["middleware", "guard", "permission"]]
api  → [["route", "handler", "controller"], ["endpoint", "middleware", "request"], ["response", "schema", "validation"]]
db   → [["query", "schema", "migration"], ["model", "table", "index"], ["connection", "pool", "transaction"]]
ui   → [["component", "props", "state"], ["render", "layout", "style"], ["event", "handler", "hook"]]
test → [["fixture", "mock", "setup"], ["assertion", "expect", "coverage"], ["integration", "e2e", "regression"]]
```

When `impliedModules` from intent classification are non-empty, use domain bundles. Fall back to verb bundles only when no domain match.

### Change 3: Intent-Directed BFS

**File:** `src/core/weighted-bfs.ts`

Add a `direction` option to `BfsOptions`:
- `"outgoing"` — only follow outgoing edges (dependencies). For "how does X work" queries.
- `"incoming"` — only follow incoming edges (usages/callers). For "find all usages of X" queries.
- `"both"` — current behavior (default).

**File:** `src/capsule/generator.ts`

Map intent to BFS direction:
- `narrow` → `"both"` (current behavior — you want the symbol and its immediate context)
- `broad` → `"outgoing"` with `incomingEdgeCostMultiplier: 3.0` (prefer dependencies over callers)
- `task` → `"both"` (need both callers and callees for bug fixing / implementation)

For `broad` queries, this eliminates the biggest source of noise: utility functions that are imported by 50 files pulling in all 50 callers.

### Change 4: L0 Size Guard with Smart Truncation

**File:** `src/capsule/compressor.ts`

Add a `maxL0Tokens` parameter (default: 300) to `renderSymbol`. When a symbol's `fullSource` exceeds this:
1. Render the signature line
2. Render the first N lines of the body (up to ~60% of budget)
3. Insert `// ... N more lines — use cw_read(symbol: "name") to see full source`
4. Render the last 3 lines (closing braces, return statement)

This ensures no single L0 symbol consumes more than ~300 tokens, leaving room for other symbols. The truncation message explicitly tells Claude how to get the full source.

### Change 5: Content-Aware Fallback Retrieval

**File:** `src/capsule/content-fallback.ts` (new)
**File:** `src/capsule/generator.ts` (modified)

When Stage A pivot resolution yields fewer than 3 pivots, activate content fallback:

1. Run `cw_grep` internally (using the same ripgrep infrastructure from `src/mcp/tools/search.ts`) to search file bodies for query terms
2. For each matching file, look up its indexed symbols
3. Promote those symbols as additional pivots with a `contentMatch` flag (score at 0.7x of AST pivots)

This catches:
- Queries about concepts mentioned in comments (`"retry logic"` → finds `// Retry with exponential backoff`)
- Queries about string literals (`"sends emails"` → finds `"sending email to"` in code)
- Queries about variable names inside function bodies (not extracted as top-level symbols)

The content scan is bounded: max 10 files, max 500ms, only searches already-indexed files. No new infrastructure needed — reuses existing ripgrep integration.

### Change 6: Follow-Up Hints in Capsule Output

**File:** `src/capsule/formatter.ts`

Add a `--- Follow-Up Reads ---` section between the code and observations:

```
--- Follow-Up Reads ---
These symbols were compressed. Read them for full source:
  cw_read(symbol: "handleAuth")     — 45 lines, scored 0.82
  cw_read(symbol: "validateToken")  — 28 lines, scored 0.71
```

Rules:
- Only show for symbols at L1/L2 that scored above the median
- Cap at 5 suggestions
- Include line count and relevance score so Claude can prioritize
- Sort by score descending

This closes the loop: Claude gets the capsule, sees the overview, and knows exactly which symbols to deep-read if needed — all within 1-2 tool calls instead of 5-10 speculative reads.

### Change 7: Improved Observation Placement

**File:** `src/capsule/formatter.ts`

Move high-confidence observations (confidence >= 0.8) to the TOP of the capsule, right after the header. Low-confidence observations stay at the bottom.

Rationale: Claude reads linearly. High-confidence architectural notes should inform how Claude interprets the code, not appear as an afterthought.

### Change 8: DB Migration v10

**File:** `src/db/migrations.ts`

Migration v10:
- Re-build all `file_summaries` with camelCase-split summary text
- This is a data-only migration (no schema change) — iterate all files, call `upsertFileSummary` with the new `buildSummaryText` that splits camelCase

## Implementation Plan

Eight independent work streams, parallelizable:

| # | Task | Files | Dependencies |
|---|------|-------|-------------|
| 1 | CamelCase splitter + tests | `src/utils/camel-split.ts`, tests | None |
| 2 | Integrate camelCase into file summaries + FTS | `src/core/file-summaries.ts` | Task 1 |
| 3 | Fix TASK_PATTERN_BUNDLES + content-adaptive bundles | `src/capsule/query-decomposer.ts` | None |
| 4 | Intent-directed BFS | `src/core/weighted-bfs.ts`, `src/capsule/generator.ts` | None |
| 5 | L0 size guard with smart truncation | `src/capsule/compressor.ts` | None |
| 6 | Content-aware fallback | `src/capsule/content-fallback.ts`, `src/capsule/generator.ts` | None |
| 7 | Follow-up hints + observation placement | `src/capsule/formatter.ts` | None |
| 8 | DB migration v10 + integration tests | `src/db/migrations.ts`, integration tests | Tasks 1-2 |

Tasks 1, 3, 4, 5, 6, 7 are fully independent. Tasks 2 and 8 depend on Task 1.

## Success Criteria

- Narrow queries (exact symbol names): confidence >= 80%
- Broad queries (conceptual): confidence >= 65% (up from 60%)
- Task queries (actionable): confidence >= 65% (up from 57%)
- Query `"user"` finds `getUserById` in a TS codebase
- Query `"how does authentication work"` produces a useful capsule even when no symbol is named "authentication"
- Query `"fix the login bug"` produces debug-focused sub-queries (error handling, validation), not generic architecture
- No single L0 symbol consumes more than 300 tokens
- Capsule includes actionable follow-up read suggestions
