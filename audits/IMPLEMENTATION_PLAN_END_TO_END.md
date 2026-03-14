# ContextWeave Review-Driven Remediation Implementation Plan

Date: 2026-03-14
Project code: CW
Owner: codex
Execution mode: single-agent

## Source Of Truth
- Review corpus:
  - `audits/REVIEWS.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/ANALYSIS-2026-03-10.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/ContextWeave-SelfReview-2026-03-10.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/EBPS-2026-03-10.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/FocusPact-2026-03-09.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/Kuvio-WebsiteBuilder-2026-03-09.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/Nudgy-2026-03-10.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/lawn-2026-03-10.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/polymarket-arbitrage-sim-2026-03-09.md`
  - `/Users/aejjusingh/Developer/ContextWeave-Reviews/t3code-2026-03-10.md`
- Current code and test audit performed on 2026-03-14.
- `audits/SPRINT_PROGRESS.md` is the only source for completion math.

## Goal
Close the remaining real-world quality gaps exposed by the ContextWeave review corpus, convert partial fixes into field-proven fixes, and institutionalize a verify-and-resprint loop that continues until the review matrix is clean.

## Expected Outcome
After this implementation plan is fully executed, ContextWeave should be materially better at retrieving, expanding, tracing, and validating code context across the failure modes identified in the reviews. The system must not merely ship code changes; it must detect, revisit, and fix the reviewed flaws until the earlier issues are either demonstrably solved or explicitly rescheduled into the next sprint with blocking visibility.

## Non-Negotiable Reality
- ContextWeave has shipped meaningful fixes already, but broad retrieval, noise control, field recall, and flow tracing are still not field-closed.
- "Implemented in code" is not equivalent to "fixed in the field."
- This plan therefore tracks three states:
  - `done`: implemented and supported by linked automated evidence.
  - `review`: implemented locally, but not yet field-closed against the review corpus.
  - `todo`: not implemented or not sufficiently corrected.

## Remediation Principles
- Fix precision, noise, and budget utilization before adding new retrieval tricks.
- Treat field-review failures as product bugs, not benchmark noise.
- Close tickets only with both targeted tests and phase-level verification.
- Re-run the review matrix after each phase and start a new sprint if any material gap remains.
- Do not stop because the original tickets are exhausted; stop only when the review corpus no longer shows unresolved failures.

## Definition Of Done

### Ticket Done
- Code lands.
- Linked tests pass.
- `audits/SPRINT_PROGRESS.md` includes explicit evidence.

### Phase Done
- All tickets in the phase are `done` or explicitly downgraded with written rationale.
- Targeted field-regression fixtures pass.
- No new regressions appear in threshold/eval gates.

### Plan Done
- No `P0` or `P1` ticket remains in `todo`, `in_progress`, `review`, or `blocked`.
- Review closure sweep reports every source finding as `closed` or intentionally deprecated.
- Full verification passes:
  - `npm run lint`
  - `npm test`
  - `npx vitest run tests/field/review-regressions.test.ts`
  - `npx vitest run tests/integration/threshold-ratchet.test.ts`
  - targeted external review reruns for the projects mapped to the original findings
- `audits/SPRINT_PROGRESS.md` reports no unresolved blockers.

## Review Finding Matrix

