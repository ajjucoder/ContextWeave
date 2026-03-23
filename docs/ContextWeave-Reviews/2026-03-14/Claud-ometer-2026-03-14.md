# ContextWeave Field Review: Claud-ometer

**Date:** 2026-03-14
**ContextWeave Version:** `cw_status` did not surface a version. CLI reported `contextweave v0.1.0`.

## Project Profile

| Metric | Value |
|--------|-------|
| Project | Claud-ometer |
| Stack | Next.js App Router, React 19, TypeScript, Tailwind v4, SWR, Recharts, local filesystem-backed API routes |
| Lines of Code | 4,163 |
| Source Files | 47 indexed files |
| Symbols Indexed | 205 |
| Languages | tsx, typescript, javascript, json, markdown |
| Index Time | `0.659s` wall-clock incremental reindex (`cw_reindex` only processed 5 changed files; not a cold rebuild) |
| Architecture | App Router UI + `/app/api/*` JSON routes + `src/lib/claude-data/*` filesystem reader/service layer |
| Key Directories | `src/app`, `src/app/api`, `src/lib/claude-data`, `src/components`, `scripts` |

## Task-Based Results

### Task A: Understand `calculateCost` fallback pricing and real callers

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 2,553 | 956 |
| Tool calls | 7 | 2 |
| Completeness | Complete | Complete |
| Time to correct answer | ~5-6s | <1s |

**What ContextWeave found:** `calculateCost` itself, reader-side cost aggregation dependents, and `CostChart` usage. `cw_impact` was useful once targeted directly.
**What ContextWeave missed:** The first capsule did not surface `findClosestPricing`, which is the helper that actually defines fallback behavior. I had to recover that with an extra file read. It also sent me on a dead-end `cw_read(file=...)` schema mismatch.
**Follow-up suggestions useful?** No. The capsule suggested broadening/narrowing and `cw_grep`, not the helper that mattered.
**Winner:** Grep+Read

### Task B: Trace ZIP import from Data page upload to imported-data reads

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 2,661 | 2,574 |
| Tool calls | 7 | 5 |
| Completeness | Partial | Complete |
| Time to correct answer | ~6s | ~1s |

**What ContextWeave found:** The right file cluster: `app/data/page.tsx`, `app/api/import/route.ts`, `lib/claude-data/data-source.ts`, `lib/claude-data/reader.ts`.
**What ContextWeave missed:** `cw_flow(handleImport -> POST)` and `cw_flow(handleImport -> setDataSource)` failed, so it did not actually trace the UI callback across the HTTP boundary. I had to manually reconstruct the flow from `cw_read` outputs. The human-readable follow-up section also omitted `handleImport` even though the structured suggestions contained it.
**Follow-up suggestions useful?** No. The top human-visible suggestion was `getDashboardStats`, which is not the core import-switch path.
**Winner:** Grep+Read

### Task C: What patterns do the API routes follow for data access and error handling?

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 4,276 | 3,261 |
| Tool calls | 5 | 5 |
| Completeness | Complete | Complete |
| Time to correct answer | ~5s | ~1s |

**What ContextWeave found:** `cw_overview` gave a decent route inventory and `cw_capsule` pulled most route files into one place. `cw_grep("force-dynamic")` and `cw_grep("console.error")` were helpful for convention spot-checking.
**What ContextWeave missed:** It still needed grep-like cleanup to answer the actual architectural question. The expensive capsule added little beyond what `cw_overview` + grep already showed, and it did not independently call out the `data-source` logging deviation or the `export` route as the main outlier until I manually read it.
**Follow-up suggestions useful?** Partial. `cw_overview` helped orient me; the rest still required manual verification.
**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 9,490
- Total Grep+Read tokens across 3 tasks: 6,791
- Actual savings: `-39.7%` (ContextWeave cost more, not less)

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `calculateCost` | Yes | Nothing |
| `setDataSource` | Yes | Nothing |
| `GET` | No | `cw_grep("GET")` was polluted by substring hits like `getImportDir`; capsule picked an arbitrary `GET` route with `HIGH` confidence |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `state management` | LOW | `0 / 2000` | Yes on uncertainty signaling, but it still completely missed a real concept (`useState`, `useSWR`) |
| `error handling` | MEDIUM | `853 / 2000` | No — it returned `dynamic` constants and a random helper while sounding usable |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `session detail loading flow` | 8000 | 1327 | 16.6% |
| `API route patterns for data access and error handling` | 8000 | 2171 | 27.1% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `POST -> setDataSource` | Yes | N/A | Works for simple cross-file call edges |
| `handleImport -> POST` | No | No | No client-fetch / HTTP boundary edge from UI callback into route handler |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `API route patterns for data access and error handling` | 6 | Good inventory, but not enough to answer the question without extra grep/read work |
| `cw_recall` | `session detail loading flow` | 3 | Mostly README quotes plus duplicated passive query telemetry; low signal |
| `cw_impact` | `src/config/pricing.ts:calculateCost` | 7 | Dependents were useful, but the output leans on import/call adjacency rather than semantic caller summaries |
| `cw_stats` | `session_id=stress-budget` | 4 | Budget/utilization looked honest, but first-pass/follow-up metrics were misleading in real use |

