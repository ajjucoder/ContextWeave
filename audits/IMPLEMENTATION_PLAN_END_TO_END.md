# ContextWeave Review Closure Implementation Plan

Date: 2026-03-14
Project code: CW
Owner: codex
Execution mode: single-agent

## Source Of Truth
- Review corpus:
  - `audits/REVIEWS.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/reviews 3-10/*.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/2026-03-14/*.md`
- Tracking:
  - `audits/SPRINT_PROGRESS.md`
  - `audits/IMPLEMENTATION_PLAN_REVIEW_REMEDIATION_V2.md`

## Goal
Repair the remediation plan after the failed March 14 rerun, reopen any falsely closed themes, and drive execution from field evidence instead of local fixture-only confidence.

## Reset From The Previous Plan
- `CW-P0-001` through `CW-P2-006` remain historical implementation records, not proof of field closure.
- Any historical ticket whose behavior regressed or remained unproven in the March 14 field reviews is reopened here as a new active ticket.
- No ticket in this plan can reach `done` without both:
  - linked automated evidence
  - direct field evidence on the affected project shape or framework class

## Definitions

### Status Rules
- `todo`: not yet started
- `in_progress`: currently being executed
- `review`: code exists locally, but field evidence is missing or contradictory
- `blocked`: cannot be completed until an external dependency or field rerun is available
- `done`: acceptance criteria met with linked automated evidence and field evidence

### Ticket Done
- code lands
- linked tests pass
- before/after evidence is captured on a real reviewed repo or a framework-matching external repo
- `audits/SPRINT_PROGRESS.md` is updated with that evidence

### Phase Done
- every ticket in the phase is `done` or explicitly `blocked`
- no higher-severity regression was introduced
- field reruns for the phase-specific failure modes are attached in the sprint tracker

### Plan Done
- no `P0` or `P1` ticket remains in `todo`, `in_progress`, `review`, or `blocked`
- every review finding from both rounds maps to a `done` ticket or an explicit non-goal
- full verification bundle is green
- rerun score delta is materially positive versus the March 14 baseline

## Active Review Theme Matrix

| Review theme | Severity | State | Active tickets |
|---|---|---|---|
| Narrow exact-match and same-name disambiguation failures | P0 | open | `CW-P0-013`, `CW-P0-019` |
| Broad retrieval misses runtime bridge files | P0 | open | `CW-P0-014`, `CW-P0-018`, `CW-P1-011` |
| Confidence remains high on incomplete or polysemous answers | P0 | open | `CW-P0-015`, `CW-P0-014` |
| Budget utilization is low and sometimes got worse after fixes | P0 | open | `CW-P0-014`, `CW-P1-015` |
| Flow tracing fails across HTTP, callback, Convex, Tauri, WebSocket, and artifact boundaries | P0 | open | `CW-P0-017` |
| `cw_impact` misses or pollutes obvious dependents | P0 | open | `CW-P0-017`, `CW-P0-019` |
| `cw_stats` is dishonest about session success and cost | P0 | open | `CW-P0-016` |
| Cross-session feedback contamination is not field-closed | P0 | open | `CW-P0-016` |
| Docs, prompts, tests, vendor files, and passive memory pollute code capsules | P0 | open | `CW-P0-018`, `CW-P1-013` |
| Path-qualified navigation is inconsistent across tools and displays | P1 | open | `CW-P0-019`, `CW-P1-012` |
| `cw_overview` remains too lexical for semantic architecture queries | P1 | open | `CW-P1-011` |
| Intent classification routes concept queries down the wrong path | P1 | open | `CW-P1-011` |
| Follow-up suggestions are wrong, ambiguous, or inconsistent with structured output | P1 | open | `CW-P1-012` |
| `cw_recall` behaves like telemetry search instead of useful memory | P1 | open | `CW-P1-013` |
| `cw_grep` exact-symbol lookup does not rank definitions first | P1 | open | `CW-P1-014` |
| Parser/status/reindex trust is weak on real repos | P1 | open | `CW-P0-020` |