| Review theme | Severity | Current state | Primary tickets |
|---|---|---|---|
| Confidence overstates incomplete answers | P0 | closed | `CW-P0-004`, `CW-P1-010`, `CW-P0-012` |
| Broad queries miss critical files | P0 | closed | `CW-P0-002`, `CW-P1-007`, `CW-P0-012` |
| Noise dominates capsules | P0 | closed | `CW-P0-003`, `CW-P0-007`, `CW-P0-012` |
| Budget underutilization | P0 | partial | `CW-P0-002`, `CW-P1-010`, `CW-P0-012` |
| Flow tracing weak across real boundaries | P0 | closed | `CW-P0-011`, `CW-P0-012` |
| Exact symbol query failure modes | P0 | closed | `CW-P0-001`, `CW-P0-002`, `CW-P0-012` |
| Index pollution from QA/worktree/archive dirs | P0 | closed | `CW-P0-007`, `CW-P0-012` |
| Cross-session feedback contamination | P0 | closed | `CW-P0-005` |
| `cw_stats` honesty | P1 | closed | `CW-P0-004`, `CW-P1-010` |
| Follow-up suggestions low quality | P1 | closed | `CW-P1-008`, `CW-P0-012` |
| `cw_overview` lexical/shallow | P1 | closed | `CW-P1-007`, `CW-P0-012` |
| Intent classification brittle | P1 | closed | `CW-P1-007`, `CW-P1-008` |
| TSX false syntax errors | P1 | closed | `CW-P0-008`, `CW-P0-012` |
| `cw_recall` weak | P1 | closed | `CW-P1-009`, `CW-P0-012` |
| Search ergonomics inconsistencies | P1 | closed | `CW-P0-009` |
| MCP response shape omits structured data | P1 | closed | `CW-P1-006` |
| Duplicate snippets / `[previously shown]` waste | P2 | closed | `CW-P2-001` |
| Path/read UX inconsistencies | P2 | closed | `CW-P2-003` |
| Pattern detector not materially helping capsules | P2 | closed | `CW-P2-004` |

## Phase Plan

### Phase 0: Reconcile Claims With Reality
- Purpose: eliminate stale tracking, confirm what is already fixed, and prevent duplicate work.
- Output:
  - tracker aligned to live code evidence
  - every review theme marked `open`, `partial`, or `closed`
  - rerun list for field validation prepared

### Phase 1: Retrieval Precision, Budget, And Noise
- Purpose: fix the remaining core capsule failures before widening retrieval.
- Focus:
  - exact-match dominance
  - narrow fast path without fallback explosion
  - broad candidate-pool widening
  - same-file backfill noise suppression

### Phase 2: Corpus Hygiene And Navigation Reliability
- Purpose: make the index trustworthy and navigation deterministic across mixed repos.
- Focus:
  - directory weighting closure
  - auto-exclusion closure
  - TSX benign parse tolerance closure
  - path-qualified search/read behavior
  - legacy DB self-healing

### Phase 3: Real Flow Tracing And Architectural Recall
- Purpose: fix the two most painful field gaps: cross-boundary flow tracing and broad architecture recall.
- Focus:
  - JSX callback edges
  - HTTP/route/server-action/event synthesis
  - body-aware overview ranking
  - better broad-query decomposition and recall

### Phase 4: Follow-Up, Recall, And Operator Usefulness
- Purpose: improve the second-step experience after the first capsule.
- Focus:
  - file-qualified follow-up reads
  - useful recall ordering
  - promotion/demotion rules
  - higher-signal suggestions

### Phase 5: Hard Verification And Honest Product Gates
- Purpose: prevent "looks fixed" regressions.
- Focus:
  - harder eval thresholds
  - real-world rerun automation
  - closure matrix generation
  - stop/go gates tied to review outcomes

### Phase 6: Papercuts, Productization, And Adoption Safety
- Purpose: clean up the remaining low-severity friction once core quality is closed.

### Phase 7: Closure Loop
- Purpose: re-run the whole plan until nothing material remains open.
- This phase is mandatory and recursive.

## Ticket Catalog

### P0 Blocking Remediation

#### CW-P0-001
- owner: codex
- scope/files: `src/capsule/pivot-scorer.ts`, `src/capsule/generator.ts`, `tests/capsule/pivot-scorer.test.ts`, `tests/capsule/symbol-not-found.test.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - exact symbol-name matches dominate hybrid and lexical ranking paths
  - exact-match narrow queries return the definition first and only add direct callers/callees unless the user asks broader intent
  - camelCase-equivalent and path-segment secondaries never outrank the exact definition
- linked tests:
  - `npx vitest run tests/capsule/pivot-scorer.test.ts tests/capsule/symbol-not-found.test.ts tests/integration/capsule.test.ts`
- status: done

#### CW-P0-002
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/capsule/packer.ts`, `src/core/hybrid-ranker.ts`, `tests/capsule/story-packing.test.ts`, `tests/capsule/two-phase-retrieval.test.ts`, `tests/integration/threshold-ratchet.test.ts`
- acceptance criteria:
  - broad and task queries expand candidate pools enough to use at least 60% of budget on realistic retrieval fixtures
  - refill logic targets 85% budget usage when enough relevant candidates exist
  - underfilled capsules fail verification unless explicitly time-limited