## Flaws Found

Ordered by severity. Each finding is one issue only.

### P0 (Critical — blocks adoption)
1. **Measured token savings claim failed on real tasks**: Across three real tasks, ContextWeave used `9,490` tokens vs `6,791` for a fair grep+read baseline. That is `-39.7%` savings. Root cause: the first capsule often omitted the exact thing needed next, forcing multiple `cw_read`/`cw_grep` recovery calls. Likely source: `src/capsule/generator.ts`, `src/capsule/packer.ts`, `src/capsule/formatter.ts`. Suggested fix: optimize for first-pass completeness, not just pretty capsule formatting; penalize capsules that require immediate navigation follow-ups.
2. **HTTP/callback flow tracing still breaks on the path that matters**: `cw_flow(handleImport -> POST)` returned no path, and `handleImport -> setDataSource` also failed, even though the actual feature crosses `fetch('/api/import')` into a route that calls `setDataSource`. Root cause: the graph does not synthesize UI-callback-to-HTTP-route edges. Likely source: `src/core/event-edge-synthesis.ts`, `src/core/indexer.ts`, `src/mcp/tools/flow.ts`. Suggested fix: model `fetch('/api/...')` and form-submission edges as routable graph edges, then teach `cw_flow` to traverse them.
3. **Valid TSX was flagged as a parse error in the index**: `cw_status` marked `src/app/data/page.tsx` with `[ERROR]`, but the repo linted cleanly enough to prove the file is syntactically valid TypeScript/TSX. Root cause: parser false positive on a central client file, which directly risks missed symbols and bad retrieval. Likely source: `src/core/parser.ts` or TSX handling inside `src/core/indexer.ts`. Suggested fix: emit concrete parser diagnostics instead of a generic “syntax errors detected” string, and harden TSX parsing for React callback-heavy files.

### P1 (Important — degrades quality)
1. **Confidence is miscalibrated on vague architectural queries**: `cw_capsule("error handling")` returned `MEDIUM` confidence while surfacing `dynamic` constants and an unrelated helper. That is not usable architectural context. Root cause: lexical overlap and shallow file hits are over-rewarded, while semantic relevance is under-penalized. Likely source: `src/capsule/confidence.ts`, `src/capsule/generator.ts`. Suggested fix: sharply penalize capsules whose top packed symbols do not actually match the concept class of the query.
2. **Common-token exact search is too noisy to trust**: `cw_grep("GET")` was swamped by substring matches like `getImportDir`, making exact-symbol verification impossible for common names. Root cause: raw substring/regex matching without symbol-boundary or identifier-boundary modes. Likely source: `src/mcp/tools/search.ts`. Suggested fix: add `exact_symbol`, `identifier_boundary`, or AST-backed search modes so common names do not collapse into junk.
3. **`cw_stats` overstates first-pass success**: After Task A required multiple `cw_read`/`cw_grep` recovery calls, `cw_stats` still reported `First-pass rate: 100.0%` and `Avg follow-up reads: 0.00`. That is false in practice. Root cause: follow-up tracking is wired to external Claude `Read`/`Edit` hooks, not to actual `cw_*` navigation after a capsule. Likely source: `src/hooks/post-tool-use.ts`, `src/mcp/tools/stats.ts`. Suggested fix: mark capsule follow-ups when `cw_read`, `cw_grep`, `cw_overview`, `cw_flow`, or `cw_impact` are called in the same session after a capsule.
4. **Large budgets are severely underutilized**: With an `8000` token budget, measured utilization was only `16.6%` and `27.1%`. That is not a small miss; it directly undermines the “replace exploration” pitch. Root cause: retrieval/packing stops far too early even when relevant material exists. Likely source: `src/capsule/packer.ts`, `src/capsule/generator.ts`. Suggested fix: keep widening/filling until either the budget is materially used or the system can explicitly justify why not.

