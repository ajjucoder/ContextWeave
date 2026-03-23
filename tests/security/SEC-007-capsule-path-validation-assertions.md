# SEC-007: Capsule Path/Glob Validation Assertions

**Finding**: Path and glob parameters in `cw_capsule` tool lack validation for path traversal and string length.

**Location**: `/src/mcp/tools/capsule.ts`

**Vulnerability Summary**:
- `path` parameter: `z.string().optional()` - no length constraint, no traversal prevention
- `glob` parameter: `z.string().optional()` - no length constraint, no traversal prevention

---

## VAL-SEC-007a: Path parameter rejects `..` segments

### Assertion
```typescript
// Given: A cw_capsule call with path traversal in 'path' parameter
const result = await cw_capsule({
  query: "test",
  path: "../../etc/passwd"  // or "src/../../etc/passwd"
});

// Then: The call MUST reject with a validation or security error
expect(result.isError).toBe(true);
expect(result.content[0].text).toMatch(/outside project root|traversal|invalid path/i);
```

### Validation Required
- Zod schema must include `.refine()` to block any `..` path segment
- OR runtime check using `isPathWithinRoot()` must reject the path
- Path traversal patterns to block:
  - `../` at start
  - `/../` in middle
  - `../../` multiple traversal
  - `foo/../../../etc/passwd` (traversal after valid segments)

### Evidence Requirement
```typescript
// Test cases that must fail:
[
  "../file.ts",                    // Parent escape at root
  "../../etc/passwd",              // Double escape
  "src/../secret.ts",              // Valid then escape
  "src/../../etc/passwd",          // Valid then double escape
  "./../secret.ts",                // Current dir then escape
  "a/b/../../../etc/passwd",       // Deep escape
  "../../../etc/passwd",           // Triple escape
  "/absolute/outside/path.ts",     // Absolute path outside root
]
```

---

## VAL-SEC-007b: Glob parameter rejects `..` segments

### Assertion
```typescript
// Given: A cw_capsule call with path traversal in 'glob' parameter
const result = await cw_capsule({
  query: "test",
  glob: "../../etc/**"  // or "**/../../etc/*"
});

// Then: The call MUST reject with a validation or security error
expect(result.isError).toBe(true);
expect(result.content[0].text).toMatch(/outside project root|traversal|invalid glob/i);
```

### Validation Required
- Zod schema must include `.refine()` to block any `..` in glob pattern
- Glob patterns containing `..` must be rejected regardless of wildcard placement
- Traversal patterns in globs to block:
  - `../**/*.ts` - parent escape with wildcards
  - `**/../secret.ts` - wildcards then escape
  - `src/../../**/*.ts` - valid segment then escape
  - `../../**` - pure escape pattern

### Evidence Requirement
```typescript
// Test cases that must fail:
[
  "../**/*.ts",
  "../../etc/**",
  "**/../secret.ts",
  "src/../../**/*",
  "a/**/../../b/**/*.ts",
  "../../**",
  "../../*",
  "../../../**/*.json",
]
```

---

## VAL-SEC-007c: Path parameter max length enforced

### Assertion
```typescript
// Given: A cw_capsule call with excessively long 'path' parameter
const longPath = "a/".repeat(500) + "file.ts"; // ~1000+ chars
const result = await cw_capsule({
  query: "test",
  path: longPath
});

// Then: The call MUST reject with validation error
expect(result.isError).toBe(true);
expect(result.content[0].text).toMatch(/too long|max length|exceeds/i);
```

### Validation Required
- Zod schema must include `.max(N)` constraint on path string
- Recommended max: 500-1000 characters (filesystem paths rarely exceed 4096)
- Must prevent DoS via extremely long path strings

### Evidence Requirement
```typescript
// Test cases:
[
  { path: "a".repeat(1001), shouldFail: true },   // Exceeds 1000 char limit
  { path: "a".repeat(500), shouldFail: false },   // Within limit
  { path: "a".repeat(2000), shouldFail: true },     // Way exceeds
]
```

---

## VAL-SEC-007d: Glob parameter max length enforced

### Assertion
```typescript
// Given: A cw_capsule call with excessively long 'glob' parameter
const longGlob = "**/*" + "a".repeat(2000); // ~2000+ chars
const result = await cw_capsule({
  query: "test",
  glob: longGlob
});

// Then: The call MUST reject with validation error
expect(result.isError).toBe(true);
expect(result.content[0].text).toMatch(/too long|max length|exceeds/i);
```