- linked tests:
  - `npx vitest run tests/capsule/story-packing.test.ts tests/capsule/two-phase-retrieval.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

#### CW-P0-003
- owner: codex
- scope/files: `src/capsule/generator.ts`, `src/capsule/formatter.ts`, `tests/capsule/noise-elimination.test.ts`, `tests/field/review-regressions.test.ts`, `tests/integration/capsule.test.ts`
- acceptance criteria:
  - same-file backfill requires query relevance or graph relevance, not mere centrality
  - unrelated high-centrality neighbors stop consuming the majority of broad-capsule budget
  - review-regression fixtures remain free of the previously observed UI/noise intrusions
- linked tests:
  - `npx vitest run tests/capsule/noise-elimination.test.ts tests/field/review-regressions.test.ts tests/integration/capsule.test.ts`
- status: done

#### CW-P0-004
- owner: codex
- scope/files: `src/capsule/confidence.ts`, `src/capsule/formatter.ts`, `src/capsule/generator.ts`, `tests/capsule/confidence-5level.test.ts`, `tests/unit/confidence-calibration.test.ts`, `tests/integration/threshold-ratchet.test.ts`
- acceptance criteria:
  - coverage confidence is capped by utilization, pivot coverage, and retrieval surface
  - text and structured outputs expose the same LOW/MEDIUM/HIGH semantics
  - false HIGH confidence on thin retrieval is prevented by automated gates
- linked tests:
  - `npx vitest run tests/capsule/confidence-5level.test.ts tests/unit/confidence-calibration.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

#### CW-P0-005
- owner: codex
- scope/files: `src/db/queries/capsule-log.ts`, `src/hooks/post-tool-use.ts`, `tests/integration/post-tool-use.test.ts`
- acceptance criteria:
  - feedback updates the active session row when `session_id` is present
  - fallback lookup is project-root scoped rather than global
- linked tests:
  - `npx vitest run tests/integration/post-tool-use.test.ts`
- status: done

#### CW-P0-006
- owner: codex
- scope/files: `src/memory/bootstrap.ts`, `src/capsule/formatter.ts`, `tests/memory/bootstrap-seeds.test.ts`, `tests/unit/formatter-followup.test.ts`
- acceptance criteria:
  - documentation/convention bootstrap notes do not crowd narrow code capsules
  - documentation notes remain bounded and explicit when they do appear
- linked tests:
  - `npx vitest run tests/memory/bootstrap-seeds.test.ts tests/unit/formatter-followup.test.ts`
- status: done

#### CW-P0-007
- owner: codex
- scope/files: `src/utils/directory-weights.ts`, `src/utils/config.ts`, `src/core/indexer.ts`, `src/core/file-summaries.ts`, `tests/unit/directory-costs.test.ts`, `tests/core/index-pollution.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - QA/worktree/archive/static paths are downweighted or excluded consistently
  - `.contextweave/config.json` `primaryDirs` and `archiveDirs` are honored end-to-end
  - mixed-repo field fixtures no longer surface polluted directories in first-pass retrieval
- linked tests:
  - `npx vitest run tests/unit/directory-costs.test.ts tests/core/index-pollution.test.ts tests/field/review-regressions.test.ts`
- status: done

#### CW-P0-008
- owner: codex
- scope/files: `src/core/parser.ts`, `tests/unit/parser.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - benign JSX text parse issues are warnings, not hard index failures
  - symbol extraction survives valid TSX edge cases
  - the fix is confirmed on field fixtures that previously failed due to TSX syntax noise
- linked tests:
  - `npx vitest run tests/unit/parser.test.ts tests/field/review-regressions.test.ts`
