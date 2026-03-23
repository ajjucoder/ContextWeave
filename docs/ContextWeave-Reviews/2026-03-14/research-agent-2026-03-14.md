# ContextWeave Field Review: research-agent

**Date:** 2026-03-14
**ContextWeave Version:** 0.1.0

## Project Profile

| Metric | Value |
|--------|-------|
| Project | research-agent |
| Stack | Python CLI package, setuptools console scripts, file-based research pipeline |
| Lines of Code | 1,468 Python LOC |
| Source Files | 14 Python files |
| Symbols Indexed | 130 |
| Languages | python (14), markdown (10), yaml (2), bash (1), toml (1) |
| Index Time | 1.17s |
| Architecture | Small Python package with thin CLI entrypoints/wrappers and staged artifact handoff: collectors write JSON/CSV summaries, reporter discovers latest artifacts by filename |
| Key Directories | `src/research_agent`, `scripts`, `tests`, `docs`, `prompts`, `references` |

## Task-Based Results

### Task A: Understand `resolve_query_config` and what downstream behavior it controls

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 2,389 | 2,221 |
| Tool calls | 12 | 6 |
| Completeness | Partial | Complete |
| Time to correct answer | 386 ms | 64 ms |

**What ContextWeave found:** The function contract, upstream helpers (`resolve_query_text`, `parse_query`, `minimum_term_matches`, `build_web_query_variants`), and the two focused tests were easy to retrieve once I manually steered the reads.

**What ContextWeave missed:** The initial capsule did not surface the actual downstream usage in `collect_web_x.main()`, which is the important part of the question because `required_terms` and `match_threshold` drive filtering. The capsule follow-ups pointed at `split_terms`, `_search_terms_from_entities`, and `_count_term_hits` instead.

**Follow-up suggestions useful?** No. They were not the functions I needed to answer the actual task.

**Winner:** Grep+Read

### Task B: Trace the end-to-end flow from query/date-window inputs to `research_report_<timestamp>.md`

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 6,971 | 7,184 |
| Tool calls | 8 | 7 |
| Completeness | Complete | Complete |
| Time to correct answer | 841 ms | 36 ms |

**What ContextWeave found:** With manual `cw_read()` ranges, it was possible to reconstruct the core pipeline: console-script entrypoints in `pyproject.toml`, collectors writing timestamped JSON/CSV artifacts, and `build_recommendation.main()` discovering those artifacts with `find_latest()`.

**What ContextWeave missed:** The initial capsule led with `discover_subreddits()` instead of the actual pipeline spine, and `cw_flow(source: "parse_query")` stayed inside `query_classifier.py` instead of tracing the real end-to-end path. The artifact contract only became clear after large manual reads.

**Follow-up suggestions useful?** No. `cw_read(symbol: "main")` is too ambiguous and too broad to be a good next step in a repo with three `main()` functions.

**Winner:** Grep+Read

### Task C: Explain how `QueryType` drives the pipeline and where quality guarantees are enforced vs assumed

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 11,044 | 13,211 |
| Tool calls | 12 | 9 |
| Completeness | Partial | Complete |
| Time to correct answer | 400 ms | 41 ms |

**What ContextWeave found:** `cw_overview()` correctly identified the main code files, and targeted reads were enough to show that `QueryType` feeds variant generation, thresholding, and scoring mode selection.

**What ContextWeave missed:** The capsule itself was poor. It surfaced `prompts/codex_bootstrap_prompt.md` and suggested reading a nonsense synthetic markdown symbol. It also did not cleanly separate “guarantees enforced in collectors” from “values simply copied into report payloads.” Core file reads silently truncated at 200 lines unless I compensated.

**Follow-up suggestions useful?** No. They mixed relevant code with clearly irrelevant prompt/doc symbols.

**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 20,404
- Total Grep+Read tokens across 3 tasks: 22,616
- Actual savings: 9.8%

## Stress Test Results

### Exact Symbol Ranking

| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `parse_query` | Yes | Nothing in the capsule; raw text grep still had an import before the definition |
| `resolve_query_config` | Yes | Nothing |
| `main` | Yes, but arbitrary | Nothing outranked it, but ContextWeave picked one of three `main()` definitions without disambiguation |

### Confidence Honesty

| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `architecture` | LOW | 425/2000 | Yes, mostly. The answer was bad and the confidence was low, but it still surfaced a plan doc instead of code |
| `quality guarantees` | HIGH | 866/2000 | No. The capsule returned `README.md` and `docs/plans/IMPLEMENTATION_PLAN_END_TO_END.md`, not the actual enforcement points in code |

