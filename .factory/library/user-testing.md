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