- status: done

#### CW-P0-009
- owner: codex
- scope/files: `src/mcp/tools/search.ts`, `src/mcp/tools/path-filters.ts`, `tests/integration/mcp-navigation-tools.test.ts`
- acceptance criteria:
  - `/pattern/flags` behaves consistently across backends
  - brace globs expand deterministically
  - navigation tool false negatives are removed
- linked tests:
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: done

#### CW-P0-010
- owner: codex
- scope/files: `src/mcp/server.ts`, `src/core/file-summaries.ts`, `src/core/clusters.ts`, `tests/integration/mcp-server.test.ts`, `tests/core/backfill-derived-data.test.ts`
- acceptance criteria:
  - legacy indexes self-heal without requiring a full manual reindex
  - derived data is present after migrations and startup
- linked tests:
  - `npx vitest run tests/integration/mcp-server.test.ts tests/core/backfill-derived-data.test.ts`
- status: done

#### CW-P0-011
- owner: codex
- scope/files: `src/core/parser.ts`, `src/core/event-edge-synthesis.ts`, `src/core/weighted-bfs.ts`, `src/mcp/tools/flow.ts`, `tests/unit/flow.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - JSX prop callbacks create flow edges
  - HTTP/route-handler/server-action/event boundaries are traversable in `cw_flow`
  - path diversity prevents one branch from monopolizing the returned paths
- linked tests:
  - `npx vitest run tests/unit/flow.test.ts tests/field/review-regressions.test.ts`
- status: done

#### CW-P0-012
- owner: codex
- scope/files: `tests/field/review-regressions.test.ts`, `tests/integration/threshold-ratchet.test.ts`, `bench/`, `audits/SPRINT_PROGRESS.md`, `audits/IMPLEMENTATION_PLAN_END_TO_END.md`
- acceptance criteria:
  - after each phase, all directly related review themes are rescored as `open`, `partial`, or `closed`
  - any non-closed P0 finding automatically generates the next sprint entry before the phase can be considered complete
  - no phase is allowed to declare success without rerun evidence
- linked tests:
  - `npx vitest run tests/field/review-regressions.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

### P1 Stabilization And Field-Closure Work

#### CW-P1-001
- owner: codex
- scope/files: `package.json`, `src/core/chunker.ts`, `src/core/types.ts`, `tests/core/chunker.test.ts`
- acceptance criteria:
  - AST-aware chunk generation exists for supported languages
  - unsupported languages have bounded fallback chunking
- linked tests:
  - `npx vitest run tests/core/chunker.test.ts`
- status: done

#### CW-P1-002
- owner: codex
- scope/files: `src/db/schema.ts`, `src/db/migrations.ts`, `src/core/indexer.ts`, `src/core/chunker.ts`, `tests/core/indexer-chunks.test.ts`, `tests/db/migration-upgrade-path.test.ts`
- acceptance criteria:
  - chunks persist in SQLite and refresh on reindex
- linked tests:
  - `npx vitest run tests/core/indexer-chunks.test.ts tests/db/migration-upgrade-path.test.ts`
- status: done

#### CW-P1-003
- owner: codex
- scope/files: `package.json`, `src/core/embedder.ts`, `src/core/types.ts`, `tests/core/embedder.test.ts`
- acceptance criteria:
  - local embeddings run without API keys and stay dimensionally stable
- linked tests:
  - `npx vitest run tests/core/embedder.test.ts`
- status: done

#### CW-P1-004
- owner: codex
- scope/files: `package.json`, `src/core/vector-store.ts`, `src/db/schema.ts`, `src/db/migrations.ts`, `tests/core/vector-store.test.ts`, `tests/db/migration-upgrade-path.test.ts`
- acceptance criteria:
  - vector storage and nearest-neighbor search remain local and upgrade-safe
- linked tests:
  - `npx vitest run tests/core/vector-store.test.ts tests/db/migration-upgrade-path.test.ts`
- status: done

