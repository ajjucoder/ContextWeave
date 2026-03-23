# SEC-006 Type Safety Validation Assertions

**Finding ID:** SEC-006 (Finding #5)  
**Target File:** `src/mcp/tools/register-helper.ts`  
**Vulnerability:** `any[]` disables compile-time type checking for all 12 MCP tool registrations  
**Original Code:**
```typescript
export type RegisterToolFn = (...args: any[]) => void;  // Line 3
```

---

## Overview

The `RegisterToolFn` type uses `any[]` for function arguments, completely bypassing TypeScript's type checking for all MCP tool registrations. This allows:
- Type mismatches between Zod schemas and handler parameters to go undetected
- Missing or extra properties in tool arguments to pass compilation
- Runtime errors that could be caught at compile time

**Impact:** 12 MCP tools affected:
1. `cw_capsule` (capsule.ts)
2. `cw_remember` (remember.ts)
3. `cw_read` (read.ts)
4. `cw_grep` (search.ts)
5. `cw_reindex` (reindex.ts)
6. `cw_impact` (impact.ts)
7. `cw_flow` (flow.ts)
8. `cw_status` (status.ts)
9. `cw_recall` (recall.ts)
10. `cw_files` (files.ts)
11. `cw_stats` (stats.ts)
12. `cw_overview` (overview.ts)

---

## VAL-SEC-006a: Type Definition Uses Proper Types Not any[]

### Assertion
The `RegisterToolFn` type must use strict typing instead of `any[]`, ensuring all tool registrations are type-safe at compile time.

### Correct MCP SDK Types
Based on the MCP SDK pattern and Zod integration:

```typescript
import type { z } from "zod/v3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Schema type for tool parameters
export type ToolParameters = Record<string, z.ZodTypeAny>;

// Inferred args type from schema
export type ToolArgs<T extends ToolParameters> = {
  [K in keyof T]: T[K] extends z.ZodTypeAny ? z.infer<T[K]> : never;
};

// Tool handler function type
export type ToolHandler<T extends ToolParameters> = (
  args: ToolArgs<T>
) => Promise<CallToolResult> | CallToolResult;

// Registration function type - strict, no any[]
export type RegisterToolFn = <T extends ToolParameters>(
  name: string,
  description: string,
  parameters: T,
  handler: ToolHandler<T>
) => void;
```

### Validation Criteria
1. **No `any` type usage** in the type definition chain
2. **Schema-to-handler type inference** must work automatically
3. **Parameter name type checking** - handler args must match schema keys
4. **Parameter type checking** - handler arg types must match Zod schema inferred types
5. **Return type enforcement** - handler must return `Promise<CallToolResult>`

### Evidence Required
- [ ] Source code showing `RegisterToolFn` without `any[]`
- [ ] Source code showing generic type parameter `<T extends ToolParameters>`
- [ ] Source code showing schema-to-handler type inference

---

## VAL-SEC-006b: TypeScript Compilation Passes with Strict Mode

### Assertion
After fixing `RegisterToolFn`, TypeScript strict mode compilation must pass without type errors across the entire project.

### Current tsconfig.json Strict Settings
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false
  }
}
```

### Validation Criteria
1. **Zero type errors** when running `tsc --noEmit`
2. **Zero type warnings** in strict mode
3. **No `@ts-ignore` or `@ts-expect-error` comments** added to suppress new errors
4. **No `as any` type assertions** introduced as workaround

### Evidence Required
```bash
# Compile-time validation command
npm run lint  # Runs: tsc --noEmit

