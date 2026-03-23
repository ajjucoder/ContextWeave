# VAL-SEC-001: SQL Injection Fix Validation Assertions

## Vulnerability Summary
- **Location**: `src/core/clusters.ts`, line 66
- **Issue**: Direct string interpolation of `kinds` array values into SQL IN clause and `threshold` into HAVING clause
- **Risk**: Unsanitized user input can modify query semantics, causing data leakage or unauthorized data manipulation

---

## 1. Behavioral Assertions

### Assertion ID: VAL-SEC-001-A
**Title**: Parameterized Query Usage Detection

**Behavioral Description**:
The fix must replace string interpolation with parameterized queries or prepared statement placeholders. The code must use SQLite's parameter binding (`?` placeholders) instead of direct string concatenation.

**Pass/Fail Condition**:
- **PASS**: Code uses `db.prepare()` with `?` placeholders and `.all(params)` or `.run(params)` with bound parameters
- **FAIL**: Any remaining string interpolation (`${...}`) inside SQL templates for `kind` values or `threshold`

**Evidence Requirements**:
1. Source code showing parameterized IN clause (e.g., `e.kind IN (${placeholders})` where placeholders are generated from array length)
2. Source code showing parameterized threshold in HAVING (e.g., `HAVING edge_count >= ?`)
3. No dynamic SQL string concatenation involving user-controlled values

---

### Assertion ID: VAL-SEC-001-B
**Title**: Malicious Kind Value Neutralization

**Behavioral Description**:
When malicious strings containing SQL metacharacters are passed as `kind` values, they must be treated as literal strings rather than SQL syntax.

**Test Inputs**:
1. `kind = "import' OR '1'='1"` (SQL injection via string break)
2. `kind = "'; DROP TABLE edges; --"` (command injection)
3. `kind = "' UNION SELECT * FROM files --"` (union injection)
4. `kind = "import\\''"` (backslash-escaped quote)
5. `kind = "test%"` (wildcard abuse attempt)

**Expected Outcome**:
- Query executes without syntax errors
- No unintended rows returned (SQL injection fails)
- Edge count returns 0 for non-existent "kind" values containing malicious payloads
- Database structure remains intact (no DROP/ALTER occurs)

**Pass/Fail Condition**:
- **PASS**: All malicious inputs are treated as literal kind strings; query returns empty results or only matches exact (non-existent) kind names
- **FAIL**: Query returns unexpected rows, throws SQL syntax errors, or modifies database structure

**Evidence Requirements**:
1. Test logs showing query execution without errors for each malicious input
2. Database integrity verification (schema unchanged, no data loss)
3. Result set validation (returned rows match expected edge kinds only)

---

### Assertion ID: VAL-SEC-001-C
**Title**: Threshold Value Safety

**Behavioral Description**:
The `threshold` value must be treated as a numeric parameter, not string-interpolated into the SQL query.

**Test Inputs**:
1. `threshold = 1` (normal low value)
2. `threshold = 999999` (very large value)
3. `threshold = 0` (edge case minimum)
4. `threshold = -1` (negative injection attempt)
5. `threshold = "1 OR 1=1"` (string injection attempt, if type coercion possible)

**Expected Outcome**:
- Numeric threshold values are bound as SQL INTEGER parameters
- String injection attempts either throw type errors or are coerced safely to 0
- Very large values don't cause buffer overflows or SQL parsing errors

**Pass/Fail Condition**:
- **PASS**: All threshold inputs are parameterized; queries execute safely with expected edge_count filtering
- **FAIL**: Threshold value appears in SQL string without parameter binding; injection attempts modify query logic

**Evidence Requirements**:
1. Parameter binding logs or query execution traces
2. Type validation showing numeric coercion/rejection of string inputs
3. Result verification showing correct HAVING behavior

---

## 2. Edge Case Assertions

### Assertion ID: VAL-SEC-001-D
**Title**: Empty Kinds Array Handling

**Behavioral Description**:
When `kinds` array is empty, the query must handle the edge case safely without generating invalid SQL (e.g., `IN ()`).

**Test Input**:
- `kinds = []` (empty array)

**Expected Outcome**:
- One of: (a) query returns no rows, (b) query is skipped entirely, or (c) IN clause handles empty set gracefully
- No SQL syntax error (like `IN ()`)

**Pass/Fail Condition**:
- **PASS**: Empty array handled gracefully without SQL errors
- **FAIL**: SQL syntax error: `near ")": syntax error` or similar

**Evidence Requirements**:
1. Test case demonstrating empty array behavior
2. Error logs showing no SQL exceptions