#### CW-P1-005
- owner: codex
- scope/files: `src/core/indexer.ts`, `src/core/watcher.ts`, `src/core/embedder.ts`, `src/core/vector-store.ts`, `tests/core/indexer-embedding.test.ts`, `tests/core/watcher-behavior.test.ts`
- acceptance criteria:
  - chunk embeddings are produced and refreshed incrementally
  - embedding model can be configured per project
- linked tests:
  - `npx vitest run tests/core/indexer-embedding.test.ts tests/core/watcher-behavior.test.ts`
- status: done

#### CW-P1-006
- owner: codex
- scope/files: `src/core/hybrid-ranker.ts`, `src/capsule/generator.ts`, `src/mcp/tools/capsule.ts`, `src/mcp/tools/overview.ts`, `tests/capsule/hybrid-ranker.test.ts`, `tests/integration/capsule-hybrid-runtime.test.ts`, `tests/integration/threshold-ratchet.test.ts`
- acceptance criteria:
  - exact + BM25 + vector retrieval are fused
  - retrieval ratchet remains green after hybridization
- linked tests:
  - `npx vitest run tests/capsule/hybrid-ranker.test.ts tests/integration/capsule-hybrid-runtime.test.ts tests/integration/threshold-ratchet.test.ts`
- status: done

