# ContextWeave Field Recovery Implementation Plan

Date: 2026-03-06
Project code: CW
Owner: codex
Execution mode: single-agent

## Goal
Make ContextWeave reliably beat ad-hoc `grep` + `read` for real agent workflows in web and Python codebases by fixing the failures shown in external reviews: low-relevance capsules, broken cross-boundary flow tracing, noisy memory, poor framework awareness, and misleading confidence.

## Product Direction
- ContextWeave is being developed as a better open-source alternative to Augment's context engine layer.
- The product goal is not "index code and look impressive on synthetic benchmarks." The product goal is: agents find the right things faster, spend fewer tokens, trust the retrieval, and complete real coding tasks with less manual grep/read recovery.
- Success should be judged by real task completion quality on live-style repositories, not by token reduction alone.

## Plan Review Summary
- The previous plan overfit internal benchmarks, synthetic harnesses, and self-hosted evals.
- It did not gate success on real-world task queries from actual projects, so broad-query failures escaped.
- It marked validation complete even though the current workspace is not type-clean and the public docs no longer match the runtime tool surface.
- This replacement plan uses field regressions as the primary release gate and treats token reduction as a task-success metric, not a vanity benchmark.

## Success Criteria
- Broad/task capsules on the field regression suite reach median pivot coverage >= 75% and must-include recall >= 85%.
- `cw_flow` resolves client-to-server HTTP boundaries for supported frameworks and returns deduplicated, useful traces.
- `cw_impact` and navigation tools handle ambiguous symbols, file-level entry points, sibling exports, and common OOP/module patterns.
- `cw_recall` returns durable insights, not passive query-log noise, by default.
- `lint`, `test`, field regressions, and targeted benchmark checks all pass from the current branch.

## Execution Rules
- The implementing agent must create and maintain a proper live todo list before making substantial changes and keep it updated until every ticket in scope is completed.
- Do not stop at partial fixes. Continue until the implementation plan is completed end to end, all relevant verification passes, and any failures are resolved or explicitly documented as blockers with evidence.
- Work directly on `main` as requested. Do not create a feature branch or worktree for this execution handoff.
- Commit only after verification is green or after explicitly documenting any unavoidable blocker in the sprint tracker.
- Push the verified work to GitHub on `main` after implementation is complete.

## What Not To Do
- Do not optimize for synthetic benchmarks while field regressions remain failing.
- Do not add new user-facing tools or product surface area before fixing capsule relevance, framework/runtime tracing, navigation correctness, and confidence calibration.
- Do not hide retrieval failures behind vague confidence text, inflated metrics, or "good enough" benchmark summaries.
- Do not add semantic embeddings, fancy rerankers, or plugin abstractions first if deterministic structural bugs are still causing misses in the reviewed projects.
- Do not trust passive query logs as meaningful memory; do not keep shipping noisy recall results as if they were insight.
- Do not mark tickets done without fresh linked test evidence.
- Do not break existing narrow-query wins (`cw_read`, `cw_grep`, precise `cw_impact`) while repairing broad-query behavior.

## Tickets

### P0 (blocking)

#### CW-P0-001
- owner: codex
- scope/files: `tests/field/`, `tests/integration/`, `tests/eval/`, `package.json`, `.github/workflows/ci.yml`
- acceptance criteria:
  - Convert the review findings from Sitecraft, EBPS, Claud-ometer, and gravity proxy into reproducible field regression tests.
  - Each regression encodes `must_include`, `must_exclude`, and `must_trace` expectations for capsule, flow, impact, and read behavior.
  - CI has a dedicated field-regression gate in addition to the existing unit/integration suite.
- linked tests:
  - `npx vitest run tests/field/*.test.ts`
  - `npm test`
  - `npm run eval`
- status: done

