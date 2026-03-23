# Security Patterns Library

**What belongs here:** Security fix patterns, vulnerability examples, and secure coding guidelines discovered during this mission.
**What does NOT belong here:** General code patterns (use architecture.md), testing patterns (use testing.md).

---

## SQL Injection Prevention

### Pattern: Parameterized Queries

**Vulnerable pattern:**
```typescript
const kindList = kinds.map(k => `'${k}'`).join(", ");
const query = `SELECT * FROM edges WHERE kind IN (${kindList})`;
```

**Secure pattern:**
```typescript
const placeholders = kinds.map(() => '?').join(', ');
const query = `SELECT * FROM edges WHERE kind IN (${placeholders})`;
const stmt = db.prepare(query);
const results = stmt.all(...kinds);
```

**Key principles:**
- Never interpolate user input into SQL strings
- Use `?` placeholders with better-sqlite3
- For IN clauses, generate one `?` per item and spread the array

---

## LIKE Wildcard Escaping

### Pattern: Escape % and _

**Vulnerable pattern:**
```typescript
const pattern = `%${term}%`;
const query = `SELECT * FROM chunks WHERE content LIKE ?`;
```

**Secure pattern:**
```typescript
function escapeLikePattern(term: string): string {
  return term
    .replace(/\\/g, '\\\\')  // Escape backslash first
    .replace(/%/g, '\\%')    // Escape percent
    .replace(/_/g, '\\_');   // Escape underscore
}
const pattern = `%${escapeLikePattern(term)}%`;
const query = `SELECT * FROM chunks WHERE content LIKE ? ESCAPE '\\'`;
```

---

## FTS5 Query Sanitization

### Pattern: Escape Double Quotes

**Vulnerable pattern:**
```typescript
const quoted = `"${term}"`;  // Breaks if term contains "
```

**Secure pattern:**
```typescript
function sanitizeFTS5(term: string): string {
  // Escape double quotes by doubling them
  return term.replace(/"/g, '""');
}
const quoted = `"${sanitizeFTS5(term)}"`;
```

**Consistent strategy across modules:**
- Always escape double quotes as `""`
- Consider creating a shared utility function
- Document the strategy in code comments

---

## Input Validation with Zod

### Pattern: Path Traversal Prevention

**Schema with max length and path validation:**
```typescript
import { z } from 'zod';

const PathSchema = z.string()
  .max(4096, 'Path too long')
  .refine(
    (path) => !path.includes('..'),
    'Path traversal not allowed'
  );

const GlobSchema = z.string()
  .max(4096, 'Glob pattern too long')
  .refine(
    (glob) => !glob.includes('..'),
    'Path traversal not allowed'
  );
```

### Pattern: Config Bounds Validation

**Explicit field validation:**
```typescript
function validateConfig(raw: unknown): ProjectConfig {
  const config: ProjectConfig = {
    tokenBudget: clampNumber(raw.tokenBudget, 100, 50000, 10000),
    confidenceDecay: clampNumber(raw.confidenceDecay, 0, 1, 0.9),
    stalenessDepth: clampNumber(raw.stalenessDepth, 0, 10, 7),
    gcThreshold: clampNumber(raw.gcThreshold, 0, 1, 0.5),
    // ... other fields
  };
  return config;
}

function clampNumber(value: unknown, min: number, max: number, defaultValue: number): number {
  if (typeof value !== 'number' || isNaN(value)) return defaultValue;
  return Math.max(min, Math.min(max, value));
}
```

---

## Type Safety Hardening

### Pattern: Replace any[] with Specific Types

**Vulnerable pattern:**
```typescript
export type RegisterToolFn = (...args: any[]) => void;
```

**Secure pattern:**
```typescript
import { Tool } from '@modelcontextprotocol/sdk';

export type RegisterToolFn = (tool: Tool) => void;
// Or use specific parameter tuple if SDK provides it
```

---

## Testing Security Fixes

### Pattern: Demonstrate Vulnerability First

1. Write test that would FAIL if vulnerability exists
2. Run test to confirm it fails (red)
3. Implement fix
4. Run test to confirm it passes (green)
5. Add edge case tests

**Example injection test:**
```typescript
test('rejects SQL injection in kind parameter', () => {
  const malicious = "foo'); DROP TABLE edges; --";
  // Should either throw validation error or safely parameterize
  expect(() => {
    clusterEdges(db, [malicious], 0.5);
  }).not.toThrow(/DROP TABLE/);  // SQL shouldn't execute
  // Verify no table was dropped
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())
    .toContainEqual({ name: 'edges' });
});
```