#### CW-P1-007
- owner: codex
- scope/files: `src/core/file-summaries.ts`, `src/mcp/tools/overview.ts`, `src/capsule/intent-classifier.ts`, `tests/core/file-summaries.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - `cw_overview` surfaces semantic matches for architecture and flow questions
  - body-aware features are not merely indexed; they materially affect ranking
  - broad architectural review fixtures find the expected runtime files before UI/docs noise
- linked tests:
  - `npx vitest run tests/core/file-summaries.test.ts tests/field/review-regressions.test.ts`
- status: done

#### CW-P1-008
- owner: codex
- scope/files: `src/capsule/formatter.ts`, `src/capsule/generator.ts`, `src/mcp/tools/read.ts`, `tests/unit/formatter-followup.test.ts`, `tests/field/review-regressions.test.ts`
- acceptance criteria:
  - follow-up suggestions are ranked by unresolved query intent, not just centrality
  - suggested reads are file-qualified by default
  - large-repo ambiguity complaints disappear from regression fixtures
- linked tests:
  - `npx vitest run tests/unit/formatter-followup.test.ts tests/field/review-regressions.test.ts`
- status: done

#### CW-P1-009
- owner: codex
- scope/files: `src/memory/search.ts`, `src/memory/passive.ts`, `src/memory/observations.ts`, `tests/memory/recall-quality.test.ts`, `tests/memory/observation-promotion.test.ts`
- acceptance criteria:
  - `cw_recall` favors durable, useful observations over passive query telemetry
  - promotion and demotion rules increase actual recall usefulness on realistic queries
  - low-value empty/doc-only recall results are reduced
- linked tests:
  - `npx vitest run tests/memory/recall-quality.test.ts tests/memory/observation-promotion.test.ts`
- status: done

#### CW-P1-010
- owner: codex
- scope/files: `tests/eval/`, `tests/integration/threshold-ratchet.test.ts`, `bench/`, `audits/SPRINT_PROGRESS.md`
- acceptance criteria:
  - eval thresholds reflect field-quality expectations rather than permissive local minima
  - rerun automation reports budget utilization, recall, confidence, and correction rates honestly
  - closure gates fail when broad recall/noise regress materially
- linked tests:
  - `npx vitest run tests/integration/threshold-ratchet.test.ts`
  - `npm test`
- status: done

### P2 Future-Proofing And Productization

#### CW-P2-001
- owner: codex
- scope/files: `src/capsule/formatter.ts`, `src/capsule/generator.ts`, `tests/capsule/*.test.ts`
- acceptance criteria:
  - duplicate content and low-value `[previously shown]` markers are reduced without harming deduplication
- linked tests:
  - `npx vitest run tests/capsule/*.test.ts`
- status: done

#### CW-P2-002
- owner: codex
- scope/files: `src/mcp/tools/capsule.ts`, `src/core/types.ts`, `tests/integration/capsule-hybrid-runtime.test.ts`
- acceptance criteria:
  - prose and structured capsule outputs share one coherent contract
  - downstream consumers do not need HTML-comment parsing hacks to access structure
- linked tests:
  - `npx vitest run tests/integration/capsule-hybrid-runtime.test.ts`
- status: done

#### CW-P2-003
- owner: codex
- scope/files: `src/mcp/tools/read.ts`, `src/mcp/tools/overview.ts`, `src/mcp/tools/search.ts`, `tests/integration/mcp-navigation-tools.test.ts`
- acceptance criteria:
  - path-qualified reads, overview suggestions, and search suggestions use one consistent UX
  - path ambiguity complaints from the reviews are eliminated
- linked tests:
  - `npx vitest run tests/integration/mcp-navigation-tools.test.ts`
- status: done

#### CW-P2-004
- owner: codex
- scope/files: `src/core/pattern-detector.ts`, `src/capsule/formatter.ts`, `tests/core/pattern-detector.test.ts`, `tests/capsule/pattern-output.test.ts`
- acceptance criteria:
  - detected patterns are high-signal and show up only when helpful
  - pattern output improves broad understanding rather than adding noise
- linked tests:
  - `npx vitest run tests/core/pattern-detector.test.ts tests/capsule/pattern-output.test.ts`
- status: done

#### CW-P2-005
- owner: codex
- scope/files: `src/db/`, `src/mcp/tools/`, `tests/db/`, `tests/integration/`
- acceptance criteria:
  - project-relative portability and DB-path assumptions are explicitly tested
- linked tests:
  - `npm test`
- status: done

#### CW-P2-006
- owner: codex
- scope/files: `README.md`, `audits/PRODUCT_GRADE_RELEASE_CHECKLIST.md`, `docs/plans/`, `audits/SPRINT_PROGRESS.md`
- acceptance criteria:
  - operator guidance matches the actual closure gates
  - release docs stop overstating readiness before the field loop is complete
- linked tests:
  - documentation review plus full verification bundle
- status: done

## Execution Order
1. `CW-P0-012` starts first and remains open for the life of the plan.
2. Finish all Phase 1 retrieval tickets: `CW-P0-001`, `CW-P0-002`, `CW-P0-003`.
3. Close the Phase 2 trust tickets: `CW-P0-007`, `CW-P0-008`, `CW-P0-011`.
4. Finish the Phase 3 usefulness tickets: `CW-P1-007`, `CW-P1-008`, `CW-P1-009`.
5. Harden gates with `CW-P1-010`.
6. Clean up P2 only after P0 and P1 are field-closed.

## Verification Bundle

### Minimum Per-Ticket Verification
- run the linked tests for the ticket
- update `audits/SPRINT_PROGRESS.md`

### Minimum Per-Phase Verification
- `npm run lint`
- `npm test`
- `npx vitest run tests/field/review-regressions.test.ts`
- `npx vitest run tests/integration/threshold-ratchet.test.ts`

### Field Closure Verification
- rerun targeted review scenarios for the original failing project types:
  - broad architecture query
  - end-to-end flow query
  - narrow exact-symbol query
  - recall/follow-up query where relevant
- update the Review Finding Matrix from `open/partial/closed`

## Mandatory Resprint Loop

After the last planned phase completes, the implementation must not simply stop. It must execute the following loop:

1. Run the full verification bundle.
2. Reopen this implementation plan and compare every review theme in the Review Finding Matrix against current evidence.
3. For every theme still `open` or `partial`:
   - create the next sprint tickets in the correct severity tier
   - update `audits/SPRINT_PROGRESS.md`
   - return to the earliest phase touched by the failure
4. Execute the new sprint.
5. Repeat this loop until all `P0` and `P1` review themes are `closed` and all remaining `P2` items are either `done` or explicitly accepted as non-blocking.

## Stop Condition
Do not stop because there are no original tickets left. Stop only when:
- every blocking and important review theme is closed
- the verification bundle is green
- the sprint tracker shows no unresolved blocker
- there is nothing substantive left to remediate from the review corpus