## Phase Plan

### Phase 0: Tracker Reset And Safety Rails
- purpose: replace false closure claims with honest ticket state and verification gates
- tickets: `CW-P0-016`, `CW-P1-015`

### Phase 1: Retrieval Precision And Corpus Hygiene
- purpose: fix wrong-file, wrong-symbol, wrong-corpus first-pass failures before any widening
- tickets: `CW-P0-013`, `CW-P0-014`, `CW-P0-018`, `CW-P0-019`, `CW-P1-011`, `CW-P1-012`, `CW-P1-014`

### Phase 2: Runtime Graph Closure
- purpose: make `cw_flow` and `cw_impact` useful across the real framework boundaries exposed in the reviews
- tickets: `CW-P0-017`

### Phase 3: Trust Surfaces And Operator Signals
- purpose: make stats, status, reindex, and parse diagnostics truthful enough for field review
- tickets: `CW-P0-020`, `CW-P0-016`

### Phase 4: Memory And Recall Hygiene
- purpose: separate project memory from passive telemetry and stop memory bleed into capsules
- tickets: `CW-P1-013`, `CW-P0-018`

### Phase 5: Field Closure
- purpose: rerun the real reviewed query shapes and rescore the matrix
- tickets: `CW-P1-015`

## Ticket Catalog

### P0 Blocking Remediation

#### CW-P0-013
- owner: codex
- scope/files: `src/capsule/pivot-scorer.ts`, `src/capsule/generator.ts`, `src/capsule/formatter.ts`, `tests/capsule/pivot-scorer.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - exact whole-symbol definitions outrank fuzzy neighbors for common names such as `GET`, `ProductModel`, and `main`
  - same-name collisions produce explicit disambiguation instead of silently picking one definition
  - narrow exact-symbol capsules do not widen into unrelated adjacent helpers unless the query asks broader intent
- linked tests:
  - `npx vitest run tests/capsule/pivot-scorer.test.ts tests/field/review-regressions.test.ts`
- status: todo

#### CW-P0-014
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/capsule/packer.ts`, `src/capsule/confidence.ts`, `src/core/repo-profiler.ts`, `tests/capsule/story-packing.test.ts`, `tests/integration/threshold-ratchet.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - broad and task capsules recover missing runtime bridge files before confidence can rise above `MEDIUM`
  - budget refill uses coherent adjacent context and layer coverage, not random pool widening
  - broad-task utilization and first-pass completeness improve together on real reviewed queries
- linked tests:
  - `npx vitest run tests/capsule/story-packing.test.ts tests/integration/threshold-ratchet.test.ts tests/field/review-regressions.test.ts`
- status: todo

#### CW-P0-015
- owner: codex
- scope/files: `src/capsule/confidence.ts`, `src/capsule/diagnostics.ts`, `src/capsule/generator.ts`, `tests/unit/confidence-calibration.test.ts`, `tests/integration/threshold-ratchet.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - confidence is capped by answer-shape coverage, ambiguity dispersion, and missing expected layers
  - one-word concept queries such as `state`, `config`, and `session` do not receive narrow-query confidence unless backed by exact-symbol evidence
  - broad answers that miss the runtime bridge file cannot report `HIGH`
- linked tests:
  - `npx vitest run tests/unit/confidence-calibration.test.ts tests/integration/threshold-ratchet.test.ts tests/field/review-regressions.test.ts`
- status: todo

#### CW-P0-016
- owner: codex
- scope/files: `src/hooks/post-tool-use.ts`, `src/db/queries/capsule-log.ts`, `src/mcp/tools/stats.ts`, `tests/integration/post-tool-use.test.ts`, `tests/integration/mcp-navigation-tools.test.ts`
- acceptance criteria:
  - cross-session feedback writes are session-scoped and cannot update another session's capsule row
  - `cw_stats` counts `cw_read`, `cw_grep`, `cw_flow`, `cw_impact`, and `cw_overview` as follow-up activity
  - stats clearly separate capsule-only metrics from end-to-end session cost
