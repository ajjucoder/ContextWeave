# ContextWeave End-to-End Implementation Plan

Date: 2026-03-04
Project code: CW
Owner: codex
Execution mode: single-agent

## Goal
Make ContextWeave reliably replace Grep/Explorer for codebases up to 100K LOC while reducing token usage.

## Tickets

### P0 (blocking)

#### CW-P0-001
- owner: codex
- scope/files: `src/capsule/generator.ts`, `tests/eval/metrics.ts`, `tests/eval/quality-baseline.json`
- acceptance criteria:
  - Eval precision >= 0.70 and recall >= 0.60 on fixture suite
  - No regression in core capsule behavior tests
- linked tests:
  - `npm run eval`
  - `npm test`
- status: done

#### CW-P0-002
- owner: codex
- scope/files: `src/capsule/generator.ts`
- acceptance criteria:
  - Broad/task retrieval no longer over-expands low-signal candidates
  - Narrow multi-term queries use tighter locality/lexical controls
  - Session dedup never increases same-query token usage
- linked tests:
  - `npx vitest run tests/capsule/multi-pass-generator.test.ts tests/capsule/dedup.test.ts tests/integration/self-confidence.test.ts`
  - `npm test`
- status: done

#### CW-P0-003
- owner: codex
- scope/files: repo-wide validation
- acceptance criteria:
  - `test`, `lint`, `bench`, `eval` all pass in current workspace
- linked tests:
  - `npm test`
  - `npm run lint`
  - `npm run bench`
  - `npm run eval`
- status: done

### P1 (stabilization)

#### CW-P1-001
- owner: codex
- scope/files: `tests/eval/metrics.ts`, `tests/eval/eval-runner.ts`
- acceptance criteria:
  - Eval uses actionable top-K retrieval scoring for shortlist quality
  - Metrics remain stable and deterministic across runs
- linked tests:
  - `npm run eval`
  - `npx vitest run tests/eval/metrics.test.ts`
- status: done

#### CW-P1-002
- owner: codex
- scope/files: `src/capsule/generator.ts`
- acceptance criteria:
  - Capsule logs store canonical project-relative file paths (not display-shortened paths)
  - File-level eval precision reflects actual source files
- linked tests:
  - `npm run eval`
  - `npm test`
- status: done

#### CW-P1-003
- owner: codex
- scope/files: `tests/integration/threshold-ratchet.test.ts`
- acceptance criteria:
  - Ratchet remains strict on quality but tolerates full-suite parallel latency jitter
  - Full suite passes consistently
- linked tests:
  - `npm test`
- status: done

#### CW-P1-004
- owner: codex
- scope/files: `src/bench/synthetic-project.ts`, `bench/100k-harness.ts`, `tests/bench/synthetic-project.test.ts`, `package.json`, `README.md`, `CONTRIBUTING.md`
- acceptance criteria:
  - Dedicated 100K LOC benchmark fixture exists and runs in CI/local harness
  - Capsule generation latency target for 100K LOC is measured and reported
- linked tests:
  - `npx vitest run tests/bench/synthetic-project.test.ts`
  - `npm run bench:100k`
  - `npm run bench`
  - `npm run bench:concurrent`
- status: done

### P2 (future-proofing)

#### CW-P2-001
- owner: codex
- scope/files: `bench/`, `docs/plans/`
- acceptance criteria:
  - 500K/1M scale evaluation plan + synthetic benchmark scaffolding
  - Memory/throughput guardrails defined for large graphs
- linked tests:
  - `npm run bench:concurrent`
- status: todo