### P2 (Moderate — papercut)
1. **Human-readable follow-up suggestions diverge from structured suggestions**: In Task B, the structured output suggested `handleImport`, but the visible follow-up section omitted it and instead pushed `getDashboardStats`. Root cause: formatter and structured output are not consistent. Likely source: `src/capsule/formatter.ts`. Suggested fix: generate visible follow-up text directly from the same suggested-read list that is emitted in structured output.
2. **Step-0 profiling is weaker than the review workflow needs**: `cw_reindex` on an already-indexed repo only processed changed files, so it did not provide a cold full-index timing when the review explicitly needed one. Root cause: reindex semantics are incremental-only and the status surface does not distinguish “cold index time” from “incremental update time.” Likely source: `src/mcp/tools/reindex.ts`, `src/cli/commands/status.ts`, `src/core/indexer.ts`. Suggested fix: expose both cold rebuild and incremental timings, or add a `force_full` rebuild option.

## What Worked Well

- File-qualified `cw_read` was reliably good. Once I already knew the target symbol, it jumped to the correct range with low noise.
- `cw_impact(src/config/pricing.ts:calculateCost)` returned useful dependents across the reader layer and chart/page consumers.
- `cw_overview(path: "src/app/api", query: "...")` gave a fast, compact inventory of the route tree and its entry points.
- Direct cross-file flow tracing worked for simple call edges such as `POST -> setDataSource`.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 6 |
| Broad recall (found all relevant files) | 4 |
| Budget utilization (% of budget used) | 2 |
| Confidence calibration (honest scores) | 3 |
| Flow tracing (traces real call chains) | 4 |
| Follow-up quality (suggested reads were useful) | 3 |
| Token savings vs grep+read (measured, not claimed) | 2 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

- **Finding: token savings claim failed**
  - Query set: `calculateCost fallback callers`, `zip import switches dashboard to imported data flow`, `API route patterns for data access and error handling`
  - Key outputs:
    - Task A: CW `2553` vs baseline `956`
    - Task B: CW `2661` vs baseline `2574`
    - Task C: CW `4276` vs baseline `3261`
  - Correct answer should have required fewer follow-ups than grep+read if the product claim held.

- **Finding: callback/HTTP flow tracing gap**
  - Query: `cw_flow({ source: "handleImport", target: "POST", max_hops: 6 })`
  - Key response: `No path found from "handleImport" to "POST" within 6 hops`
  - Correct answer: `handleImport` calls `fetch('/api/import')`, which reaches `app/api/import/route.ts:POST`.

- **Finding: parse false positive**
  - Query: `cw_status()`
  - Key response: `src/app/data/page.tsx (9 symbols, tsx) [ERROR]`
  - Correct answer: the file is valid TSX; `npm run lint` completed with warnings only, no syntax errors.

- **Finding: confidence miscalibration**
  - Query: `cw_capsule({ query: "error handling", token_budget: 2000 })`
  - Key response: `Confidence: MEDIUM`; top content included `const dynamic = 'force-dynamic'`
  - Correct answer: the relevant answer should have focused on route `try/catch`, `console.error`, and `NextResponse.json({ error }, { status: 500 })`.

- **Finding: exact search noise on common tokens**
  - Query: `cw_grep({ query: "GET", path: "src" })`
  - Key response: result #1 was `getImportDir`, not a `GET` route definition
  - Correct answer: an exact/common symbol search should prioritize actual `GET` route handlers or require an identifier-boundary mode.

- **Finding: stats dishonesty**
  - Query: `cw_stats({ session_id: "taskA-cw" })`
  - Key response: `First-pass rate: 100.0%`, `Avg follow-up reads: 0.00`
  - Correct answer: Task A required multiple follow-up `cw_read` / `cw_grep` calls after the capsule, so it was not first-pass complete.
