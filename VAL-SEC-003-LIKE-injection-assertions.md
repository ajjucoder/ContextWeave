# VAL-SEC-003: LIKE Wildcard Injection Validation Assertions

## Vulnerability Summary
**Location:** `src/capsule/content-fallback.ts` lines 24-25  
**Issue:** Unescaped LIKE wildcards (`%` and `_`) in user terms cause unintended broad matches  
**Fix Reference:** `src/db/queries/files.ts` shows correct pattern: `term.replace(/[\\%_]/g, "\\$&")` with `ESCAPE '\\'`

---

## VAL-SEC-003a: Percent Sign Escaping

### Assertion
The escape function MUST escape the `%` wildcard character so it is treated as a literal percent sign, not as a "match any sequence" wildcard.

### Testable Conditions

| Input Term | Expected Pattern | Expected SQL Behavior |
|------------|------------------|----------------------|
| `test%` | `%test\%%` | Matches "test%" literally, NOT "test" followed by anything |
| `%test` | `%\%test%` | Matches "%test" literally, NOT anything ending with "test" |
| `te%st` | `%te\%st%` | Matches "te%st" literally, NOT "te" + anything + "st" |
| `100%` | `%100\%%` | Matches "100%" literally, NOT "100" + anything |

### Evidence Requirements
1. **Unit test showing literal match:**
   ```typescript
   // With fix: search for "50%" should NOT match "50 percent complete"
   const term = "50%";
   const escaped = term.replace(/[\\%_]/g, "\\$&"); // "50\%"
   const pattern = `%${escaped}%`; // "%50\%%"
   // SQL: LIKE '%50\%%' ESCAPE '\'
   // Should match: "50%", "Value is 50%", NOT "50 percent"
   ```

2. **Demonstration of non-escape behavior (vulnerability):**
   ```typescript
   // Without fix: "50%" becomes "%50%%"
   // SQL: LIKE '%50%%'
   // Matches: "50%" (literal) AND "50 percent" (wildcard!) AND "50x" (wildcard!)
   ```

### Verification Query
```sql
-- Test data setup
INSERT INTO symbols (full_source) VALUES ('Value is 50%');
INSERT INTO symbols (full_source) VALUES ('50 percent complete');
INSERT INTO symbols (full_source) VALUES ('50x value');

-- With proper escaping (should return 1 row):
SELECT * FROM symbols WHERE full_source LIKE '%50\%%' ESCAPE '\';

-- Without escaping (vulnerable - returns 3 rows):
SELECT * FROM symbols WHERE full_source LIKE '%50%%';
```

---

## VAL-SEC-003b: Underscore Escaping

### Assertion
The escape function MUST escape the `_` wildcard character so it is treated as a literal underscore, not as a "match any single character" wildcard.

### Testable Conditions

| Input Term | Expected Pattern | Expected SQL Behavior |
|------------|------------------|----------------------|
| `file_name` | `%file\_name%` | Matches "file_name" literally, NOT "filename" or "fileXname" |
| `_test` | `%\_test%` | Matches "_test" literally, NOT "atest", "btest", etc. |
| `test_` | `%test\_%` | Matches "test_" literally, NOT "testX" for any X |
| `a_b_c` | `%a\_b\_c%` | Matches "a_b_c" literally, NOT "aXbYc" |

### Evidence Requirements
1. **Unit test showing literal match:**
   ```typescript
   // With fix: search for "file_name" should NOT match "filename"
   const term = "file_name";
   const escaped = term.replace(/[\\%_]/g, "\\$&"); // "file\_name"
   const pattern = `%${escaped}%`; // "%file\_name%"
   // SQL: LIKE '%file\_name%' ESCAPE '\'
   // Should match: "file_name", "my_file_name.txt", NOT "filename"
   ```

2. **Demonstration of non-escape behavior (vulnerability):**
   ```typescript
   // Without fix: "file_name" becomes "%file_name%"
   // SQL: LIKE '%file_name%'
   // Matches: "file_name" (literal) AND "filename" (wildcard!) 
   //          AND "fileXname" (wildcard!) AND "file-name" (wildcard!)
   ```

### Verification Query
```sql
-- Test data setup
INSERT INTO symbols (full_source) VALUES ('const file_name = "test";');
INSERT INTO symbols (full_source) VALUES ('const filename = "test";');
INSERT INTO symbols (full_source) VALUES ('const file-name = "test";');

-- With proper escaping (should return 1 row):
SELECT * FROM symbols WHERE full_source LIKE '%file\_name%' ESCAPE '\';

-- Without escaping (vulnerable - returns 3 rows):
SELECT * FROM symbols WHERE full_source LIKE '%file_name%';
```

