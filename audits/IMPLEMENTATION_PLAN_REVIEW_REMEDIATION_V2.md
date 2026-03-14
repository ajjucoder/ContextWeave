# ContextWeave Review Remediation Coverage Audit v2

Date: 2026-03-14
Scope: March 10 review round plus March 14 rerun
Status: corrected planning baseline
Canonical execution plan: `audits/IMPLEMENTATION_PLAN_END_TO_END.md`

## Why This Rewrite Exists

The prior v2 draft had the right instinct, but it still had the same planning bug that hurt the product:
- it treated some categories as "covered" when the underlying root cause was different
- it collapsed distinct failures into one vague fix bucket
- it omitted a few earlier findings entirely while still claiming "no orphan findings"

This rewrite is the coverage audit that the execution plan must satisfy.

## What The Previous Draft Got Right
- It correctly recognized that March 14 was worse than March 10.
- It correctly identified widening-without-tightening as a regression source.
- It correctly prioritized `cw_stats`, path-qualified reads, budget underfill, follow-up quality, and runtime-edge tracing.

## What The Previous Draft Missed

### Orphan Findings
- Cross-session feedback contamination from `post-tool-use` and capsule-log updates
- Capsule-time passive/bootstrap memory bleed into unrelated code answers
- Earlier `cw_capsule` structured metadata loss at the MCP boundary
- Intent-classifier misrouting of concept and question-form narrow queries
- `cw_overview` semantic ranking failures caused by weak body semantics, not just doc noise
- Human-readable follow-up suggestions diverging from structured suggested reads
- Exact-symbol grep noise for common tokens such as `GET`
- Status/reindex metadata needed for field review: version, full-index timing, cold-vs-incremental distinction

### Incorrectly Mapped Findings
- "`cw_overview` too lexical" was not solved by doc exclusion alone. It requires body-semantic ranking work.
- "`cw_recall` weak" was not the same bug as passive memory bleeding into capsules. Both need separate tickets.
- "File-qualified `cw_read` wrong file" and "`cw_impact` file-qualified conflation" are related, but not one fix.
- "Budget utilization poor" and "broad recall poor" cannot be treated as the same ticket. One can improve while the other regresses.

## Active Ticket Mapping

The execution plan now uses the following active tickets:

| Ticket | Theme |
|---|---|
| `CW-P0-013` | exact-match dominance and same-name disambiguation |
| `CW-P0-014` | broad retrieval completeness and budget-fill correctness |
| `CW-P0-015` | confidence gating by ambiguity and answer-shape coverage |
| `CW-P0-016` | session accounting honesty and cross-session safety |
| `CW-P0-017` | runtime-edge flow and impact closure |
| `CW-P0-018` | corpus hygiene and capsule-time memory pollution |
| `CW-P0-019` | path-qualified navigation and path contract consistency |
| `CW-P0-020` | parser/status/reindex trust surfaces |
| `CW-P1-011` | overview semantics and intent classification |
| `CW-P1-012` | follow-up usefulness and text/structured parity |
| `CW-P1-013` | recall hygiene and passive-memory demotion |
| `CW-P1-014` | exact-symbol grep and definition-first ranking |
| `CW-P1-015` | field harness expansion and honest closure reporting |

## Review Finding To Ticket Cross-Reference

### March 14 Round

| Finding | Ticket coverage |
|---|---|
| `cw_stats` says 100% first-pass / 0% correction despite many CW follow-ups | `CW-P0-016` |
| cross-session stats or feedback corruption risk | `CW-P0-016` |
| broad capsules miss the bridge file or hot path | `CW-P0-014`, `CW-P1-011`, `CW-P1-015` |
| budget underfill remains severe on 8k budgets | `CW-P0-014`, `CW-P0-015`, `CW-P1-015` |
| confidence still goes high on wrong or polysemous answers | `CW-P0-015` |
| follow-up reads are wrong, ambiguous, or missing | `CW-P0-019`, `CW-P1-012` |
| `file:` versus `path:` mismatch | `CW-P0-019` |
| file-qualified `cw_read` returns the wrong file | `CW-P0-019` |
| `cw_impact` misses direct dependents or mixes same-name symbols | `CW-P0-017`, `CW-P0-019` |
| `cw_flow` misses HTTP, callback, Convex, Tauri, WebSocket, or adapter boundaries | `CW-P0-017` |
| exact-symbol lookup fails on `GET`, `main`, `ProductModel`, and similar names | `CW-P0-013`, `CW-P1-014` |
| docs, prompts, tests, plans, or vendor JS hijack capsules | `CW-P0-018`, `CW-P1-011` |
| passive observations or bootstrap notes bleed into unrelated capsules | `CW-P0-018`, `CW-P1-013` |
| overview remains lexical on semantic architecture queries | `CW-P1-011` |
| intent classification misroutes concept queries | `CW-P1-011`, `CW-P0-015` |
| human-readable follow-up text diverges from structured output | `CW-P1-012` |
| Zustand/property-style symbols are missing | `CW-P0-017` |
| parser false-positives still poison TSX trust | `CW-P0-020` |
| status does not expose version, last index time, parse-error details | `CW-P0-020` |
| reindex output hides cold-vs-incremental semantics | `CW-P0-020` |

### March 10 Round And Earlier Audit Corpus

| Finding | Ticket coverage |
|---|---|
| capsule misses the actual target definition | `CW-P0-013`, `CW-P0-014` |
| cross-session feedback contamination | `CW-P0-016` |
| confidence can report 1.0 on thin retrieval | `CW-P0-015` |
| eval gates allowed bad quality to pass | `CW-P0-015`, `CW-P1-015` |
| structured quality metadata dropped at MCP boundary | blocked behind follow-up contract review; reopen if still present after `CW-P0-019` and `CW-P1-012` |
| follow-up commands ambiguous in large repos | `CW-P0-019`, `CW-P1-012` |
| regex and grep ergonomics inconsistent | `CW-P1-014` |
| legacy or duplicate directories pollute results | `CW-P0-018` |
| bootstrap memory pollutes code capsules | `CW-P0-018`, `CW-P1-013` |
| budget utilization poor | `CW-P0-014`, `CW-P1-015` |
| observation store is shallow | `CW-P1-013` |
| overview/file summaries lack body semantics | `CW-P1-011` |
| parser flags valid TSX as broken | `CW-P0-020` |
| existing-project upgrade or stale-index trust issues | `CW-P0-020`, `CW-P1-015` |

## Explicit Non-Goals

The active sprint does not count the following as closure:
- green synthetic fixtures without external reruns
- "looks implemented" code review
- better wording or formatting without changed behavior
- more candidate widening unless paired with better filtering and field evidence

## Execution Rules
- No ticket is `done` without linked automated evidence and field evidence.
- No broad-retrieval optimization is allowed to degrade narrow precision.
- No tool-metric claim may be presented as end-to-end value unless it includes CW follow-up tool usage.
- No coverage matrix may claim "fully mapped" unless every orphan finding listed above is explicitly handled.

## Required Field Shapes

The harness must rerun at least one repo for each failure class:
- Next.js or similar UI plus routes plus service layers
- Spring Boot or mixed backend-plus-static repo
- Tauri desktop app
- Convex or generated API reference app
- callback-heavy TypeScript service/app
- Python repo with artifact handoff or network boundary flow

## Exit Criteria For This Audit

This coverage audit is satisfied only when:
- every active ticket in `audits/IMPLEMENTATION_PLAN_END_TO_END.md` is `done` or intentionally cut
- no orphan findings remain
- the March 14 rerun categories move upward materially instead of sideways
- the sprint tracker reports honest completion math against the active reopened sprint
