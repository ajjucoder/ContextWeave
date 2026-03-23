# User Testing Guide

**What belongs here:** How to manually test security fixes, required testing tools, and resource constraints.
**What does NOT belong here:** Automated test procedures (those are in test files).

---

## Validation Surfaces

This security fix mission has one validation surface:

### 1. Code Review + Automated Tests
- **Surface:** Backend code with SQLite in-memory tests
- **Tools:** Jest/Vitest test runner, TypeScript compiler
- **Setup:** `npm install` provides all dependencies
- **Cost:** Low (no browser, no external services)

## Resource Cost Classification

**Test execution:**
- Single test process
- SQLite in-memory (no external DB)
- Estimated: ~200MB RAM, 1-2 CPU cores
- Full test suite runtime: < 30 seconds

**Max concurrent validators:** 1 (sequential testing is sufficient)

## Manual Verification Steps

For each security fix, manually verify:

1. **Read the fix** - Code clearly patches the vulnerability
2. **Run specific tests** - `npm test -- --grep 'feature-name'`
3. **Check type safety** - `npm run typecheck` passes
4. **Verify no regressions** - Full test suite passes

## Security Testing Checklist

Per fix:
- [ ] Test demonstrates vulnerability is patched
- [ ] Edge cases covered (empty, null, boundary values)
- [ ] Valid inputs still work correctly
- [ ] Error messages are descriptive
- [ ] No changes to unrelated code