# Expected output:
# > contextweave@0.1.0 lint
# > tsc --noEmit
# 
# (exit code 0, no output = success)
```

- [ ] Terminal output showing `tsc --noEmit` with exit code 0
- [ ] No errors in all 12 tool registration files:
  - `src/mcp/tools/capsule.ts`
  - `src/mcp/tools/remember.ts`
  - `src/mcp/tools/read.ts`
  - `src/mcp/tools/search.ts`
  - `src/mcp/tools/reindex.ts`
  - `src/mcp/tools/impact.ts`
  - `src/mcp/tools/flow.ts`
  - `src/mcp/tools/status.ts`
  - `src/mcp/tools/recall.ts`
  - `src/mcp/tools/files.ts`
  - `src/mcp/tools/stats.ts`
  - `src/mcp/tools/overview.ts`

---

## VAL-SEC-006c: All Tool Handlers Conform to New Type Signature

### Assertion
All 12 tool handlers must type-check correctly against the new strict `RegisterToolFn` signature, with schema inference properly mapping to handler parameters.

### Tool-by-Tool Validation

#### 1. cw_capsule (capsule.ts)
**Schema:**
```typescript
const inputSchema = {
  query: z.string().min(1).max(2000),
  token_budget: z.number().min(100).max(100000).optional(),
  mode: z.enum(["debug", "refactor", "feature", "review"]).optional(),
  path: z.string().optional(),
  glob: z.string().optional(),
};
```

**Handler must accept:**
```typescript
async ({
  query,
  token_budget,
  mode,
  path,
  glob
}: {
  query: string;
  token_budget?: number;
  mode?: "debug" | "refactor" | "feature" | "review";
  path?: string;
  glob?: string;
}) => { ... }
```

#### 2. cw_remember (remember.ts)
**Schema:**
```typescript
{
  scope: z.string().max(100),
  note: z.string().max(10000),
  symbol: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
}
```

**Handler must accept:**
```typescript
async ({ scope, note, symbol, confidence }: {
  scope: string;
  note: string;
  symbol?: string;
  confidence?: number;
}) => { ... }
```

#### 3. cw_read (read.ts)
**Schema:**
```typescript
{
  path: z.string().optional(),
  file: z.string().optional(),
  symbol: z.string().optional(),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
  max_lines: z.number().int().min(1).max(500).optional(),
}
```

**Handler must accept:**
```typescript
async ({
  path: pathArg,
  file: fileArg,
  symbol,
  start_line,
  end_line,
  max_lines,
}: {
  path?: string;
  file?: string;
  symbol?: string;
  start_line?: number;
  end_line?: number;
  max_lines?: number;
}) => { ... }
```

#### 4. cw_grep (search.ts)
**Schema:**
```typescript
{
  query: z.string().min(1).max(500),
  path: z.string().optional(),
  glob: z.string().optional(),
  use_regex: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  context_lines: z.number().int().min(0).max(8).optional(),
  max_results: z.number().int().min(1).max(200).optional(),
}
```

**Handler must accept:**
```typescript
async ({
  query,
  path,
  glob,
  use_regex,
  case_sensitive,
  context_lines,
  max_results,
}: {
  query: string;
  path?: string;
  glob?: string;
  use_regex?: boolean;
  case_sensitive?: boolean;
  context_lines?: number;
  max_results?: number;
}) => { ... }
```

#### 5. cw_reindex (reindex.ts)
**Schema:**
```typescript
{ path: z.string().optional() }
```

**Handler must accept:**
```typescript
async ({ path }: { path?: string }) => { ... }
```

#### 6. cw_impact (impact.ts)
**Schema:**
```typescript
{
  target: z.string(),
  depth: z.number().min(1).max(20).optional(),
}
```

**Handler must accept:**
```typescript
async ({ target, depth }: { target: string; depth?: number }) => { ... }
```

#### 7. cw_flow (flow.ts)
**Schema:**
```typescript
{
  source: z.string(),
  target: z.string().optional(),
  max_hops: z.number().min(1).max(20).optional(),
  direction: z.enum(["outgoing", "incoming", "both"]).optional(),
}
```

**Handler must accept:**
```typescript
async ({
  source,
  target,
  max_hops,
  direction,
}: {
  source: string;
  target?: string;
  max_hops?: number;
  direction?: "outgoing" | "incoming" | "both";
}) => { ... }
```

#### 8. cw_status (status.ts)
**Schema:**
```typescript
{ verbose: z.boolean().optional() }
```

**Handler must accept:**
```typescript
async ({ verbose }: { verbose?: boolean }) => { ... }
```

#### 9. cw_recall (recall.ts)
**Schema:**
```typescript
{
  query: z.string().min(1).max(2000),
  scope: z.string().optional(),
  include_stale: z.boolean().optional(),
  limit: z.number().min(1).max(500).optional(),
}
```

**Handler must accept:**
```typescript
async ({
  query,
  scope,
  include_stale,
  limit,
}: {
  query: string;
  scope?: string;
  include_stale?: boolean;
  limit?: number;
}) => { ... }
```

#### 10. cw_files (files.ts)
**Schema:**
```typescript
{
  pattern: z.string().optional(),
  path: z.string().optional(),
  max_results: z.number().min(1).max(500).optional(),
}
```

**Handler must accept:**
```typescript
async ({
  pattern,
  path,
  max_results,
}: {
  pattern?: string;
  path?: string;
  max_results?: number;
}) => { ... }
```

#### 11. cw_stats (stats.ts)
**Schema:**
```typescript
{ session_id: z.string().optional() }
```

**Handler must accept:**
```typescript
async ({ session_id }: { session_id?: string }) => { ... }
```

#### 12. cw_overview (overview.ts)
**Schema:**
```typescript
{
  path: z.string().optional(),
  depth: z.number().min(1).max(8).optional(),
  max_tokens: z.number().min(200).max(8000).optional(),
  query: z.string().max(2000).optional(),
}
```

**Handler must accept:**
```typescript
async ({
  path,
  depth,
  max_tokens,
  query,
}: {
  path?: string;
  depth?: number;
  max_tokens?: number;
  query?: string;
}) => { ... }
```

### Validation Criteria
1. **Schema-to-handler type inference** works for all 12 tools
2. **No explicit handler parameter types needed** (inferred from schema)
3. **Optional fields properly typed** with `?` modifier
4. **Enum fields properly narrowed** to literal union types
5. **Return type matches** `Promise<CallToolResult>`

### Evidence Required
- [ ] TypeScript compiler reports no errors in any tool file
- [ ] IntelliSense/autocomplete shows correct inferred types for handler parameters
- [ ] Changing a schema property name causes a type error in the handler
- [ ] Changing a schema property type causes a type error in the handler

---

## VAL-SEC-006d: No Regression in Tool Registration Functionality

### Assertion
All 12 tools must continue to function correctly at runtime after the type safety fix, with no behavioral changes or regressions.

### Functional Test Cases

#### Compile-Time Smoke Test
```typescript
// This should compile and catch type errors
const testSchema = {
  required: z.string(),
  optional: z.number().optional(),
};