### Budget Utilization

| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `parse_query` | 8000 | 735 | 9% |
| `How does QueryType control the pipeline...` | 8000 | 426 | 5% |

### Flow Tracing

| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `resolve_query_config` | Yes | No | It traces static imports/calls into `query_classifier.py`, but not the downstream `main()` usage or file-handoff contract |
| `fetch_rss_items` | No | No | `cw_flow` returned “No outgoing flows found” and admitted static-call-only limits |

### Supporting Tools

| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `artifact contract and query type architecture` | 5 | Good file inventory, weak synthesis |
| `cw_recall` | `query type quality guarantees` | 1 | Returned irrelevant memory from `.claude/CLAUDE.md` |
| `cw_impact` | `parse_query` | 7 | Useful dependents map, but noisy `__main__` nodes and import/call conflation |
| `cw_stats` | current session | 2 | Materially under-counts real token cost and inflates savings |

## Flaws Found

Ordered by severity. Each flaw includes what happened, likely root cause, and suggested fix.

### P0 (Critical — blocks adoption)
1. **The 60-70% savings claim did not survive field use**: Across three real tasks, ContextWeave used 20,404 tokens vs 22,616 for grep+read, for only 9.8% savings, and it was slower on every task (1.63s total vs 0.14s) -> likely root cause is that broad-task retrieval is too weak, so users pay for a capsule and then pay again for many `cw_read()` calls -> fix in likely `src/capsule/generator.ts`, `src/capsule/scorer.ts`, and `src/capsule/packer.ts` by optimizing for task completion cost, not capsule-only cost.
2. **`cw_stats` is not honest about session cost**: Task A `cw_stats` reported 173 tokens, but the actual Task A ContextWeave outputs totaled 2,389 tokens; Task B reported 435 vs 6,971 actual; Task C reported 145 vs 11,044 actual -> likely root cause is that `src/mcp/tools/stats.ts` or its session accounting only counts capsule payloads and ignores `cw_read`, `cw_flow`, `cw_grep`, etc. -> fix by tracking tokens for every tool response, or rename the metric to `capsule_tokens_only` and stop presenting it as total session savings.
3. **Broad code-understanding queries drift into docs/prompts and can still get HIGH confidence**: `cw_capsule({ query: "quality guarantees", token_budget: 2000 })` returned `README.md` and `docs/plans/IMPLEMENTATION_PLAN_END_TO_END.md` with `Confidence: HIGH`, even though the correct answer lives in `query_classifier.py`, `collect_reddit.py`, `collect_web_x.py`, and `build_recommendation.py` -> likely root cause is markdown/doc indexing plus lexical scoring overpowering code intent in `src/core/parser.ts`, `src/capsule/scorer.ts`, and `src/capsule/confidence.ts` -> fix by down-ranking markdown/prompt/doc files for code-review queries unless the user explicitly asks for docs, and require code-file coverage before emitting HIGH confidence on code questions.

### P1 (Important — degrades quality)
1. **Follow-up read suggestions are often the wrong next step**: Task A suggested `split_terms`, `_search_terms_from_entities`, and `_count_term_hits` instead of the downstream `main()` that actually answers the question; Task C suggested a synthetic markdown symbol from `prompts/codex_bootstrap_prompt.md` -> likely root cause is follow-up scoring in `src/capsule/formatter.ts` and/or `src/capsule/packer.ts` favoring lexical matches over causal relevance -> fix by ranking follow-ups on answer utility, not just compressed symbol score.
2. **`cw_flow` is only good at static call graphs**: `cw_flow(source: "resolve_query_config")` was useful for direct cross-file calls, but `cw_flow(source: "fetch_rss_items")` returned “No outgoing flows found” and could not help with the HTTP boundary or the file-handoff contract between collectors and reporter -> likely root cause is limited edge modeling in `src/mcp/tools/flow.ts` and `src/core/indexer.ts` -> fix by adding artifact-contract and network-boundary edges, or clearly scope the tool as static-code-only.
3. **Large budgets are mostly wasted**: On 8k-token budgets, I got 735 tokens (9%) for `parse_query` and 426 tokens (5%) for the architectural query -> likely root cause is early stopping / conservative packer behavior in `src/capsule/packer.ts` and `src/capsule/generator.ts` -> fix by continuing expansion when confidence is low and budget headroom is still large.

