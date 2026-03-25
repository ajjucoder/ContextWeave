# User Testing Guide

**What belongs here:** Validation surfaces, testing tools, resource constraints, and manual verification procedures for ContextWeave v2.
**What does NOT belong here:** Automated test procedures (those are in test files).

---

## Validation Surfaces

This ContextWeave v2 mission has three validation surfaces:

### 1. Automated Tests (vitest)
- **Surface:** Backend code with SQLite in-memory tests
- **Tools:** vitest test runner, TypeScript compiler
- **Setup:** `npm install` provides all dependencies
- **Cost:** Low (no browser, no external services)

### 2. MCP Tool Interface (CLI)
- **Surface:** MCP server tool responses via CLI
- **Tools:** `node dist/index.js` commands
- **Setup:** `npm run build` produces dist/index.js
- **Cost:** Low (server starts on-demand)

### 3. Eval Suite (capsule quality)
- **Surface:** Capsule quality via eval-runner.ts
- **Tools:** `npm run eval`
- **Setup:** Tests against fixture projects
- **Cost:** Medium (~5 min runtime)

## Resource Cost Classification

**Test execution:**
- Single vitest process
- SQLite in-memory (no external DB)
- Estimated: ~200MB RAM, 1-2 CPU cores
- Full test suite runtime: ~60 seconds

**Build:**
- tsup TypeScript bundler
- Estimated: ~38ms
- dist/ artifacts: 715KB index.js, 111KB parser-worker.js, 14KB pagerank-worker.js

**Max concurrent validators:** 5 (lightweight backend-only)

## Validation Concurrency

### Surface ceilings
- **Automated Tests (vitest / targeted `npm test -- ...`)**: max **2** concurrent validators. These commands are CPU-heavy, share the same repository checkout, and can contend on transient build/test artifacts.
- **CLI validation (`npx tsc --noEmit`, `npm run build`, direct `node dist/index.js` checks)**: max **1** concurrent validator per checkout. These commands mutate shared `dist/` output and should stay serialized inside one repo worktree.
- **Eval suite (`npm run eval`)**: max **1** concurrent validator. It is the slowest surface and should not overlap with other heavy validation.

### Current machine note
- Mission guidance allows up to 5 lightweight validators, but current workstation load includes multiple active `droid` processes and moderate memory pressure on a 16 GB machine.
- For this mission, use **1 concurrent validator** for the pre-existing milestone so targeted tests, typecheck, and build run in a single isolated sequence.

## Flow Validator Guidance: CLI Validation

- **Surface**: repository-local command-line validation for milestone assertions that are proven by `npm`, `npx`, and built artifact checks.
- **Isolation boundary**: use only the assigned repository checkout at `/Users/aejjusingh/Developer/ContextWeave`; do not create extra servers, ports, or alternate worktrees unless explicitly assigned.
- **Allowed commands**: targeted `npm test -- <file>`, `npx tsc --noEmit`, `npm run build`, and read-only artifact checks such as `test -f` / `ls` within `dist/`.
- **Shared-state caution**: run the assigned commands serially. `npm run build` rewrites `dist/`, so do not overlap it with other validators in the same checkout.
- **Evidence**: capture exact commands, exit codes, and concise observations in the flow report. Save any extra command output snippets only under the assigned evidence directory.
- **Off-limits**: no source edits, no secret/config changes, no network-dependent mocks, and no use of reserved ports `3000-3100`.

## Milestone Notes

### pre-existing
- `validation-contract.md` still references older vitest file paths for two assertions. Use the current repo paths when validating:
  - `VAL-PRE-002` → `tests/security/capsule-path-validation.test.ts`
  - `VAL-PRE-004` → `tests/unit/impact.test.ts`

### 1-foundation
- In this environment, `Task` launches for `user-testing-flow-validator` can fail immediately with `Invalid model: custom:GPT-5.4-High-[VibeProxy]-26`. If that happens, run the CLI validation steps in the parent validator session, then write the expected flow report JSON files manually under `.factory/validation/1-foundation/user-testing/flows/`.

### 2-graph-search-ux
- `Task` launches for `user-testing-flow-validator` still fail in this environment with `Invalid model: custom:GPT-5.4-High-[VibeProxy]-26`. For this milestone, run the assigned CLI validation commands in the parent validator session, save command logs under the mission evidence directory, and write the expected flow report JSON manually under `.factory/validation/2-graph-search-ux/user-testing/flows/`.
