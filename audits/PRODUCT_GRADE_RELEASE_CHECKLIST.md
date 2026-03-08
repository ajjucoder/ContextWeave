# Product-Grade Release Checklist

This checklist defines the minimum evidence required to call ContextWeave product-grade for release.

## Core Gates

- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test:field`
- `npm run eval`
- `npm run bench:product`

All six commands must pass on the release candidate branch tip with fresh evidence captured in `audits/SPRINT_PROGRESS.md`.

## Eval Thresholds

`npm run eval --assert` must satisfy the thresholds enforced in `tests/eval/eval-runner.ts`:

- precision `>= 15.0%`
- recall `>= 70.0%`
- average confidence `>= 65.0%`
- average token efficiency `>= 60.0%`
- p95 latency `<= 75.0ms`
- task success rate `>= 50.0%`
- first-pass success rate `>= 70.0%`
- average turns to success `<= 1.30`

The current intended release target is stronger than the floor:

- task success rate `100.0%`
- first-pass success rate `100.0%`
- correction rate `0.0%`

## Product-Benchmark Thresholds

`npm run bench:product` must satisfy the thresholds enforced in `bench/cross-project-qa.ts`:

- task success rate `>= 66.7%`
- first-pass success rate `>= 66.7%`
- correction rate `<= 30.0%`
- average confidence `>= 65.0%`

The benchmark must remain pinned and reproducible. Slow product checks run at three cadences:

- on-demand via `.github/workflows/product-bench.yml`
- nightly for drift detection
- on `release.published`

## Coverage Requirements

Release evidence must cover these retrieval classes:

- narrow symbol lookup
- broad conceptual architecture retrieval
- task-oriented implementation retrieval
- framework boundary tracing
- policy and config document retrieval
- session follow-up behavior without bleed

Release evidence must also cover these corpus shapes:

- framework-heavy backend repo
- policy/doc-heavy repo
- small mixed runtime fixture
- pages-router style Next.js fixture

## Tracker Requirements

- every completed ticket has linked test evidence in `audits/SPRINT_PROGRESS.md`
- open tickets are either `todo`, `in_progress`, or carry an explicit blocker note
- the completion summary matches the ticket table math exactly
- the implementation summary reflects the current enforced gates

## Operator-Surface Requirements

- CI docs mention `npm run eval` as part of the main gate
- docs mention the slower `product-bench` cadence separately from push CI
- status and overview surfaces describe first-pass quality honestly enough for operators to detect correction dependence

## Release Decision

ContextWeave is release-ready only when:

- all P0 and P1 tickets are closed with evidence
- remaining P2 tickets do not undermine first-pass quality claims
- the latest eval and product-benchmark runs meet or exceed the thresholds above
- no known blocker in `audits/SPRINT_PROGRESS.md` contradicts the release claim
