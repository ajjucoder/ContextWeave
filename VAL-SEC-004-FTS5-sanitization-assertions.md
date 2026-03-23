# VAL-SEC-004: FTS5 Sanitization Validation Assertions

## Security Findings #4 and #5

**Location:**
- `src/db/queries/symbols.ts` (lines 194-202)
- `src/core/file-summaries.ts` (line 374, ~400)

---

## VAL-SEC-004a: Double Quote Escaping in symbols.ts

### Current Vulnerability
```typescript
// symbols.ts lines 194-202
searchFTS(term: string, limit: number): SymbolRecord[] {
  const escaped = term.replace(/[^a-zA-Z0-9_.\-\s]/g, "");  // Strips but doesn't escape quotes
  if (!escaped.trim()) return [];
  const pattern = `"${escaped.trim()}"`;  // Wraps in double quotes without escaping inner quotes
  try {
    return searchFTS.all(pattern, limit).map(mapRow).filter(Boolean) as SymbolRecord[];
  } catch {
    return [];
  }
}
```

### Validation Assertion
```typescript
/**
 * VAL-SEC-004a: Double quote escaping in symbols.ts
 * 
 * ASSERTION: All input containing double quotes (") must be either:
 *   (a) Stripped entirely, OR
 *   (b) Escaped by doubling ("" → """) before FTS5 pattern construction
 * 
 * FAILURE CASE: Input 'foo"bar' with current code produces pattern '"foo"bar"'
 *               which FTS5 parses as: phrase "foo" followed by unmatched "bar"
 *               → Syntax error or unexpected results
 */
```

### Test Cases
| Input | Current (Broken) | Required Behavior | Safe Pattern |
|-------|-----------------|-------------------|--------------|
| `foo"bar` | `"foo"bar"` | Strip or escape | `"foobar"` or `"foo""bar"` |
| `"test"` | `""test""` | Strip or escape | `"test"` or `"""test"""` |
| `a"b"c` | `"a"b"c"` | Strip or escape | `"abc"` or `"a""b""c"` |

### Evidence Requirement
- [ ] Unit test demonstrating `"foo"bar"` causes FTS5 syntax error
- [ ] Fixed code passes all quote-injection test cases
- [ ] Fuzzing with quote-containing strings produces no FTS5 errors

---

## VAL-SEC-004b: FTS5 Operator Removal in symbols.ts

### Current Vulnerability
```typescript
const escaped = term.replace(/[^a-zA-Z0-9_.\-\s]/g, "");
// ^ Removes special chars but PRESERVES: letters forming AND, OR, NOT, NEAR
```

### FTS5 Special Characters Reference
| Character | Purpose | Current Handling | Risk |
|-----------|---------|------------------|------|
| `"` | Phrase grouping | Stripped | Partial (no escaping) |
| `*` | Prefix matching | **NOT handled** | Injection possible |
| `^` | Initial char match | **NOT handled** | Injection possible |
| `AND` `OR` `NOT` | Boolean ops | **NOT handled** | Logic manipulation |
| `NEAR/n` | Proximity | **NOT handled** | Performance DoS |

### Validation Assertion
```typescript
/**
 * VAL-SEC-004b: FTS5 operator removal in symbols.ts
 * 
 * ASSERTION: All FTS5 query operators must be neutralized:
 *   1. Double quotes: escape as "" or strip
 *   2. Asterisk (*): strip entirely (prevents prefix injection)
 *   3. Caret (^): strip entirely (prevents initial-char injection)
 *   4. Boolean operators: treat as literals via enclosing in double-quotes
 *   5. NEAR/n proximity: strip /n portion, treat NEAR as literal
 * 
 * INPUT SANITIZATION RULES:
 *   - Step 1: Replace all double quotes with ""
 *   - Step 2: Strip all * and ^ characters
 *   - Step 3: Strip /n patterns (digits after slash)
 *   - Step 4: Wrap sanitized term in outer double quotes
 */
```

### Test Cases
| Input | Purpose | Current Output | Required Output |
|-------|---------|----------------|-----------------|
| `foo*` | Wildcard injection | `foo*` (dangerous) | `foo` (safe) |
| `^bar` | Initial char match | `^bar` (dangerous) | `bar` (safe) |
| `foo AND bar` | Boolean injection | `foo AND bar` (dangerous) | `"foo AND bar"` (literal) |
| `foo OR bar` | Boolean injection | `foo OR bar` (dangerous) | `"foo OR bar"` (literal) |
| `foo NEAR/5 bar` | Proximity injection | `foo NEAR5 bar` | `"foo NEAR bar"` |

