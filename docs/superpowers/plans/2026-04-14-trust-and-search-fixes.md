# Trust And Search Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three user-facing reliability gaps in memory recall, grep search, and structured capsule confidence without broad refactors.

**Architecture:** Keep the changes local to the tool boundary and formatter boundary. Add regression tests first, make the smallest production edits needed, then validate focused behavior before broader verification.

**Tech Stack:** TypeScript, Vitest, MCP tool handlers, SQLite-backed search helpers

---

### Task 1: Lock Down Recall Filtering

**Files:**
- Modify: `tests/integration/recall-tool-grouping.test.ts`
- Modify: `src/mcp/tools/recall.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("does not surface passive observations when include_stale is enabled", async () => {
  const result = await handler!({ query: "auth", include_stale: true, limit: 10 });
  const text = result.content[0]?.text ?? "";

  expect(text).toContain("Intentional observations:");
  expect(text).not.toContain("Passive observations:");
  expect(text).not.toContain("Passive auth query telemetry");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/recall-tool-grouping.test.ts`
Expected: FAIL because passive observations are currently shown when `include_stale` is true.

- [ ] **Step 3: Write minimal implementation**

```ts
const showPassive = scope === "passive";
const results = search.search(query, {
  scope,
  includeStale: include_stale,
  includePassive: showPassive,
  limit: showPassive ? requestedLimit : Math.max(requestedLimit * 3, requestedLimit),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/recall-tool-grouping.test.ts`
Expected: PASS

### Task 2: Fix Ripgrep Result Loss

**Files:**
- Modify: `tests/mcp/ripgrep-search.test.ts`
- Modify: `src/mcp/tools/ripgrep.ts`
- Modify: `src/mcp/tools/search.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("returns multiple matches from the same file", async () => {
  const results = await runRipgrepSearch("target", dir, { caseSensitive: true });
  expect(results).toHaveLength(2);
  expect(results.map((r) => r.line)).toEqual([1, 3]);
});
```

```ts
it("falls back cleanly when ripgrep throws", async () => {
  expect(text).toContain("Search results");
  expect(result.isError).not.toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/mcp/ripgrep-search.test.ts tests/integration/mcp-navigation-tools.test.ts`
Expected: FAIL because ripgrep currently limits each file to one match and hides non-match errors.

- [ ] **Step 3: Write minimal implementation**

```ts
const args: string[] = ["--json"];
```

```ts
catch (err) {
  if (isNoMatchExit(err)) return [];
  throw err;
}
```

```ts
try {
  const rgMatches = await runRipgrepSearch(...);
  ...
} catch {
  // Fall back to in-process scanning
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/mcp/ripgrep-search.test.ts tests/integration/mcp-navigation-tools.test.ts`
Expected: PASS

### Task 3: Align Structured Confidence

**Files:**
- Modify: `tests/capsule/followup-suggestions.test.ts`
- Modify: `src/capsule/formatter.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("uses coverage confidence for structured confidence tier", () => {
  const metadata = {
    ...makeMetadata("validate email"),
    quality: { ...makeMetadata("validate email").quality, coverageConfidence: 0.45 },
    diagnostics: {
      ...makeMetadata("validate email").diagnostics!,
      pivotStats: { ...makeMetadata("validate email").diagnostics!.pivotStats, topPivotScores: [10] },
    },
  };

  const result = buildStructuredOutput([makeNode("validateEmail", 0, 1.0)], [], metadata, "text");
  expect(result.confidence).toBe("low");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/capsule/followup-suggestions.test.ts`
Expected: FAIL because structured confidence currently uses pivot score instead of coverage confidence.

- [ ] **Step 3: Write minimal implementation**

```ts
const coverageConfidence = metadata.quality.coverageConfidence;
if (coverageConfidence >= 0.8) return { confidence: "high", recommendedSupplementaryReads: 2 };
if (coverageConfidence >= 0.55) return { confidence: "medium", recommendedSupplementaryReads: 5 };
return { confidence: "low", recommendedSupplementaryReads: 10 };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/capsule/followup-suggestions.test.ts`
Expected: PASS

### Task 4: Validate The Batch

**Files:**
- Modify: none

- [ ] **Step 1: Run focused regression coverage**

Run: `npm test -- tests/integration/recall-tool-grouping.test.ts tests/mcp/ripgrep-search.test.ts tests/integration/mcp-navigation-tools.test.ts tests/capsule/followup-suggestions.test.ts`
Expected: PASS

- [ ] **Step 2: Run broader project validation**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Build to confirm no type/package regressions**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-14-trust-and-search-fixes.md tests/integration/recall-tool-grouping.test.ts tests/mcp/ripgrep-search.test.ts tests/integration/mcp-navigation-tools.test.ts tests/capsule/followup-suggestions.test.ts src/mcp/tools/recall.ts src/mcp/tools/ripgrep.ts src/mcp/tools/search.ts src/capsule/formatter.ts
git commit -m "fix(mcp): tighten trust signals and grep behavior"
```
