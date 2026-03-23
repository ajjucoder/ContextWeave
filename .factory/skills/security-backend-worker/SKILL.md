---
name: security-backend-worker
description: Implements security fixes for backend code including SQL injection prevention, input validation, type safety hardening, and sanitization fixes.
---

# Security Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE for security fixes.

## When to Use This Skill

Use this skill for:
- SQL injection prevention (parameterized queries)
- Input validation and sanitization (Zod schemas, escaping)
- Type safety improvements (replacing `any` with proper types)
- Config validation and bounds checking
- Path traversal prevention
- FTS5/LIKE query sanitization

## Required Skills

None - this skill uses standard file editing and shell execution.

## Work Procedure

### Phase 1: Understand the Vulnerability (15 min)

1. Read the target file(s) to understand current vulnerable code
2. Read related test files to understand existing test patterns
3. Identify the exact vulnerability pattern and how it's exploitable
4. Document the attack vector in your notes

### Phase 2: Write Security Tests First (TDD) (30 min)

1. Create or update test file for the vulnerability
2. Write test that DEMONSTRATES the vulnerability exists
   - For SQL injection: test with malicious input that would execute if interpolated
   - For input validation: test with invalid inputs that should be rejected
   - For type safety: test that `any` is no longer present
3. Run test to confirm it FAILS (proves vulnerability exists)
4. Add edge case tests:
   - Empty/null inputs
   - Boundary values (max length, min/max numeric)
   - Special characters that need escaping
   - Valid inputs that must continue to work

### Phase 3: Implement the Fix (45 min)

1. Implement the security fix following patterns in AGENTS.md:
   - SQL injection: Use parameterized queries with `?` placeholders
   - Input validation: Add Zod schemas with `.max()`, refinements
   - FTS5: Escape double quotes as `""`
   - LIKE: Escape `%` and `_` with backslash, add ESCAPE clause
   - Type safety: Replace `any` with proper MCP types
2. Keep changes minimal - only what's needed for security
3. Preserve all existing functionality for valid inputs

### Phase 4: Verify the Fix (20 min)

1. Run security tests - must now PASS
2. Run full test suite: `npm test` - must pass with no regressions
3. Run typecheck: `npm run typecheck` - must pass
4. Run lint: `npm run lint` - must pass (or match existing state)
5. Manual verification:
   - Review the fixed code confirms vulnerability is patched
   - Check that valid use cases still work
   - Verify error messages are helpful

### Phase 5: Cross-Cutting Concerns (15 min)

1. If fixing FTS5 sanitization, check if other modules need same fix
2. If creating a sanitization utility, ensure it's exported for reuse
3. If fixing config validation, ensure bounds match MCP schema constraints

### Phase 6: Document in Handoff

Complete the handoff with:
- Summary of vulnerability and fix
- Evidence that tests demonstrate the fix works
- Any patterns established for other security fixes to follow
- Notes on edge cases discovered

## Example Handoff

```json
{
  "salientSummary": "Fixed SQL injection in clusters.ts by replacing template literal SQL construction with parameterized queries using ? placeholders. Added tests proving injection attempts with malicious kind values are safely handled. All existing cluster tests pass.",
  "whatWasImplemented": "Replaced string interpolation in SQL queries with parameterized statements. Modified lines 66-75 in clusters.ts to use db.prepare() with ? placeholders for kindList and threshold parameters. Created escape utility for LIKE patterns in content-fallback.ts that escapes % and _ with backslash. Added Zod refinements to reject path traversal attempts.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm run typecheck",
        "exitCode": 0,
        "observation": "No TypeScript errors, strict mode passes"
      },
      {
        "command": "npm test -- --grep 'clusters'",
        "exitCode": 0,
        "observation": "8 tests passed including new injection test"
      },
      {
        "command": "npm test",
        "exitCode": 0,
        "observation": "Full suite: 156 tests passed, 0 failed"
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "tests/core/clusters.security.test.ts",
        "cases": [
          {
            "name": "rejects SQL injection in kind parameter",
            "verifies": "VAL-SEC-001: Malicious kind values are safely parameterized"
          },
          {
            "name": "handles empty kind array",
            "verifies": "Edge case: empty input doesn't break query"
          },
          {
            "name": "preserves valid functionality",
            "verifies": "No regression: valid kinds work correctly"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

Return to orchestrator if:
- The vulnerability requires changes to multiple unrelated areas
- Existing tests are failing due to pre-existing issues unrelated to your fix
- The fix requires database schema changes
- You're unsure about the security implications of a potential fix approach
- You discover additional vulnerabilities while fixing the current one