---

## VAL-SEC-003c: Backslash Handling

### Assertion
The escape function MUST escape the backslash character itself (`\`) to prevent users from injecting an escape character that could un-escape subsequent wildcards.

### Testable Conditions

| Input Term | Expected Pattern | Expected SQL Behavior |
|------------|------------------|----------------------|
| `test\%` | `%test\\%` | Matches "test\%" literally |
| `path\file` | `%path\\file%` | Matches "path\file" literally |
| `C:\Users` | `%C:\\Users%` | Matches "C:\Users" literally |
| `\_test` | `%\\\_test%` | Matches "\_test" literally (escaped backslash + escaped underscore) |

### Evidence Requirements
1. **Unit test showing literal backslash match:**
   ```typescript
   // With fix: search for "test\%" should match literal backslash
   const term = "test\\%";
   const escaped = term.replace(/[\\%_]/g, "\\$&"); // "test\\\%"
   const pattern = `%${escaped}%`; // "%test\\\%%"
   // SQL: LIKE '%test\\\%%' ESCAPE '\'
   // Should match: "test\%" literally
   ```

2. **Demonstration of injection vulnerability (without backslash escape):**
   ```typescript
   // Without fix: "test\\%" becomes "%test\\%%"
   // SQL: LIKE '%test\\%%' ESCAPE '\'
   // The \\\ is treated as an escape character, so \% becomes literal %
   // But the trailing % is a WILDCARD!
   // Attacker can craft: "test\\%value" -> "%test\\%value%"
   // SQL treats: test + literal% + value + wildcard%
   // Matches: "test%value", "test%valueanything"
   ```

3. **Complex injection scenario test:**
   ```typescript
   // Malicious input attempting to inject wildcards through escape char
   const malicious = "\\%";
   // Without backslash escape: "%\\%%" 
   // SQL sees: escape char (\) + literal % + wildcard %
   // Result: anything containing "%"
   // With backslash escape: "%\\\\\%%"
   // SQL sees: escaped backslash + escaped percent = literal "\%"
   ```

### Verification Query
```sql
-- Test data setup
INSERT INTO symbols (full_source) VALUES ('Value is test\%');
INSERT INTO symbols (full_source) VALUES ('Value is test%');
INSERT INTO symbols (full_source) VALUES ('Value is test\anything');

-- With proper escaping (should return 1 row - the literal backslash):
SELECT * FROM symbols WHERE full_source LIKE '%test\\\%%' ESCAPE '\';

-- Without backslash escaping (vulnerable - behavior undefined/inconsistent):
-- Input "%\\%%" with ESCAPE '\' would treat \\\ as escape, % as literal, trailing % as wildcard
```

---

## VAL-SEC-003d: Combined Wildcards

### Assertion
The escape function MUST correctly handle input containing combinations of `%`, `_`, and `\` characters without any one character interfering with the escaping of others.

### Testable Conditions

| Input Term | Expected Pattern | Contains |
|------------|------------------|----------|
| `%_%` | `%\%\_\%` | Escaped % + escaped _ + escaped % |
| `\%_` | `%\\\%\_%` | Escaped \ + escaped % + escaped _ |
| `te\%_st` | `%te\\\%\_st%` | Escaped \ + escaped % + escaped _ |
| `C:\%user\_file` | `%C:\\%user\\\_file%` | Escaped \ + escaped % + escaped \ + escaped _ |
| `%%%___` | `%\%\%\%\_\_\_%` | All 3 % and all 3 _ escaped |

### Evidence Requirements
1. **Complex pattern unit test:**
   ```typescript
   // Test that complex patterns escape all special chars
   const term = "%_\\%test%_";
   const escaped = term.replace(/[\\%_]/g, "\\$&");
   // Expected: "\%\_\\\%test\%\_"
   assert(escaped.includes("\\%"));      // % escaped
   assert(escaped.includes("\\_"));      // _ escaped  
   assert(escaped.includes("\\\\"));    // \ escaped (becomes \\\\ in string)
   ```

2. **SQL verification test:**
   ```typescript
   // Create test data with all combinations
   const testCases = [
     { input: "%_", matches: ["%_", "X%_Y"], notMatches: ["ab", "X_Y"] },
     { input: "\\%", matches: ["\\%", "X\\%Y"], notMatches: ["%", "X%Y"] },
     { input: "%_\\", matches: ["%_\\"], notMatches: ["ab", "abc"] }
   ];
   
   for (const tc of testCases) {
     const escaped = tc.input.replace(/[\\%_]/g, "\\$&");
     const pattern = `%${escaped}%`;
     // Verify SQL LIKE pattern with ESCAPE '\' matches only expected rows
   }
   ```

### Verification Query
```sql
-- Comprehensive test data
INSERT INTO symbols (full_source) VALUES ('Contains %_ pattern');
INSERT INTO symbols (full_source) VALUES ('Contains \% literal');
INSERT INTO symbols (full_source) VALUES ('Contains X_Y pattern');
INSERT INTO symbols (full_source) VALUES ('Contains ab');

-- Test combined escaping (should return 1 row):
SELECT * FROM symbols WHERE full_source LIKE '%\%\_ pattern%' ESCAPE '\';
-- Result: "Contains %_ pattern"

-- Without proper escaping would match 3+ rows
```

---

## Security Implications: Over-Broad Matches

### Vulnerability Impact

When LIKE wildcards are not escaped, an attacker can craft search terms that return far more results than intended:

| Attack Input | Intended Behavior | Actual Behavior (Vulnerable) |
|--------------|-------------------|------------------------------|
| `user%` | Find symbol named exactly "user%" | Find all symbols starting with "user" |
| `a_b` | Find symbol "a_b" | Find 3-letter symbols: aXb, aab, abb, etc. |
| `%test` | Find symbol "%test" | Find all symbols ending with "test" |
| `_` | Find symbol "_" | Find ALL single-character symbols |
| `%` | Find symbol "%" | Find ALL symbols (database dump!) |

### Concrete Attack Scenarios

**Scenario 1: Data Exfiltration via Broad Search**
```typescript
// Attacker sends: queryTerms = ["%"]
// Vulnerable code:
const pattern = `%${term}%`; // "%%%" which is equivalent to "%" (match everything)
// Returns: All symbols in the database up to the LIMIT
// Impact: Information disclosure - attacker can enumerate all indexed code
```

**Scenario 2: Denial of Service via Expensive Queries**
```typescript
// Attacker sends: queryTerms = ["_"]
// Pattern becomes "%_%" which matches every symbol with 1+ chars
// Database must scan all rows, return many results
// Impact: CPU/memory exhaustion on repeated calls
```

**Scenario 3: Bypassing Search Intent**
```typescript
// Application intends to find "auth_service" specifically
// Attacker crafts: "authXservice" (where X is any char)
// Without escape: "auth_service" pattern matches "auth_service", "authXservice", "auth-service"
// With escape: Only "auth_service" matches
```

### Risk Assessment

| Scenario | Severity | Likelihood | Impact |
|----------|----------|------------|--------|
| Data exfiltration | Medium | High | Attacker can enumerate all indexed symbols |
| DoS via large result sets | Low-Medium | Medium | Memory/CPU pressure from broad matches |
| Search result poisoning | Low | High | Wrong results returned to legitimate queries |

---

## Evidence Requirements Summary

### Required Unit Tests

```typescript
// File: tests/security/content-fallback-like-escape.test.ts

describe("VAL-SEC-003: LIKE wildcard escaping", () => {
  const escapeLikePattern = (term: string): string => {
    return term.replace(/[\\%_]/g, "\\$&");
  };

  describe("VAL-SEC-003a: Percent sign escaping", () => {
    it("must escape % to prevent 'match any sequence' behavior", () => {
      const escaped = escapeLikePattern("test%");
      assert(escaped === "test\\%");
    });

    it("must escape % at start of term", () => {
      const escaped = escapeLikePattern("%test");
      assert(escaped === "\\%test");
    });

    it("must escape multiple % characters", () => {
      const escaped = escapeLikePattern("%%test%%");
      assert(escaped === "\\%\\%test\\%\\%");
    });
  });

  describe("VAL-SEC-003b: Underscore escaping", () => {
    it("must escape _ to prevent 'match any char' behavior", () => {
      const escaped = escapeLikePattern("file_name");
      assert(escaped === "file\\_name");
    });

    it("must escape multiple _ characters", () => {
      const escaped = escapeLikePattern("a_b_c_d");
      assert(escaped === "a\\_b\\_c\\_d");
    });
  });

  describe("VAL-SEC-003c: Backslash handling", () => {
    it("must escape backslash to prevent escape injection", () => {
      const escaped = escapeLikePattern("test\\");
      assert(escaped === "test\\\\");
    });

    it("must handle backslash before wildcard correctly", () => {
      const escaped = escapeLikePattern("\\%");
      assert(escaped === "\\\\\\%"); // \\\\ + \\%
    });
  });

  describe("VAL-SEC-003d: Combined wildcards", () => {
    it("must handle combination of all special characters", () => {
      const escaped = escapeLikePattern("%_\\");
      assert(escaped.includes("\\%"));
      assert(escaped.includes("\\_"));
      assert(escaped.includes("\\\\"));
    });

    it("must handle complex real-world patterns", () => {
      const escaped = escapeLikePattern("C:\\Users\\%temp%\\file_name");
      // All \, %, and _ should be escaped
      const expected = "C:\\\\Users\\\\\\%temp\\%\\\\file\\_name";
      assert(escaped === expected);
    });
  });

  describe("Security impact verification", () => {
    it("must not allow % to match all content when searching for literal %", async () => {
      // Setup: Insert "test%value" and "testXvalue"
      // Search for "test%value" should return only exact match
      // Not "testXvalue" which would match with wildcard %
    });

    it("must not allow _ to match any character", async () => {
      // Setup: Insert "a_b" and "acb"
      // Search for "a_b" should return only "a_b", not "acb"
    });
  });
});
```

### Required Integration Tests

```typescript
// Verify actual SQL behavior with test database

describe("VAL-SEC-003: SQL LIKE escaping integration", () => {
  it("SQL query with ESCAPE clause treats escaped % as literal", async () => {
    const db = createTestDb();
    db.exec(`
      INSERT INTO symbols (id, file_id, full_source) VALUES 
        (1, 1, 'Value is 50%'),
        (2, 1, 'Value is 50 percent'),
        (3, 1, 'Value is 50x')
    `);

    // With proper escaping
    const stmt = db.prepare("SELECT * FROM symbols WHERE full_source LIKE ? ESCAPE '\\'");
    const escapedTerm = "50%".replace(/[\\%_]/g, "\\$&");
    const results = stmt.all(`%${escapedTerm}%`);

    assert(results.length === 1); // Only "Value is 50%"
    assert(results[0].full_source === "Value is 50%");
  });

  it("SQL query without escaping returns over-broad results", async () => {
    const db = createTestDb();
    db.exec(`
      INSERT INTO symbols (id, file_id, full_source) VALUES 
        (1, 1, 'Value is 50%'),
        (2, 1, 'Value is 50 percent'),
        (3, 1, 'Value is 50x')
    `);

    // Without escaping (vulnerable)
    const stmt = db.prepare("SELECT * FROM symbols WHERE full_source LIKE ?");
    const results = stmt.all("%50%%"); // No ESCAPE clause

    // Vulnerable: returns 3 rows instead of 1
    assert(results.length === 3); // Demonstrates vulnerability!
  });
});
```

---

## Fix Implementation Reference

The correct fix pattern (as implemented in `files.ts`):

```typescript
// Line 81 in src/db/queries/files.ts
const escaped = term.replace(/[\\%_]/g, "\\$&");
return searchByPath
  .all(`%${escaped}%`, limit)
  .map(mapRow)
  .filter(Boolean) as FileRecord[];
```

SQL query must include `ESCAPE '\'` clause:
```sql
SELECT * FROM files WHERE path LIKE ? ESCAPE '\'
```

### Required Fix for content-fallback.ts

```typescript
// Line 24-25 in src/capsule/content-fallback.ts
// BEFORE (vulnerable):
const pattern = `%${term}%`;

// AFTER (secure):
const escaped = term.replace(/[\\%_]/g, "\\$&");
const pattern = `%${escaped}%`;

// SQL statement must also add ESCAPE clause:
const stmt = db.prepare(
  "SELECT ... WHERE LOWER(s.full_source) LIKE ? ESCAPE '\\' LIMIT 50"
);
```

---

## Compliance Checklist

- [ ] **VAL-SEC-003a**: Unit tests prove `%` is escaped correctly
- [ ] **VAL-SEC-003b**: Unit tests prove `_` is escaped correctly  
- [ ] **VAL-SEC-003c**: Unit tests prove `\` is escaped correctly
- [ ] **VAL-SEC-003d**: Unit tests prove combined patterns work
- [ ] SQL queries include `ESCAPE '\'` clause
- [ ] Integration tests verify SQL behavior matches expectations
- [ ] Security impact tests prove over-broad matching is prevented