### Validation Required
- Zod schema must include `.max(N)` constraint on glob string
- Recommended max: 500-1000 characters (complex globs rarely exceed this)
- Must prevent DoS via extremely long glob patterns

### Evidence Requirement
```typescript
// Test cases:
[
  { glob: "**/*" + "a".repeat(1000), shouldFail: true },
  { glob: "**/*.ts", shouldFail: false },
  { glob: "a/".repeat(300) + "*.ts", shouldFail: true },
]
```

---

## VAL-SEC-007e: Absolute path rejection or validation

### Assertion
```typescript
// Given: A cw_capsule call with absolute path outside project root
const result = await cw_capsule({
  query: "test",
  path: "/etc/passwd"
});

// Then: The call MUST reject with security error
expect(result.isError).toBe(true);
expect(result.content[0].text).toMatch(/outside project root|absolute path rejected/i);
```

### Validation Required
- Absolute paths must be validated against `isPathWithinRoot()`
- OR rejected at Zod schema level with `.refine()` checking for leading `/`
- Windows absolute paths (e.g., `C:\Windows\file.txt`) must also be handled

### Evidence Requirement
```typescript
// Test cases that must fail:
[
  "/etc/passwd",                          // Unix absolute
  "/home/user/.ssh/id_rsa",              // Unix absolute sensitive
  "C:\\Windows\\System32\\config.sam",     // Windows absolute
  "D:\\secret.txt",                        // Windows absolute D:
  "\\server\\share\\secret.txt",          // UNC path
]

// Test cases that should pass (if within root):
[
  "/project/src/file.ts",                 // Absolute within root
  "/project/absolute/path/file.ts",       // Absolute within root
]
```

---

## Zod Refinement Implementation Pattern

Based on existing codebase patterns (see `reindex.ts`, `read.ts`), implement as:

```typescript
import { isPathWithinRoot } from "../../core/indexer.js";

// Schema definition
const inputSchema = {
  query: z.string().min(1).max(2000),
  path: z.string()
    .max(500, "Path must not exceed 500 characters")
    .refine(
      (val) => !val.includes(".."),
      "Path cannot contain parent directory references (..)"
    )
    .optional(),
  glob: z.string()
    .max(500, "Glob pattern must not exceed 500 characters")
    .refine(
      (val) => !val.includes(".."),
      "Glob cannot contain parent directory references (..)"
    )
    .optional(),
};

// Runtime validation in handler
if (path) {
  const fullPath = resolve(projectRoot, path);
  if (!isPathWithinRoot(fullPath, projectRoot)) {
    return {
      content: [{ type: "text", text: `Error: path "${path}" is outside the project root` }],
      isError: true,
    };
  }
}

if (glob) {
  // Glob traversal check
  if (glob.includes("..")) {
    return {
      content: [{ type: "text", text: `Error: glob "${glob}" contains invalid path traversal` }],
      isError: true,
    };
  }
}
```

---

## Test Suite Structure

```typescript
describe("cw_capsule path/glob validation (SEC-007)", () => {
  describe("VAL-SEC-007a: Path rejects traversal", () => {
    it.each([
      "../file.ts",
      "../../etc/passwd",
      "src/../secret.ts",
    ])("rejects path with traversal: %s", async (path) => {
      // test implementation
    });
  });

  describe("VAL-SEC-007b: Glob rejects traversal", () => {
    it.each([
      "../**/*.ts",
      "../../etc/**",
      "**/../secret.ts",
    ])("rejects glob with traversal: %s", async (glob) => {
      // test implementation
    });
  });

  describe("VAL-SEC-007c: Path max length", () => {
    it("rejects path exceeding 500 chars", async () => {
      // test implementation
    });
    it("accepts path under 500 chars", async () => {
      // test implementation
    });
  });

  describe("VAL-SEC-007d: Glob max length", () => {
    it("rejects glob exceeding 500 chars", async () => {
      // test implementation
    });
  });

  describe("VAL-SEC-007e: Absolute path validation", () => {
    it("rejects absolute paths outside project root", async () => {
      // test implementation
    });
    it("accepts absolute paths within project root", async () => {
      // test implementation
    });
  });
});
```

---

## Verification Checklist

- [ ] VAL-SEC-007a: `../` in path parameter → Error response
- [ ] VAL-SEC-007b: `../` in glob parameter → Error response
- [ ] VAL-SEC-007c: Path >500 chars → Validation error
- [ ] VAL-SEC-007d: Glob >500 chars → Validation error
- [ ] VAL-SEC-007e: Absolute path outside root → Error response
- [ ] All tests pass with `npm test tests/security/capsule-path-validation.test.ts`