#### CW-P0-002
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/capsule/scorer.ts`, `src/capsule/packer.ts`, `src/capsule/compressor.ts`, `src/capsule/formatter.ts`, `tests/capsule/`, `tests/integration/`
- acceptance criteria:
  - Broad/task capsules prioritize route handlers, stateful services, database writes, and entrypoint logic over render-only templates, duplicate legacy code, and incidental utilities.
  - Secondary content defaults to summary/reference form unless it is a top-scored pivot or a required bridge node.
  - The reviewed "inquiry flow", "session detail loading", and "OAuth/auth flow" queries stop exhausting budget on irrelevant bodies.
- linked tests:
  - `npx vitest run tests/capsule/*.test.ts tests/integration/task-query-quality.test.ts`
  - `npx vitest run tests/field/*.test.ts`
  - `npm test`
- status: done

#### CW-P0-003
- owner: codex
- scope/files: `src/core/parser.ts`, `src/core/indexer.ts`, `src/core/types.ts`, `src/utils/path-retrieval.ts`, `src/mcp/tools/flow.ts`, `src/mcp/tools/impact.ts`, `tests/core/`, `tests/integration/`, `tests/field/`
- acceptance criteria:
  - Index and traverse HTTP/service boundaries for supported conventions:
    - Next.js `fetch('/api/...')` -> `app/api/**/route.ts`
    - Express/Koa/Fastify-style route registration -> handler symbol
  - `cw_flow` can trace client -> route -> server/service for the reviewed web-app scenarios.
  - Flow output deduplicates trivial import noise and highlights boundary transitions explicitly.
- linked tests:
  - `npx vitest run tests/core/framework-entry-edges.test.ts tests/integration/mcp-navigation-tools.test.ts`
  - `npx vitest run tests/field/*.test.ts`
  - `npm test`
- status: done

#### CW-P0-004
- owner: codex
- scope/files: `src/mcp/tools/flow.ts`, `src/mcp/tools/impact.ts`, `src/mcp/tools/read.ts`, `src/mcp/tools/overview.ts`, `src/db/queries/symbols.ts`, `tests/unit/`, `tests/integration/`, `tests/field/`
- acceptance criteria:
  - Ambiguous symbol queries return disambiguated candidates or accept full-path targeting reliably.
  - File-level entry points, common script names, and sibling exports are first-class navigation/impact targets.
  - `cw_impact` accounts for same-module sibling exports and common class/module usage patterns instead of only direct import edges.
- linked tests:
  - `npx vitest run tests/unit/impact.test.ts tests/unit/flow.test.ts tests/unit/read-file-symbol.test.ts`
  - `npx vitest run tests/field/*.test.ts`
  - `npm test`
- status: done

#### CW-P0-005
- owner: codex
- scope/files: `src/capsule/confidence.ts`, `src/capsule/diagnostics.ts`, `src/capsule/generator.ts`, `tests/capsule/`, `tests/integration/`
- acceptance criteria:
  - Confidence and uncertainty correlate with actual field-test recall instead of defaulting to low-confidence on small or medium projects.
  - Diagnostic reasons become actionable and specific, e.g. missing route edge, budget exhausted before required pivots, unresolved dynamic boundary.
  - Release docs stop instructing agents to over-trust low-coverage capsules.
- linked tests:
  - `npx vitest run tests/capsule/confidence-5level.test.ts tests/capsule/diagnostics.test.ts`
  - `npx vitest run tests/field/*.test.ts`
  - `npm test`
- status: done

### P1 (stabilization)

#### CW-P1-001
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/utils/config.ts`, `src/cli/commands/init.ts`, `src/mcp/tools/status.ts`, `tests/security/`, `tests/cli/`, `tests/core/`
- acceptance criteria:
  - Project profiling surfaces active roots, excluded roots, and suspicious noise directories during init/status.
  - Language-aware ignore defaults and `.cwignore` UX are explicit and validated for Python, JS/TS, and mixed repos.
  - Legacy/demo/vendor/venv pollution is either excluded or clearly explained in status output.
- linked tests:
  - `npx vitest run tests/security/*.test.ts tests/cli/*.test.ts tests/core/reindex-*.test.ts`
  - `npm test`
- status: done

#### CW-P1-002
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/core/types.ts`, `src/db/schema.ts`, `src/db/migrations.ts`, `src/mcp/tools/read.ts`, `src/mcp/tools/overview.ts`, `tests/core/`, `tests/integration/`
- acceptance criteria:
  - Markdown, JSON, and YAML documents can be indexed as structured retrieval units where they materially shape behavior.
  - Capsules and navigation can surface rule/config documents for codebases like EBPS without polluting symbol retrieval.
  - Read/overview tools can show document summaries and targeted excerpts safely.
- linked tests:
  - `npx vitest run tests/core/*.test.ts tests/integration/*.test.ts`
  - `npm test`
- status: done

#### CW-P1-003
- owner: codex
- scope/files: `src/memory/passive.ts`, `src/memory/observations.ts`, `src/memory/search.ts`, `src/hooks/post-tool-use.ts`, `src/hooks/session-end.ts`, `tests/memory/`, `tests/integration/`
- acceptance criteria:
  - Passive query-resolution logs are hidden or heavily downweighted by default in `cw_recall`.
  - Durable observations can be seeded automatically from `CLAUDE.md`, `README`, architecture docs, and validated follow-up actions.
  - `cw_recall` returns concise insights first, not raw search-history noise.
- linked tests:
  - `npx vitest run tests/memory/*.test.ts tests/integration/passive-observation-recall.test.ts tests/integration/recall-tool-grouping.test.ts`
  - `npm test`
- status: done

#### CW-P1-004
- owner: codex
- scope/files: `src/core/parser.ts`, `src/core/queries/javascript.ts`, `src/core/queries/python.ts`, `tests/core/`, `tests/unit/`
- acceptance criteria:
  - JavaScript object-literal exports, `module.exports`, IIFEs, and browser-global assignment patterns produce usable symbols/edges.
  - Python CLI entrypoints and `__main__`-style scripts are discoverable for impact/flow/navigation.
  - Reviewed "zero-symbol utility/config file" cases are covered by parser tests.
- linked tests:
  - `npx vitest run tests/core/*.test.ts tests/unit/parser.test.ts`
  - `npm test`
- status: done

#### CW-P1-005
- owner: codex
- scope/files: `README.md`, `CATALOG.md`, `CHANGELOG.md`, `audits/IMPLEMENTATION_PLAN_END_TO_END.md`, `audits/SPRINT_PROGRESS.md`, `.github/workflows/ci.yml`
- acceptance criteria:
  - Public docs match the actual tool surface, watcher implementation, uncertainty model, and current test/benchmark footprint.
  - Sprint tracker reflects current evidence only; no ticket is marked done without fresh verification.
  - CI gates on `lint`, `test`, and the new field-regression suite.
- linked tests:
  - `npm run lint`
  - `npm test`
  - `npx vitest run tests/field/*.test.ts`
- status: done

### P2 (future-proofing)

#### CW-P2-001
- owner: codex
- scope/files: `src/capsule/`, `src/memory/`, `src/utils/`, `bench/`, `docs/plans/`
- acceptance criteria:
  - Add an optional local semantic reranking layer for broad conceptual queries after deterministic structural fixes are complete.
  - Measure whether semantic reranking improves field-suite must-include recall without hiding explainability.
- linked tests:
  - `npx vitest run tests/field/*.test.ts`
  - `npm run bench`
- status: done

#### CW-P2-002
- owner: codex
- scope/files: `src/frameworks/`, `src/core/`, `src/mcp/tools/`, `docs/plans/`
- acceptance criteria:
  - Framework-specific indexing/tracing moves behind a plugin boundary instead of accumulating ad-hoc heuristics in core retrieval.
  - First plugin boundary supports at least Next.js and Express conventions cleanly.
- linked tests:
  - `npx vitest run tests/field/*.test.ts tests/integration/*.test.ts`
  - `npm test`
- status: done

#### CW-P2-003
- owner: codex
- scope/files: `docs/plans/`, `bench/`, `tests/eval/`
- acceptance criteria:
  - Define Augment-style product benchmarks that measure agent task completion, token spend, and correction rate against real repo tasks.
  - Use those benchmarks as the north-star comparison instead of synthetic token reduction alone.
- linked tests:
  - `npm run eval`
  - `npm run bench`
- status: done