### P2 (Moderate — papercut)
1. **Common-symbol disambiguation is weak**: `cw_capsule("main")` returned one `main()` definition first, but there are three of them. That is technically a definition, but it is not enough to answer “which main?” -> likely root cause is narrow-query ranking not recognizing same-name ambiguity -> fix by grouping or disambiguating multiple same-name definitions before choosing one.
2. **Parse-error reporting is opaque**: Initialization reported “1 files had parse errors,” but `cw_status(verbose: true)` did not identify the file, and the persisted `files` table did not expose a useful error row -> likely root cause is aggregation in `src/cli/commands/init.ts` without corresponding surfacing in `src/cli/commands/status.ts` or `src/mcp/tools/status.ts` -> fix by listing parse-error file paths and messages in verbose status output.

## What Worked Well

- Exact symbol lookup for unique names is solid. `parse_query` and `resolve_query_config` both put the definition first.
- `cw_impact("parse_query")` gave a useful cross-file dependents map spanning collectors, report generation, and tests.
- `cw_flow("resolve_query_config")` did handle direct cross-file static calls correctly.
- `cw_status(verbose: true)` gives a helpful project profile and per-file symbol counts.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 6 |
| Broad recall (found all relevant files) | 3 |
| Budget utilization (% of budget used) | 2 |
| Confidence calibration (honest scores) | 3 |
| Flow tracing (traces real call chains) | 4 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 3 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

1. **Broad query confidence failure**
   - Query: `cw_capsule({ query: "quality guarantees", token_budget: 2000, mode: "review" })`
   - Key response: `Confidence: HIGH`, files returned `README.md` and `docs/plans/IMPLEMENTATION_PLAN_END_TO_END.md`
   - Correct answer should have centered [query_classifier.py](/Users/aejjusingh/Developer/research-agent/src/research_agent/query_classifier.py), [collect_reddit.py](/Users/aejjusingh/Developer/research-agent/src/research_agent/collect_reddit.py), [collect_web_x.py](/Users/aejjusingh/Developer/research-agent/src/research_agent/collect_web_x.py), and [build_recommendation.py](/Users/aejjusingh/Developer/research-agent/src/research_agent/build_recommendation.py)

2. **Architecture query drifted to plans instead of code**
   - Query: `cw_capsule({ query: "architecture", token_budget: 2000, mode: "review" })`
   - Key response: single top result was `IMPLEMENTATION_PLAN_END_TO_END.md`
   - Correct answer should have covered the actual runtime pipeline, not the planning document

3. **Task A follow-up suggestions were wrong**
   - Query: `cw_capsule({ query: "Understand resolve_query_config: what it returns, how it derives terms and thresholds, and what downstream behavior it controls", token_budget: 1800, mode: "review" })`
   - Key response: follow-ups suggested `split_terms`, `_search_terms_from_entities`, `_count_term_hits`
   - Correct answer required `resolve_query_text`, `parse_query`, `minimum_term_matches`, `build_web_query_variants`, and the downstream filtering in [collect_web_x.py](/Users/aejjusingh/Developer/research-agent/src/research_agent/collect_web_x.py)

4. **`cw_stats` under-counted real usage**
   - Query/task: Task A session (`cw_capsule` + 9 `cw_read`/`cw_impact` calls + `cw_stats`)
   - Key response: `cw_stats` reported `Total tokens used: 173`
   - Correct accounting of actual ContextWeave outputs for that task was 2,389 tokens

5. **Flow tracing failed on the HTTP-boundary case**
   - Query: `cw_flow({ source: "fetch_rss_items", max_hops: 4 })`
   - Key response: `No outgoing flows found ... analysis is primarily limited to static call expressions`
   - Correct answer should at least expose that [collect_web_x.py](/Users/aejjusingh/Developer/research-agent/src/research_agent/collect_web_x.py) calls `fetch_rss_items()` from `main()` and that the function itself wraps `urllib.request.urlopen()`

6. **8k budgets were mostly unused**
   - Query: `cw_capsule({ query: "parse_query", token_budget: 8000, mode: "review" })` -> `Tokens: 735/8000`
   - Query: `cw_capsule({ query: "How does QueryType control the pipeline from ingestion to collection to scoring, and where are evidence-quality guarantees actually enforced in code versus merely assumed by downstream stages?", token_budget: 8000, mode: "review" })` -> `Tokens: 426/8000`
   - Correct behavior for low-confidence answers with huge remaining budget is to expand coverage, not stop at 5-9% utilization
