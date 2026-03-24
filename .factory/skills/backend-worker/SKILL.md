---
name: backend-worker
description: Backend implementation worker for ContextWeave v2 features
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

All features in this mission are backend work: TypeScript/SQL/code implementation, pipeline decomposition, graph algorithms, MCP tool creation, migrations, and test writing. This is the only worker type needed.

## Required Skills

None - this is a pure backend mission. No browser/UI validation needed.

## Work Procedure

### Step 1: Baseline Environment Check
1. Run `cd /Users/aejjusingh/Developer/ContextWeave && npx tsc --noEmit` to confirm starting state
2. Run `cd /Users/aejjusingh/Developer/ContextWeave && npm test 2>&1 | tail -10` to get current test count
3. Run `cd /Users/aejjusingh/Developer/ContextWeave && npm run build 2>&1 | tail -5` to verify build

### Step 2: Implement the Feature
1. Read the relevant existing code to understand patterns
2. Implement the feature following existing code style
3. Write tests FIRST (TDD - red before green):
   - Create test file in appropriate `tests/` subdirectory
   - Write failing test cases
   - Run `npm test -- <test-file>` to confirm tests fail (red)
   - Implement the feature
   - Run tests again to confirm pass (green)
4. Run `npx tsc --noEmit` to verify no type errors
5. Run `npm run build` to verify compilation

### Step 3: Verify Against Validation Contract
For each feature, verify the specific assertions it fulfills:
- Read the assertion in `validation-contract.md`
- Confirm the implementation satisfies the behavioral description
- Note evidence in the handoff

### Step 4: Commit
1. `git add <changed-files>`
2. `git commit -m "type(scope): description"` (e.g., "feat(pipeline): decompose generator.ts into staged pipeline")
3. Do NOT include any secrets, API keys, or sensitive data

## Example Handoff

```json
{
  "salientSummary": "Decomposed generator.ts into 5 pipeline stages (types, pivot-resolver, graph-expander, candidate-scorer, budget-filler). Generator.ts now thin orchestrator under 100 lines. All 5 stage files created with CapsuleContext passed between stages.",
  "whatWasImplemented": "src/capsule/pipeline/ directory created with 5 files. generateCapsule now calls pipeline stages sequentially. Nested closures extracted as named exports.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npx tsc --noEmit", "exitCode": 0, "observation": "No TypeScript errors" },
      { "command": "npm run build", "exitCode": 0, "observation": "Build succeeded, dist/ artifacts produced" },
      { "command": "npm test -- tests/capsule/pipeline/ 2>&1 | tail -20", "exitCode": 0, "observation": "All pipeline stage tests pass" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "tests/capsule/pipeline/pivot-resolver.test.ts",
        "cases": [
          { "name": "resolves FTS pivots correctly", "verifies": "VAL-PIPE-003" },
          { "name": "resolves path pivots correctly", "verifies": "VAL-PIPE-003" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a previous feature that doesn't exist yet
- Requirements are ambiguous or contradictory
- Pre-existing bugs prevent implementation
- Found a better approach that changes the plan
- Resource constraints (memory, time) prevent completion