### Evidence Requirement
- [ ] Test that `foo*` with current code performs prefix search (undesired)
- [ ] Test that `foo AND bar` with current code performs boolean AND (undesired)
- [ ] Fixed code treats all above as literal string searches
- [ ] No FTS5 query operators can be injected through user input

---

## VAL-SEC-004c: Double Quote Escaping in file-summaries.ts

### Current Vulnerability
```typescript
// file-summaries.ts line 374
const terms = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
// ^ Different strategy: replaces with space, still doesn't escape quotes for OR patterns

// file-summaries.ts ~line 400
const orPattern = expandedWords.map((w) => `"${w}"`).join(" OR ");
// ^ Wraps each word in quotes without escaping inner quotes
```

### Validation Assertion
```typescript
/**
 * VAL-SEC-004c: Double quote escaping in file-summaries.ts
 * 
 * ASSERTION: When constructing OR patterns with quoted terms,
 *            each term must have its internal quotes escaped.
 * 
 * INPUT PROCESSING:
 *   - Step 1: Normalize to lowercase
 *   - Step 2: Replace non-alphanumeric (except space) with space
 *   - Step 3: Split on whitespace
 *   - Step 4: For each word, escape double quotes by doubling
 *   - Step 5: Wrap each word in double quotes
 *   - Step 6: Join with " OR "
 * 
 * FAILURE CASE: Input 'foo"bar baz' → split to ['foo"bar', 'baz']
 *             Current: produces '"foo"bar" OR "baz"' (broken)
 *             Fixed:   produces '"foo""bar" OR "baz"' (valid)
 */
```

### Test Cases
| Input | Current Pattern | Required Pattern |
|-------|-----------------|------------------|
| `foo"bar` | `"foo"bar"` (malformed) | `"foo""bar"` (valid) |
| `test"` | `"test"` (unclosed) | `"test""` (valid) |
| `a"b c"d` | `"a"b" OR "c"d"` (malformed) | `"a""b" OR "c""d"` (valid) |

### Evidence Requirement
- [ ] Unit test that OR pattern construction handles quotes correctly
- [ ] Integration test with quote-containing search terms
- [ ] FTS5 query execution succeeds without syntax errors

---

## VAL-SEC-004d: Consistent Sanitization Strategy Across Both Files

### Current Inconsistency
| Aspect | symbols.ts | file-summaries.ts |
|--------|-----------|-------------------|
| Strategy | Strip chars | Replace with space |
| Char set | `[^a-zA-Z0-9_.\-\s]` | `[^a-z0-9\s]` |
| Case handling | Preserves case | Forces lowercase |
| Quote handling | Strip | Replace with space |
| Boolean words | Pass through | Pass through |

### Validation Assertion
```typescript
/**
 * VAL-SEC-004d: Consistent sanitization strategy
 * 
 * ASSERTION: Both files MUST use identical FTS5 sanitization logic
 *            to prevent bypass attacks exploiting differences.
 * 
 * REQUIRED UNIFIED STRATEGY:
 *   - Regex: /[^a-zA-Z0-9_\s]/g (alphanumeric + underscore + whitespace only)
 *   - Action: Strip (replace with empty string, not space)
 *   - Case: Preserve (FTS5 is case-insensitive anyway)
 *   - Quotes: Strip entirely (simpler than escaping)
 *   - FTS5 operators: All stripped
 * 
 * UNIFIED SANITIZATION FUNCTION (to be shared):
 *   function sanitizeFTS5Term(term: string): string {
 *     return term
 *       .replace(/[^a-zA-Z0-9_\s]/g, "")  // Remove all special chars
 *       .replace(/\s+/g, " ")             // Normalize whitespace
 *       .trim();
 *   }
 * 
 * SAFETY RATIONALE:
 *   - Strips rather than escapes: simpler, less error-prone
 *   - Removes all non-alphanumeric: covers *, ^, ", /, etc.
 *   - Consistent across codebase: no bypass via different handling
 */
```

### Test Cases (Both Files Must Pass)
| Input | symbols.ts Output | file-summaries.ts Output | Match |
|-------|-------------------|--------------------------|-------|
| `test*data` | `testdata` | `testdata` | ✓ |
| `foo^bar` | `foobar` | `foobar` | ✓ |
| `a"b` | `ab` | `ab` | ✓ |
| `AND` | `AND` | `AND` | ✓ (treated as literal) |
| `NEAR/5` | `NEAR5` or `NEAR` | `NEAR5` or `NEAR` | ✓ |

### Evidence Requirement
- [ ] Both files use the same sanitization function (DRY principle)
- [ ] Identical inputs produce identical sanitized outputs in both files
- [ ] Shared unit tests covering all edge cases pass for both
- [ ] No security bypass possible by exploiting different character handling

---

## FTS5 Injection Prevention Evidence

