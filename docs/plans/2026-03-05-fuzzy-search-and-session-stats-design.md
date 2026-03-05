# Fuzzy Search Upgrade + Session Stats Tool

**Date:** 2026-03-05
**Status:** Design approved
**Inspired by:** [claude-context-mode](https://github.com/mksglu/claude-context-mode) — output compression MCP server with three-layer fuzzy search and session metrics

## Problem Statement

ContextWeave's BM25 search (used by `cw_recall` and capsule observation retrieval) is exact-token only. Searching for "caching" won't match an observation containing "cached". Searching for "authentication" won't match "auth". Typos like "kuberntes" return nothing.

This means users fall back to Grep/Explorer agent for recall misses — the exact expensive behavior ContextWeave exists to replace.

Additionally, ContextWeave logs capsule metrics to `capsule_log` but never exposes aggregate session stats to the user. Users can't see the value they're getting, which matters for an open-source project where adoption depends on visible impact.

## Goals

1. Make `cw_recall` and observation search typo-tolerant and morphologically aware
2. Improve capsule quality by surfacing relevant observations that exact-match misses
3. Expose per-session context savings via a new `cw_stats` MCP tool
4. Zero regression on existing tests; zero impact on happy-path performance

## Non-Goals

- Replacing our hand-built BM25 with SQLite FTS5 (we need custom confidence blending)
- Output interception/sandboxing (that's claude-context-mode's core; architecturally different)
- Progressive search throttling (we're query-driven, not output-driven)

---

## Feature A: Three-Layer Fuzzy BM25 Search

### Architecture

The current search path:

```
query -> tokenize(lowercase + split) -> exact BM25 match -> results
```

The new search path:

```
query -> tokenize(lowercase + split + STEM) -> stemmed BM25 match -> results
  |
  v (if results < minResults threshold)
  trigram substring fallback against indexed terms -> expanded query -> BM25 retry
  |
  v (if still < minResults threshold)
  Levenshtein correction against known terms -> corrected query -> BM25 retry
```

### Layer 1: Porter Stemming

**What it does:** Reduces words to their root form at both index time and query time.

Examples:
- "caching", "cached", "caches" -> "cach"
- "authentication", "authenticating" -> "authent"
- "running", "runs", "ran" -> "run"
- "connection", "connected", "connecting" -> "connect"

**Implementation:**

New file: `src/utils/stemmer.ts`
- Pure TypeScript Porter Stemmer implementation (no dependencies)
- Follows the classic Porter 1980 algorithm with 5 steps
- Exported function: `stem(word: string): string`

**Integration into BM25:**

The `tokenize()` function in `src/memory/bm25.ts` currently does:
```ts
text.toLowerCase().split(/[\s\W]+/).filter(t => t.length > 0 && !STOPWORDS.has(t))
```

It will change to:
```ts
text.toLowerCase().split(/[\s\W]+/)
  .filter(t => t.length > 0 && !STOPWORDS.has(t))
  .map(t => stem(t))
```

**Index migration:** Since we stem at both index time and query time, existing indexed data needs to be re-stemmed. This is handled by:
1. A new DB migration (version 7) that re-indexes all observations through `BM25Index.reindexAll()`
2. The method iterates observations, re-tokenizes with stemming, and updates `bm25_index` rows
3. This is a one-time operation on upgrade; new observations are stemmed automatically

**Why not a separate `stemmed_term` column?** Simpler to just stem everything. The raw token is only useful for exact matching, which the stemmed version already handles (stemming "auth" returns "auth"). We store only stemmed tokens.

### Layer 2: Trigram Substring Fallback

**When it triggers:** Stemmed BM25 returns fewer than `minResults` (default: 3) results.

**What it does:** Uses existing `trigrams()` from `src/utils/fuzzy.ts` to find BM25 index terms that are similar substrings of query terms, then retries the BM25 search with expanded terms.

**Implementation:**

New method on `BM25Index`: `getDistinctTerms(): string[]`
- Returns all unique terms from `bm25_index` (cached per search session)

New method on `BM25Index`: `searchWithFallback(query: string, limit: number, minResults: number): SearchResult[]`
- Calls `search()` first
- If results < minResults, gets distinct terms and runs trigram similarity against query tokens
- Adds top-matching terms (similarity >= 0.4) to query and retries

**Example:**
- Query: "useEff" (typo/partial)
- Stemmed BM25: 0 results
- Trigram match against indexed terms: "useEffect" scores 0.72 similarity
- Retry with "useEffect": returns relevant results

### Layer 3: Levenshtein Correction

**When it triggers:** After Layer 2, still fewer than `minResults` results.

**What it does:** Computes edit distance between query terms and known indexed terms, suggests corrections for likely typos (edit distance <= 2).

**Implementation:**

New file: `src/utils/levenshtein.ts`
- `levenshteinDistance(a: string, b: string): number` — standard DP algorithm
- `correctTerm(term: string, knownTerms: string[], maxDistance: number): string | null` — finds closest known term within distance threshold

**Integration:** Added as third layer in `searchWithFallback()`. If Layer 2 didn't help, try Levenshtein correction on each query term and retry.

**Example:**
- Query: "kuberntes" (typo)
- Stemmed BM25: 0 results
- Trigram fallback: might catch this, but if not...
- Levenshtein: "kuberntes" -> "kubernetes" (distance 1) -> retry -> results

### Performance Considerations

- **Happy path (Layer 1 returns enough results):** ~0ms overhead. Stemming adds negligible time to tokenization.
- **Layer 2 (trigram fallback):** Requires loading distinct terms from DB. For typical ContextWeave memory stores (< 1000 observations), this is < 5ms. We cache `getDistinctTerms()` for the lifetime of the `BM25Index` instance with a dirty flag on index/remove.
- **Layer 3 (Levenshtein):** O(n * m) per term pair where n, m are term lengths. Against ~500 unique terms, this is < 10ms. Only triggers on zero-result queries.
- **Index size:** No change. Stemmed tokens are typically shorter than raw tokens.

### Files Changed

| File | Change |
|------|--------|
| `src/utils/stemmer.ts` | **NEW** — Porter Stemmer implementation |
| `src/utils/levenshtein.ts` | **NEW** — Levenshtein distance + correction |
| `src/memory/bm25.ts` | Stem in `tokenize()`, add `searchWithFallback()`, `getDistinctTerms()`, `reindexAll()` |
| `src/memory/observations.ts` | Call `searchWithFallback()` in `searchWithScores()` |
| `src/db/migrations.ts` | Migration v7: re-index BM25 with stemming |
| `tests/unit/stemmer.test.ts` | **NEW** — Porter Stemmer unit tests |
| `tests/unit/levenshtein.test.ts` | **NEW** — Levenshtein distance unit tests |
| `tests/unit/bm25.test.ts` | Add tests for stemmed search, trigram fallback, Levenshtein correction |
| `tests/unit/bm25-correctness.test.ts` | Verify existing correctness with stemmed tokens |

---

## Feature B: Session Stats Tool (`cw_stats`)

### What It Exposes

A new `cw_stats` MCP tool that queries `capsule_log` and `session_context` for the current or recent sessions and returns:

```
ContextWeave Session Stats
Session: <session-id> (started: <timestamp>)

Capsules generated:    12
Total tokens budgeted: 48,000
Total tokens used:     31,200 (65% efficiency)
Unique files covered:  23
Unique symbols served: 87
Avg confidence:        HIGH (0.82)
Observations recalled: 5

Estimated savings:
  Raw file reads:     ~180,000 tokens (23 files avg 7,800 tokens)
  ContextWeave used:  ~31,200 tokens
  Estimated savings:  ~148,800 tokens (83% reduction)

Per-capsule breakdown:
  [14:23:01] "auth middleware" — 2,400/4,000 tokens, 8 symbols, confidence: HIGH
  [14:25:33] "database connection pooling" — 3,100/4,000 tokens, 12 symbols, confidence: MEDIUM
  ...
```

### How Savings Are Estimated

We can't know exactly what the user would have done without ContextWeave. But we can estimate conservatively:

1. **Files covered** = unique files across all capsules in the session
2. **Avg file size** = average token count of indexed files (from `files` table + `stat()`)
3. **Raw cost** = files_covered * avg_file_tokens (what Grep+Read would have consumed)
4. **CW cost** = sum of `tokens_used` from capsule_log
5. **Savings** = raw_cost - cw_cost

This is a lower bound because it doesn't count the Grep queries, failed reads, and exploration the user *didn't* have to do.

### Implementation

New file: `src/mcp/tools/stats.ts`
- `registerStatsTool(server, db, projectRoot, serverSessionId)`
- Queries `capsule_log` for current session
- Queries `files` table for file sizes
- Computes aggregates
- Formats output

### Registration

In `src/mcp/server.ts`:
- Import and call `registerStatsTool(server, db, projectRoot, serverSessionId)`
- Registered for both primary and secondary sessions (read-only tool)

### Files Changed

| File | Change |
|------|--------|
| `src/mcp/tools/stats.ts` | **NEW** — Session stats tool implementation |
| `src/mcp/server.ts` | Import + register `registerStatsTool` |
| `tests/unit/stats.test.ts` | **NEW** — Stats aggregation and formatting tests |

---

## Migration Strategy

### DB Migration v7

```sql
-- No schema changes needed for stemming (we reuse bm25_index table).
-- The migration re-indexes all observations with stemmed tokens.
```

The migration is implemented in TypeScript (not raw SQL) because it needs to:
1. Read all observations
2. Re-tokenize with Porter stemming
3. Clear and rebuild `bm25_index` entries
4. Rebuild BM25 stats

This runs once on first connection after upgrade. For typical projects (< 500 observations), it takes < 100ms.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Stemmer produces unexpected conflations | Low | Extensive test coverage; Porter algorithm is battle-tested since 1980 |
| Migration breaks on existing DBs | Low | Migration is additive; old data format is unchanged |
| Performance regression on large memory stores | Low | Fallback layers only trigger on low-result queries |
| Stats estimates mislead users | Medium | Label as "estimated" and explain methodology in output |
| Existing tests break from stemming change | Medium | BM25 tests search for multi-word queries where at least one token is already a stem root. Will audit and fix any brittle assertions |

---

## Test Plan

### Unit Tests (new)

1. **`stemmer.test.ts`** — 20+ cases covering regular/irregular words, already-stemmed words, short words, edge cases
2. **`levenshtein.test.ts`** — distance calculations, correction suggestions, max distance threshold
3. **`bm25.test.ts` additions** — stemmed matching ("cached" finds "caching"), trigram fallback, Levenshtein correction, `reindexAll()` behavior
4. **`stats.test.ts`** — aggregation logic, savings estimation, empty session handling, formatting

### Integration Tests

5. **Recall with stemming** — `cw_recall("authenticate")` finds observation containing "authentication"
6. **Migration test** — Fresh DB with observations -> run migration v7 -> verify stemmed search works
7. **Stats tool** — Generate capsules -> call `cw_stats` -> verify output structure and numbers

### Regression

8. Run full `vitest run` suite before and after — zero new failures
9. Run `npm run eval` — capsule quality scores should improve or stay stable (stemmed observations = better recall)

---

## Implementation Order

1. `src/utils/stemmer.ts` + `tests/unit/stemmer.test.ts` (pure function, zero deps)
2. `src/utils/levenshtein.ts` + `tests/unit/levenshtein.test.ts` (pure function, zero deps)
3. Update `src/memory/bm25.ts` — stemmed tokenize, `searchWithFallback()`, `getDistinctTerms()`, `reindexAll()`
4. Update `tests/unit/bm25.test.ts` — add stemming and fallback tests
5. Update `src/memory/observations.ts` — wire `searchWithFallback()` into `searchWithScores()`
6. Add DB migration v7 in `src/db/migrations.ts`
7. `src/mcp/tools/stats.ts` + registration in `src/mcp/server.ts`
8. `tests/unit/stats.test.ts`
9. Integration tests
10. Full regression run
11. Commit and push

---

## What We're Stealing from claude-context-mode

| Their feature | What we take | What we skip |
|---------------|-------------|--------------|
| Porter stemming in FTS5 | Pure TS Porter Stemmer in our BM25 | Using SQLite FTS5 porter tokenizer (we need custom scoring) |
| Trigram substring search | Wire our existing `fuzzy.ts` trigrams into BM25 fallback | Their FTS5 trigram tokenizer approach |
| Levenshtein fuzzy correction | New `levenshtein.ts` as third fallback layer | Their specific search throttling (N/A for us) |
| Session stats tracking | New `cw_stats` MCP tool with savings estimation | Their per-tool network I/O tracking (we don't sandbox) |
| Progressive search throttling | Skip — we're query-driven, not output-driven | |
| Sandbox execution model | Skip — architecturally different product | |
| URL fetch + index | Skip — scope creep, not core to code intelligence | |
| PreToolUse hook routing | Skip — we use explicit MCP calls | |
