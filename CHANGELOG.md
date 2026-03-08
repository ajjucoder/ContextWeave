# Changelog

All notable changes to ContextWeave are documented in this file.

## [Unreleased]

### Field Recovery

- Added a field-regression gate at [`tests/field/review-regressions.test.ts`](tests/field/review-regressions.test.ts) covering five fixture clusters (Sitecraft, Claud-ometer, gravity-proxy, EBPS, next-pages-router).
- Field tests now assert end-to-end retrieval behavior for capsule ranking against UI noise, framework boundary tracing for Next.js and Express flows, navigation/impact correctness via file-qualified symbol targeting, and confidence behavior in policy-heavy repositories.

### Tooling Surface

- Runtime MCP surface is now documented as always registered tools (`cw_capsule`, `cw_impact`, `cw_flow`, `cw_recall`, `cw_status`, `cw_overview`, `cw_files`, `cw_grep`, `cw_read`, `cw_stats`) plus primary-only tools (`cw_remember`, `cw_reindex`).
- Secondary lock mode remains read-focused and skips write-heavy tools.

### Document Indexing

- Markdown (`.md`, `.markdown`), YAML (`.yaml`, `.yml`), JSON (`.json`), TOML (`.toml`), and INI (`.ini`) are indexed as document-language entries via synthetic symbols.
- Document indexing behavior is verified in parser unit coverage and exercised in field regression assertions for policy/config retrieval.

### Memory and Recall Defaults

- Passive observations continue to be auto-captured for query and file-change events.
- Capsule injection excludes passive observations by default.
- `cw_recall` now defaults to intentional observations and only includes passive observations when explicitly requested (`scope: "passive"`).
- Passive-memory expiration behavior (7-day window) and scope-weighted retrieval remain enforced in memory search.

### Confidence Model

- Confidence remains intent-aware (`narrow` / `broad` / `task`) with broad/task breadth penalties based on query-term coverage and retrieval-surface coverage.
- Capsule output surfaces calibrated uncertainty levels (`very_low` through `critical`) plus explicit low-confidence reasons in quality notes.

### CI Gates

- CI workflow gates are explicitly ordered as: `npm ci`, `npm run lint`, `npm run test:field` (`CW_P95_TARGET_MS=200`), `npm test` (`CW_P95_TARGET_MS=200`), `npm run build`, then `npm run eval`.
- `test:field` is now part of required CI coverage, not just optional local validation.
- Slower first-pass product checks now run through `.github/workflows/product-bench.yml` on manual dispatch, nightly schedule, and release publication.