// ✓ VALID: Correct handler signature
registerTool("test", "desc", testSchema, async ({ required, optional }) => {
  // TypeScript knows: required is string, optional is number | undefined
  return { content: [{ type: "text" as const, text: required }] };
});

// ✗ INVALID: Should cause compile error (wrong type)
registerTool("test", "desc", testSchema, async ({ required }) => {
  const num: number = required; // Error: string not assignable to number
  return { content: [] };
});

// ✗ INVALID: Should cause compile error (missing required)
registerTool("test", "desc", testSchema, async ({ optional }) => {
  // Error: missing required property 'required'
  return { content: [] };
});
```

### Validation Criteria

#### 1. Runtime Registration Success
- [ ] All 12 tools register without runtime errors
- [ ] Server starts successfully with all tools registered
- [ ] Tool list request returns all 12 tools

#### 2. Tool Invocation Success
For each tool, verify:
- [ ] Valid arguments invoke successfully
- [ ] Return value has correct shape `{ content: Array<{type: "text", text: string}>, isError?: boolean }`

#### 3. Backward Compatibility
- [ ] Existing tool calls from clients continue to work
- [ ] Zod validation still catches invalid inputs
- [ ] Error responses maintain same format

### Evidence Required

#### Unit Test Evidence
```bash
# Run unit tests for MCP tools
npm test -- src/mcp/tools/

# Expected: All tests pass
# ✓ register-helper.test.ts
# ✓ capsule.test.ts
# ✓ remember.test.ts
# ✓ read.test.ts
# ✓ search.test.ts
# ✓ reindex.test.ts
# ✓ impact.test.ts
# ✓ flow.test.ts
# ✓ status.test.ts
# ✓ recall.test.ts
# ✓ files.test.ts
# ✓ stats.test.ts
# ✓ overview.test.ts
```

#### Integration Test Evidence
```bash
# Start MCP server and verify all tools
# - Server starts without errors
# - All 12 tools respond to valid requests
# - Type-safe handlers execute correctly
```

#### Manual Verification Checklist
- [ ] `cw_capsule` generates context capsule
- [ ] `cw_remember` stores observation
- [ ] `cw_read` reads file content
- [ ] `cw_grep` searches files
- [ ] `cw_reindex` reindexes project
- [ ] `cw_impact` analyzes dependencies
- [ ] `cw_flow` traces call flow
- [ ] `cw_status` returns index status
- [ ] `cw_recall` retrieves observations
- [ ] `cw_files` lists files
- [ ] `cw_stats` returns session stats
- [ ] `cw_overview` shows project overview

---

## Summary of Evidence Requirements

### Compile-Time Validation
| Evidence | Command/Method | Success Criteria |
|----------|----------------|------------------|
| Type check | `npm run lint` (tsc --noEmit) | Exit code 0, zero errors |
| Build | `npm run build` | Clean build with no type errors |
| IDE check | VS Code/IntelliSense | No red squiggles in tool files |

### Runtime Validation
| Evidence | Command/Method | Success Criteria |
|----------|----------------|------------------|
| Unit tests | `npm test -- src/mcp/tools/` | All tests pass |
| Server startup | Start MCP server | No registration errors |
| Tool invocation | Call each tool | Correct responses |

### Code Review Evidence
| Evidence | Location | Success Criteria |
|----------|----------|------------------|
| Type definition | `register-helper.ts` | No `any[]`, uses generics |
| Handler conformance | All 12 tool files | Inferred types match schemas |
| No workarounds | All files | No `@ts-ignore`, no `as any` |

---

## Recommended Implementation Steps

1. **Define strict types** in `register-helper.ts`:
   - Replace `any[]` with generic `RegisterToolFn<T>`
   - Add `ToolParameters`, `ToolArgs<T>`, `ToolHandler<T>` types
   - Import `CallToolResult` from MCP SDK types

2. **Update `getRegisterTool`** function:
   - Return the new strict type
   - Ensure generic type inference flows from schema parameter

3. **Verify all 12 tools** compile without changes (or minimal changes)
   - Most tools should work without modification due to type inference
   - Some may need explicit generic parameters if inference fails

4. **Run full test suite**:
   - Unit tests: `npm test`
   - Type check: `npm run lint`
   - Build: `npm run build`

5. **Manual integration test**:
   - Start MCP server
   - Verify all 12 tools respond correctly