### Required Test Suite Structure
```typescript
describe("VAL-SEC-004 FTS5 Sanitization", () => {
  describe("VAL-SEC-004a: Quote escaping in symbols.ts", () => {
    test.each([
      ['foo"bar', 'foobar'],           // Strip quotes
      ['"test"', 'test'],              // Strip surrounding quotes
      ['a"b"c', 'abc'],                // Multiple quotes
    ])("input %p → sanitized %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });

  describe("VAL-SEC-004b: Operator removal in symbols.ts", () => {
    test.each([
      ['foo*', 'foo'],                  // No prefix matching
      ['^test', 'test'],                // No initial char matching
      ['a AND b', 'a AND b'],           // Boolean treated literally
      ['NEAR/5', 'NEAR'],               // No proximity operator
    ])("input %p → sanitized %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });

  describe("VAL-SEC-004c: Quote handling in file-summaries.ts OR patterns", () => {
    test.each([
      [['foo"bar'], '"foo""bar"'],      // Escaped quote in OR pattern
      [['test"'], '"test""'],           // Trailing quote
      [['a"b', 'c"d'], '"a""b" OR "c""d"'],
    ])("words %p → pattern %p", (words, expected) => {
      expect(buildORPattern(words)).toBe(expected);
    });
  });

  describe("VAL-SEC-004d: Consistency between files", () => {
    test.each([
      'test*data',
      'foo^bar',
      'a"b',
      'AND',
      'NEAR/5',
    ])("%p sanitizes identically in both files", (input) => {
      expect(sanitizeSymbols(input)).toBe(sanitizeFileSummaries(input));
    });
  });
});
```

### Evidence Checklist
- [ ] All test assertions pass
- [ ] Fuzz testing with 1000+ random strings produces no FTS5 errors
- [ ] Manual penetration testing confirms no operator injection possible
- [ ] Code review confirms shared sanitization function used everywhere
- [ ] Documentation updated with FTS5 security considerations

---

## Implementation Recommendation

### Recommended Shared Function
```typescript
// src/utils/fts5-sanitize.ts
/**
 * Sanitizes a user input term for safe use in FTS5 MATCH expressions.
 * Removes all FTS5 special characters to prevent query injection.
 * 
 * FTS5 operators neutralized:
 *   - " (double quote) - phrase grouping
 *   - * (asterisk) - prefix matching
 *   - ^ (caret) - initial character matching
 *   - AND, OR, NOT - boolean operators (treated as literals via stripping)
 *   - NEAR/n - proximity operator (treated as literal)
 * 
 * @param term - User input to sanitize
 * @returns Sanitized term safe for FTS5 MATCH
 */
export function sanitizeFTS5Term(term: string): string {
  // Remove all non-alphanumeric characters except underscore and whitespace
  // This covers: " * ^ / ( ) and any other FTS5 special chars
  return term
    .replace(/[^a-zA-Z0-9_\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds an FTS5 OR pattern from multiple terms.
 * Each term is individually sanitized and quoted.
 * 
 * @param terms - Array of terms to combine with OR
 * @returns FTS5 OR pattern string
 */
export function buildFTS5ORPattern(terms: string[]): string {
  const sanitized = terms.map(sanitizeFTS5Term).filter(Boolean);
  if (sanitized.length === 0) return "";
  if (sanitized.length === 1) return `"${sanitized[0]}"`;
  
  // Since we strip all quotes, no escaping needed
  return sanitized.map(t => `"${t}"`).join(" OR ");
}
```

### Files to Update
1. **Create:** `src/utils/fts5-sanitize.ts` - shared sanitization utilities
2. **Update:** `src/db/queries/symbols.ts` - use `sanitizeFTS5Term()` in `searchFTS()`
3. **Update:** `src/core/file-summaries.ts` - use `sanitizeFTS5Term()` and `buildFTS5ORPattern()`
4. **Create:** `src/utils/fts5-sanitize.test.ts` - comprehensive test suite

---

## Summary

| Assertion | File | Issue | Fix |
|-----------|------|-------|-----|
| VAL-SEC-004a | symbols.ts | No quote escaping | Strip all quotes or escape as `""` |
| VAL-SEC-004b | symbols.ts | FTS5 operators pass through | Strip `*`, `^`, `/n` patterns |
| VAL-SEC-004c | file-summaries.ts | OR patterns unescaped quotes | Use shared sanitization |
| VAL-SEC-004d | Both | Inconsistent strategies | Unified `sanitizeFTS5Term()` function |

**Impact:** Without these fixes, attackers can manipulate FTS5 queries to:
- Perform unintended boolean operations (AND/OR/NOT)
- Execute expensive wildcard/prefix searches
- Cause FTS5 syntax errors (DoS)
- Potentially access unintended data through query manipulation