- linked tests:
  - `npx vitest run tests/integration/post-tool-use.test.ts tests/integration/mcp-navigation-tools.test.ts`
- status: todo

#### CW-P0-017
- owner: codex
- scope/files: `src/core/parser.ts`, `src/core/event-edge-synthesis.ts`, `src/core/weighted-bfs.ts`, `src/mcp/tools/flow.ts`, `src/mcp/tools/impact.ts`, `tests/unit/flow.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - flow and impact work across the framework boundaries seen in the reviews: HTTP/fetch, JSX callbacks, Convex `api.*` and `internal.*`, Tauri `invoke/listen/emit_all`, WebSocket send/receive, adapter callbacks, and artifact handoff where supported
  - flow prioritizes executable runtime edges above import and type edges
  - impact output distinguishes direct callers from low-signal importer or test noise
- linked tests:
  - `npx vitest run tests/unit/flow.test.ts tests/field/review-regressions.test.ts`
- status: todo

#### CW-P0-018
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/utils/config.ts`, `src/utils/directory-weights.ts`, `src/memory/bootstrap.ts`, `src/capsule/generator.ts`, `src/capsule/formatter.ts`, `tests/core/index-pollution.test.ts`, `tests/memory/bootstrap-seeds.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - docs, prompts, plans, AGENTS, passive observations, tests, fixtures, and vendor assets are excluded or sharply demoted for code-understanding queries unless explicitly requested
  - bootstrap and passive memory cannot bleed into unrelated code capsules
  - mixed-language repos no longer let vendored JS outrank the primary backend runtime
- linked tests:
  - `npx vitest run tests/core/index-pollution.test.ts tests/memory/bootstrap-seeds.test.ts tests/field/review-regressions.test.ts`
- status: todo

#### CW-P0-019
- owner: codex
- scope/files: `src/mcp/tools/read.ts`, `src/mcp/tools/impact.ts`, `src/mcp/tools/overview.ts`, `src/capsule/formatter.ts`, `src/capsule/generator-helpers.ts`, `tests/integration/mcp-navigation-tools.test.ts`, `tests/unit/formatter-followup.test.ts`
- acceptance criteria:
  - file-qualified reads and impacts stay pinned to the supplied file and fail loudly instead of falling back globally
  - human-readable and structured follow-up commands use the same repo-relative path contract
  - path displays remain shortened only when the full repo-relative path is preserved for navigation
- linked tests:
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts tests/unit/formatter-followup.test.ts`
- status: todo

#### CW-P0-020
- owner: codex
- scope/files: `src/core/parser.ts`, `src/mcp/tools/status.ts`, `src/mcp/tools/reindex.ts`, `src/cli/commands/status.ts`, `src/cli/commands/reindex.ts`, `tests/unit/parser.test.ts`, `tests/integration/mcp-server.test.ts`
- acceptance criteria:
  - TSX parse recovery does not show valid files as fatal errors
  - status exposes version, last indexed timestamp, last full reindex duration, and parse-error file details
  - reindex output clearly distinguishes cold rebuild from incremental update and reports processed, skipped, and total counts
- linked tests:
  - `npx vitest run tests/unit/parser.test.ts tests/integration/mcp-server.test.ts`
- status: todo

### P1 Stabilization And Field Closure

#### CW-P1-011
- owner: codex
- scope/files: `src/core/file-summaries.ts`, `src/mcp/tools/overview.ts`, `src/capsule/intent-classifier.ts`, `src/capsule/query-decomposer.ts`, `tests/core/file-summaries.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - `cw_overview` ranks by body semantics and code intent, not just path tokens
  - concept queries and architecture questions no longer default to narrow-symbol handling
  - monorepo and mixed-repo path scoping remain coherent in overview outputs
- linked tests:
  - `npx vitest run tests/core/file-summaries.test.ts tests/field/review-regressions.test.ts`
- status: todo

#### CW-P1-012
- owner: codex
- scope/files: `src/capsule/formatter.ts`, `src/capsule/generator.ts`, `src/capsule/packer.ts`, `tests/unit/formatter-followup.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - follow-up suggestions rank by unresolved query gaps and missing layers, not local lexical score alone
  - visible follow-up text is generated from the same data as structured suggested reads
  - ambiguous or low-confidence follow-ups are omitted rather than emitted as traps