---

### Assertion ID: VAL-SEC-001-E
**Title**: Special Character Kind Names

**Behavioral Description**:
Kind names containing special characters must be handled as literal values.

**Test Inputs**:
1. `kind = "kind-with-dashes"` (hyphens)
2. `kind = "kind.with.dots"` (dots)
3. `kind = "kind with spaces"` (spaces)
4. `kind = "kind\"with\"quotes"` (quotes)
5. `kind = "kind\nwith\nnewlines"` (newlines)
6. `kind = "日本語"` (Unicode)
7. `kind = "kind\x00null"` (null bytes, if possible)

**Expected Outcome**:
- All special characters treated as part of literal kind name
- No SQL parsing errors
- Proper Unicode handling without corruption

**Pass/Fail Condition**:
- **PASS**: All special character inputs execute without errors; characters preserved as literals
- **FAIL**: SQL syntax errors, truncated strings, or character corruption

**Evidence Requirements**:
1. Test execution logs for each special character type
2. Verification of Unicode preservation
3. Database query results confirming literal matching

---

### Assertion ID: VAL-SEC-001-F
**Title**: Large Kinds Array Performance

**Behavioral Description**:
When `kinds` array contains many elements (100+), the parameterized query must handle them efficiently.

**Test Input**:
- `kinds = Array.from({length: 500}, (_, i) => \`kind_\${i}\`)` (500 distinct kind values)

**Expected Outcome**:
- Query generates appropriate number of placeholders (`?`)
- No parameter limit errors (SQLite supports 999+ parameters by default)
- Execution completes in reasonable time (< 1s)

**Pass/Fail Condition**:
- **PASS**: Query handles large arrays without errors or timeouts
- **FAIL**: "too many SQL variables" error, stack overflow, or timeout

**Evidence Requirements**:
1. Performance timing logs
2. Query execution success for maximum parameter count
3. Memory usage validation

---

## 3. Implementation Verification Checklist

### Code Structure Requirements

- [ ] `kindList` generation uses parameterized placeholders, not string interpolation
- [ ] `threshold` is passed as a bound parameter
- [ ] SQL template uses `?` placeholders exclusively for dynamic values
- [ ] Array iteration generates correct number of placeholders matching array length

### Query Pattern (Expected Fixed Code)
```typescript
// PASS: Parameterized approach
const placeholders = kinds.map(() => '?').join(', ');
const params = [...kinds, threshold];
const rows = db.prepare(`
  SELECT
    MIN(sf.file_id, tf.file_id) as file_a,
    MAX(sf.file_id, tf.file_id) as file_b,
    COUNT(*) as edge_count
  FROM edges e
  JOIN symbols sf ON sf.id = e.source_symbol_id
  JOIN symbols tf ON tf.id = e.target_symbol_id
  WHERE sf.file_id != tf.file_id
    AND e.kind IN (${placeholders})
  GROUP BY file_a, file_b
  HAVING edge_count >= ?
`).all(params) as FileEdgeRow[];
```

### Vulnerable Pattern (Must Not Exist)
```typescript
// FAIL: String interpolation (original vulnerability)
const kindList = kinds.map(k => `'${k}'`).join(', ');
// ... SQL uses: e.kind IN (${kindList}) and HAVING edge_count >= ${threshold}
```

---

## 4. Test Implementation Reference

### Unit Test Skeleton
```typescript
describe('VAL-SEC-001: SQL Injection Prevention', () => {
  const maliciousInputs = [
    { kinds: ["import' OR '1'='1"], threshold: 1 },
    { kinds: ["'; DROP TABLE edges; --"], threshold: 1 },
    { kinds: ["import"], threshold: -1 },
    { kinds: [], threshold: 1 },
    { kinds: ["kind'\"--"], threshold: 999999 },
  ];

  test.each(maliciousInputs)('neutralizes injection: %o', ({ kinds, threshold }) => {
    // Should not throw SQL syntax error
    // Should not modify database structure
    // Should return expected (empty) results
  });
});
```

### Integration Test Requirements
1. Create isolated test database with sample edges data
2. Execute computeClusters() with malicious inputs
3. Verify schema integrity post-execution
4. Verify result correctness for legitimate edge kinds

---

## 5. Sign-off Criteria

This validation is **COMPLETE** when:
1. All assertions (A through F) have documented pass/fail results
2. No string interpolation remains in SQL construction
3. Parameterized queries are used for all dynamic values
4. Edge cases (empty arrays, special chars, large arrays) are handled
5. Security test suite passes with all malicious inputs
