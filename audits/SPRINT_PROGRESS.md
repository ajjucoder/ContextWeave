# Sprint Progress

Date: 2026-03-06
Branch: main
Execution mode: single-agent

## Ticket Status

| Ticket | Tier | Status | Evidence |
|---|---|---|---|
| CW-P0-001 | P0 | done | `npm run test:field` => pass (12 tests); field regressions codified in `tests/field/review-regressions.test.ts` and CI field gate wired in `.github/workflows/ci.yml` |
| CW-P0-002 | P0 | done | `npx vitest run tests/capsule/smart-decomposer.test.ts tests/capsule/multi-pass-generator.test.ts tests/integration/task-query-quality.test.ts` => pass (23 tests); `tests/capsule/field-ranking.test.ts` and `tests/integration/eval-fixture-regressions.test.ts` lock the reviewed-project broad/task retrieval failures |
| CW-P0-003 | P0 | done | `npm run test:field` => pass; `tests/core/framework-entry-edges.test.ts` and field `cw_flow` regressions cover Next.js/Express boundary tracing |
| CW-P0-004 | P0 | done | `npm run test:field` => pass; `tests/unit/impact.test.ts`, `tests/unit/flow.test.ts`, and `tests/unit/read-file-symbol.test.ts` are green in `npm test` |
| CW-P0-005 | P0 | done | `tests/capsule/confidence-formula.test.ts`, `tests/integration/task-query-quality.test.ts`, `tests/integration/threshold-ratchet.test.ts`, and `tests/eval/quality-baseline.json` version 2 are green |
| CW-P1-001 | P1 | done | `tests/cli/status-profile.test.ts` is green in `npm test`; status/init/profile surfacing landed in CLI + MCP status paths |
| CW-P1-002 | P1 | done | `npm run test:field` => pass; EBPS markdown/yaml policy docs now surface through indexing, overview, and capsule paths |
| CW-P1-003 | P1 | done | `tests/memory/bootstrap-seeds.test.ts`, `tests/integration/passive-observation-recall.test.ts`, and `tests/integration/recall-tool-grouping.test.ts` are green in `npm test` |
| CW-P1-004 | P1 | done | `tests/unit/parser.test.ts` and parser/query coverage in `npm test` are green for CommonJS/object-literal/export gaps |
| CW-P1-005 | P1 | done | `npm run lint` => pass; `npm test` => pass; `npm run test:field` => pass; README/CATALOG/CHANGELOG/CI/tracker updated to match runtime |
| CW-P2-001 | P2 | done | `tests/capsule/semantic-reranker.test.ts` is green in `npm test`; semantic reranking is optional and measured without replacing deterministic ranking |
| CW-P2-002 | P2 | done | framework boundary/plugin extraction landed under `src/frameworks/`; framework tests remain green in `npm test` and `npm run test:field` |
| CW-P2-003 | P2 | done | `npm run eval` => pass; `npm run bench` => pass; `npm run bench:product` now exists and reports current cross-project task performance explicitly |

## Completion Summary

- P0: 5/5 done (100.0%)
- P1: 5/5 done (100.0%)
- P2: 3/3 done (100.0%)
- Overall: 13/13 done (100.0%)

## Implementation Summary

- Field regressions from Sitecraft, EBPS, Claud-ometer, and gravity proxy are encoded as release tests and now pass end to end.
- Capsule retrieval was repaired around candidate seeding, story packing, decomposition, compression, confidence calibration, and eval-session isolation so broad/task queries recover the right runtime surfaces without regressing narrow symbol reads.
- HTTP/framework tracing, navigation/impact correctness, project profiling, non-code document indexing, passive-memory cleanup, parser gap coverage, semantic reranking, and framework plugin boundaries all landed in the runtime.
- Eval/baseline handling was versioned (`tests/eval/quality-baseline.json` version `2`) and `tests/integration/update-baseline.ts --replace` now supports deliberate baseline refreshes after methodology or scoring changes.

## Test Evidence

- `npm run lint` => pass
- `npm run build` => pass
- `npm run test:field` => pass
  - 1 file, 12 tests
- `npx vitest run tests/capsule/smart-decomposer.test.ts tests/capsule/multi-pass-generator.test.ts tests/integration/task-query-quality.test.ts` => pass
  - 3 files, 23 tests
- `npx vitest run tests/eval/eval-runner.test.ts` => pass
- `npx vitest run tests/integration/eval-fixture-regressions.test.ts` => pass
- `npx vitest run tests/integration/threshold-ratchet.test.ts` => pass
  - 1 file, 3 tests
- `npm run eval` => pass
  - Overall: precision `51.0%`, recall `89.1%`, avg confidence `92.5%`, token efficiency `78.1%`, p95 latency `16.0ms`, task success `100.0%`, correction rate `100.0%`
  - `contextweave-src`: precision `49.2%`, recall `85.0%`, avg confidence `88.0%`, token efficiency `97.9%`, avg task tokens `8126.5`
  - `small-project`: precision `54.2%`, recall `95.8%`, avg confidence `100.0%`, token efficiency `45.2%`, avg task tokens `896.0`
- `npm run bench` => pass
  - Average reduction `72.5%` against target `>= 65%`
- `npm test` => pass
  - 132 files, 630 tests

## Additional Benchmark Evidence

- `npm run bench:product` => fail
  - Task success rate `33.3%`
  - Correction rate `0.0%`
  - Avg task tokens `2991.3`
  - Avg confidence `86.0%`
  - Current misses:
    - `express-router-pipeline`
    - `zod-parse-pipeline`
- This benchmark is now implemented and tracked as a north-star P2 signal. It is not the release gate for the field-recovery plan, but it remains the next quality frontier after the verified P0/P1 recovery work.

## Blockers

- No blocking implementation blockers remain for the field-recovery plan.

## Next Actions

1. Use `npm run bench:product` as the first post-recovery optimization loop for Express/Zod broad conceptual tasks.
2. Raise cross-project task success before tightening eval tolerances or declaring product-benchmark parity with commercial context engines.