- linked tests:
  - `npx vitest run tests/unit/formatter-followup.test.ts tests/field/review-regressions.test.ts`
- status: todo

#### CW-P1-013
- owner: codex
- scope/files: `src/mcp/tools/recall.ts`, `src/memory/search.ts`, `src/memory/passive.ts`, `src/memory/observations.ts`, `tests/memory/recall-quality.test.ts`, `tests/memory/observation-promotion.test.ts`
- acceptance criteria:
  - intentional observations rank ahead of passive telemetry by default
  - passive recall and capsule-time passive injection are governed separately
  - project-concept recall is either materially useful or explicitly scoped as session-memory only
- linked tests:
  - `npx vitest run tests/memory/recall-quality.test.ts tests/memory/observation-promotion.test.ts`
- status: todo

#### CW-P1-014
- owner: codex
- scope/files: `src/mcp/tools/search.ts`, `src/mcp/tools/ripgrep.ts`, `src/mcp/tools/path-filters.ts`, `tests/integration/mcp-navigation-tools.test.ts`
- acceptance criteria:
  - exact-symbol and identifier-boundary search modes are available for common tokens
  - exact-symbol grep ranks definitions above imports, tests, and nearby substring matches
  - existing regex and glob ergonomics remain consistent
- linked tests:
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: todo

#### CW-P1-015
- owner: codex
- scope/files: `tests/field/`, `bench/`, `audits/SPRINT_PROGRESS.md`, `audits/IMPLEMENTATION_PLAN_REVIEW_REMEDIATION_V2.md`, `audits/IMPLEMENTATION_PLAN_END_TO_END.md`
- acceptance criteria:
  - the field harness covers the actual failing framework classes from the reviews, not just generic repo types
  - each reopened theme is rerun on a matching external codebase before closure
  - sprint reporting shows reopened, blocked, and closed themes honestly
- linked tests:
  - `npx vitest run tests/field/review-regressions.test.ts`
- status: in_progress

## Execution Order
1. Start with `CW-P1-015` and keep it open until the end of the sprint.
2. Close truth and safety rails first: `CW-P0-016`, `CW-P0-018`, `CW-P0-019`, `CW-P0-020`.
3. Fix retrieval correctness before retrieval breadth: `CW-P0-013`, `CW-P0-014`, `CW-P0-015`, `CW-P1-011`, `CW-P1-012`, `CW-P1-014`.
4. Fix runtime graph failures in `CW-P0-017`.
5. Finish memory hygiene in `CW-P1-013`.
6. Rerun the field matrix and reopen anything that still fails.

## Verification Bundle

### Minimum Per Ticket
- run the linked tests
- capture before/after evidence on at least one matching reviewed query
- update `audits/SPRINT_PROGRESS.md`

### Minimum Per Phase
- `npm run lint`
- `npm test`
- `npx vitest run tests/field/review-regressions.test.ts`
- `npx vitest run tests/integration/threshold-ratchet.test.ts`

### Field Closure Bundle
- rerun the exact failing query shapes on framework-matching external repos:
  - Next.js/Supabase app
  - Spring Boot mixed backend/static app
  - Tauri desktop app
  - Convex or generated-API app
  - callback-heavy TypeScript service/app
  - Python repo with artifact handoff flow
- capture:
  - query
  - capsule output before and after
  - measured CW token cost including follow-up tools
  - measured grep-plus-read baseline
  - whether the missing bridge file or path is now present

## Stop Condition
Do not stop because the code changed or local fixtures are green. Stop only when:
- every `P0` and `P1` ticket in this active plan is `done`
- rerun scores improve against the March 14 baseline
- no orphan review findings remain
- the sprint tracker reports no unresolved blocker without a named next action
