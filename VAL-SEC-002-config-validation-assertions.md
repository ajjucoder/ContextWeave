# VAL-SEC-002: Config Validation Assertions
## Finding #2: Unsafe Spread Fix - Detailed Test Assertions

**Vulnerability Summary:**
- `...raw` spread in `loadConfig()` allows arbitrary keys to overwrite ProjectConfig
- No bounds validation on numeric fields (confidenceDecay, tokenBudget, stalenessDepth, gcThreshold)
- Malicious config.json can inject arbitrary properties or set out-of-bounds values

---

## VAL-SEC-002a: Arbitrary Key Rejection

### Description
When parsing config.json, the loader MUST reject or ignore properties not defined in the ProjectConfig interface. The `...raw` spread operation must NOT allow arbitrary keys to pollute the returned config object.

### Test Cases

#### Test 2a.1: Unknown Key Rejection
**Input:**
```json
{
  "version": 1,
  "tokenBudget": 4000,
  "maliciousKey": "injected_value",
  "__proto__": { "polluted": true },
  "constructor": { "prototype": "polluted" }
}
```

**Expected Behavior:**
- Config loads without error (graceful handling)
- `maliciousKey` is absent from returned config object
- `__proto__` and `constructor` are absent (prototype pollution blocked)
- All valid ProjectConfig fields retain their values

**Pass Criteria:**
```typescript
const config = loadConfig(projectRoot);
assert(!('maliciousKey' in config));
assert(!('__proto__' in config));
assert(!('constructor' in config));
assert(config.tokenBudget === 4000);
```

#### Test 2a.2: Extra Field Type Safety
**Input:**
```json
{
  "version": 1,
  "extraField1": 123,
  "extraField2": { "nested": "value" },
  "extraField3": ["array", "value"]
}
```

**Expected Behavior:**
- All extra fields are stripped from final config
- Return type strictly matches ProjectConfig interface
- TypeScript compilation catches no extra fields

**Pass Criteria:**
```typescript
const config = loadConfig(projectRoot);
const keys = Object.keys(config);
const allowedKeys = [
  'version', 'ignore', 'tokenBudget', 'defaultMode',
  'stalenessDepth', 'confidenceDecay', 'gcThreshold',
  'embeddingModel', 'primaryDirs', 'archiveDirs'
];
assert(keys.every(k => allowedKeys.includes(k)));
```

### Evidence Requirements
- [ ] Test config with 5+ arbitrary keys - all rejected
- [ ] Test prototype pollution attempts (`__proto__`, `constructor`)
- [ ] Verify returned config Object.keys() length matches expected
- [ ] TypeScript type check passes with no extra properties

---

## VAL-SEC-002b: tokenBudget Bounds (100-50000)

### Description
The `tokenBudget` field MUST be validated to be within the safe operational range of 100 to 50,000 tokens. Values outside this range MUST be clamped to bounds or rejected.

### Valid Bounds
- **Minimum:** 100 tokens (prevents empty/useless capsules)
- **Maximum:** 50,000 tokens (prevents memory exhaustion; ~200KB output)
- **Default:** 4000 tokens

### Test Cases

#### Test 2b.1: Minimum Boundary (100)
**Input:** `tokenBudget: 100`
**Expected:** Config accepted, value = 100

#### Test 2b.2: Below Minimum (< 100)
**Input:** `tokenBudget: 50`
**Expected:** Value clamped to 100 OR config rejected with warning

#### Test 2b.3: Maximum Boundary (50000)
**Input:** `tokenBudget: 50000`
**Expected:** Config accepted, value = 50000

#### Test 2b.4: Above Maximum (> 50000)
**Input:** `tokenBudget: 100000`
**Expected:** Value clamped to 50000 OR config rejected with warning

#### Test 2b.5: Negative Value
**Input:** `tokenBudget: -1000`
**Expected:** Value clamped to 100 OR config rejected with warning

#### Test 2b.6: Zero Value
**Input:** `tokenBudget: 0`
**Expected:** Value clamped to 100 OR config rejected with warning

#### Test 2b.7: Float Value
**Input:** `tokenBudget: 4000.7`
**Expected:** Value rounded to 4001 OR truncated to 4000

#### Test 2b.8: Non-numeric String
**Input:** `tokenBudget: "not_a_number"`
**Expected:** Defaults to 4000

#### Test 2b.9: Null/Undefined
**Input:** `tokenBudget: null`
**Expected:** Defaults to 4000

### Pass Criteria
```typescript
// Valid values
assert(loadConfigWith({ tokenBudget: 100 }).tokenBudget === 100);
assert(loadConfigWith({ tokenBudget: 50000 }).tokenBudget === 50000);
assert(loadConfigWith({ tokenBudget: 4000 }).tokenBudget === 4000);

// Invalid values clamped or defaulted
const cfgLow = loadConfigWith({ tokenBudget: 50 });
assert(cfgLow.tokenBudget >= 100 && cfgLow.tokenBudget <= 50000);

const cfgHigh = loadConfigWith({ tokenBudget: 100000 });
assert(cfgHigh.tokenBudget >= 100 && cfgHigh.tokenBudget <= 50000);

const cfgNeg = loadConfigWith({ tokenBudget: -1000 });
assert(cfgNeg.tokenBudget >= 100);

const cfgNull = loadConfigWith({ tokenBudget: null });
assert(cfgNull.tokenBudget === 4000);
```

### Evidence Requirements
- [ ] Test exact boundary values (100, 50000)
- [ ] Test one-below and one-above boundaries (99, 101, 49999, 50001)
- [ ] Test extreme values (0, -1000, 1000000, Number.MAX_SAFE_INTEGER)
- [ ] Test non-numeric inputs (string, null, undefined, object, array)
- [ ] Verify stderr warning emitted for out-of-bounds values

---

## VAL-SEC-002c: confidenceDecay Bounds (0-1)

### Description
The `confidenceDecay` field represents a probability/rate value and MUST be bounded between 0 and 1 (inclusive). This prevents invalid probability values and calculation errors in confidence scoring.

### Valid Bounds
- **Minimum:** 0.0 (no decay)
- **Maximum:** 1.0 (complete decay)
- **Default:** 0.1
- **Precision:** 2 decimal places recommended

### Test Cases

#### Test 2c.1: Zero Boundary
**Input:** `confidenceDecay: 0`
**Expected:** Config accepted, value = 0

#### Test 2c.2: One Boundary
**Input:** `confidenceDecay: 1`
**Expected:** Config accepted, value = 1

#### Test 2c.3: Valid Middle Value
**Input:** `confidenceDecay: 0.5`
**Expected:** Config accepted, value = 0.5

#### Test 2c.4: Negative Value
**Input:** `confidenceDecay: -0.5`
**Expected:** Value clamped to 0 OR config rejected with warning

#### Test 2c.5: Above One
**Input:** `confidenceDecay: 1.5`
**Expected:** Value clamped to 1 OR config rejected with warning

#### Test 2c.6: Large Positive
**Input:** `confidenceDecay: 100`
**Expected:** Value clamped to 1 OR config rejected with warning

#### Test 2c.7: Default Preservation
**Input:** `{}` (no confidenceDecay field)
**Expected:** Value defaults to 0.1

### Pass Criteria
```typescript
// Valid values
assert(loadConfigWith({ confidenceDecay: 0 }).confidenceDecay === 0);
assert(loadConfigWith({ confidenceDecay: 1 }).confidenceDecay === 1);
assert(loadConfigWith({ confidenceDecay: 0.5 }).confidenceDecay === 0.5);
assert(loadConfigWith({ confidenceDecay: 0.05 }).confidenceDecay === 0.05);

// Invalid values clamped
const cfgNeg = loadConfigWith({ confidenceDecay: -0.5 });
assert(cfgNeg.confidenceDecay >= 0 && cfgNeg.confidenceDecay <= 1);

const cfgHigh = loadConfigWith({ confidenceDecay: 2 });
assert(cfgHigh.confidenceDecay >= 0 && cfgHigh.confidenceDecay <= 1);

// Default
const cfgDefault = loadConfigWith({});
assert(cfgDefault.confidenceDecay === 0.1);
```

### Evidence Requirements
- [ ] Test boundary values (0, 1)
- [ ] Test negative values (-0.1, -1, -100)
- [ ] Test values above 1 (1.1, 2, 100)
- [ ] Test typical valid values (0.05, 0.1, 0.25, 0.5, 0.9)
- [ ] Verify precision handling (0.33333 rounds appropriately)

---

## VAL-SEC-002d: stalenessDepth Bounds (0-10)

### Description
The `stalenessDepth` field controls how many historical observations to check for staleness. Values MUST be bounded 0-10 to prevent excessive database queries and memory usage.

### Valid Bounds
- **Minimum:** 0 (disable staleness checking)
- **Maximum:** 10 (check up to 10 recent observations)
- **Default:** 2
- **Type:** Integer only

### Test Cases

#### Test 2d.1: Zero Boundary
**Input:** `stalenessDepth: 0`
**Expected:** Config accepted, value = 0

#### Test 2d.2: Maximum Boundary
**Input:** `stalenessDepth: 10`
**Expected:** Config accepted, value = 10

#### Test 2d.3: Negative Value
**Input:** `stalenessDepth: -1`
**Expected:** Value clamped to 0 OR config rejected with warning

#### Test 2d.4: Above Maximum
**Input:** `stalenessDepth: 100`
**Expected:** Value clamped to 10 OR config rejected with warning

#### Test 2d.5: Float Value
**Input:** `stalenessDepth: 2.5`
**Expected:** Value truncated to 2 OR rounded to 3, OR config rejected

#### Test 2d.6: Default Preservation
**Input:** `{}` (no stalenessDepth field)
**Expected:** Value defaults to 2

### Pass Criteria
```typescript
// Valid values
assert(loadConfigWith({ stalenessDepth: 0 }).stalenessDepth === 0);
assert(loadConfigWith({ stalenessDepth: 10 }).stalenessDepth === 10);
assert(loadConfigWith({ stalenessDepth: 5 }).stalenessDepth === 5);

// Invalid values clamped
const cfgNeg = loadConfigWith({ stalenessDepth: -5 });
assert(cfgNeg.stalenessDepth >= 0 && cfgNeg.stalenessDepth <= 10);

const cfgHigh = loadConfigWith({ stalenessDepth: 50 });
assert(cfgHigh.stalenessDepth >= 0 && cfgHigh.stalenessDepth <= 10);

// Default
const cfgDefault = loadConfigWith({});
assert(cfgDefault.stalenessDepth === 2);
```

### Evidence Requirements
- [ ] Test boundary values (0, 10)
- [ ] Test negative values (-1, -5)
- [ ] Test values above 10 (11, 20, 100)
- [ ] Test float handling (2.5, 5.9)
- [ ] Verify only integers accepted or properly converted

---

## VAL-SEC-002e: gcThreshold Bounds (0-1)

### Description
The `gcThreshold` field represents the garbage collection threshold as a proportion/rate and MUST be bounded between 0 and 1 (inclusive). This controls when stale observations are garbage collected.

### Valid Bounds
- **Minimum:** 0.0 (never GC)
- **Maximum:** 1.0 (always GC)
- **Default:** 0.1
- **Precision:** 2 decimal places recommended

### Test Cases

#### Test 2e.1: Zero Boundary
**Input:** `gcThreshold: 0`
**Expected:** Config accepted, value = 0

#### Test 2e.2: One Boundary
**Input:** `gcThreshold: 1`
**Expected:** Config accepted, value = 1

#### Test 2e.3: Valid Middle Value
**Input:** `gcThreshold: 0.5`
**Expected:** Config accepted, value = 0.5

#### Test 2e.4: Negative Value
**Input:** `gcThreshold: -0.1`
**Expected:** Value clamped to 0 OR config rejected with warning

#### Test 2e.5: Above One
**Input:** `gcThreshold: 1.1`
**Expected:** Value clamped to 1 OR config rejected with warning

#### Test 2e.6: Default Preservation
**Input:** `{}` (no gcThreshold field)
**Expected:** Value defaults to 0.1

### Pass Criteria
```typescript
// Valid values
assert(loadConfigWith({ gcThreshold: 0 }).gcThreshold === 0);
assert(loadConfigWith({ gcThreshold: 1 }).gcThreshold === 1);
assert(loadConfigWith({ gcThreshold: 0.5 }).gcThreshold === 0.5);
assert(loadConfigWith({ gcThreshold: 0.15 }).gcThreshold === 0.15);

// Invalid values clamped
const cfgNeg = loadConfigWith({ gcThreshold: -0.5 });
assert(cfgNeg.gcThreshold >= 0 && cfgNeg.gcThreshold <= 1);

const cfgHigh = loadConfigWith({ gcThreshold: 5 });
assert(cfgHigh.gcThreshold >= 0 && cfgHigh.gcThreshold <= 1);

// Default
const cfgDefault = loadConfigWith({});
assert(cfgDefault.gcThreshold === 0.1);
```

### Evidence Requirements
- [ ] Test boundary values (0, 1)
- [ ] Test negative values (-0.5, -1)
- [ ] Test values above 1 (1.5, 2, 10)
- [ ] Test typical valid values (0.05, 0.1, 0.25, 0.5, 0.9, 0.95)
- [ ] Verify precision handling

---

## Integration Test: Malicious Config Sanitization

### Test: Combined Malicious Config
**Input:**
```json
{
  "version": 1,
  "tokenBudget": 999999,
  "confidenceDecay": -0.5,
  "stalenessDepth": 100,
  "gcThreshold": 2.0,
  "maliciousField1": "injected",
  "maliciousField2": { "attack": "payload" },
  "__proto__": { "hacked": true }
}
```

**Expected Output:**
```typescript
{
  version: 1,
  ignore: [...],           // Default patterns
  tokenBudget: 50000,      // Clamped to max
  defaultMode: "feature",  // Default
  stalenessDepth: 10,      // Clamped to max
  confidenceDecay: 0,      // Clamped to min
  gcThreshold: 1,          // Clamped to max
  primaryDirs: [],         // Default
  archiveDirs: []          // Default
}
```

**Validation:**
- No `maliciousField1`, `maliciousField2`, or `__proto__` present
- All numeric fields within bounds
- Warning messages emitted for each sanitized value

---

## Summary Evidence Matrix

| Assertion | Pass Criteria | Evidence |
|-----------|---------------|----------|
| VAL-SEC-002a | Unknown keys rejected, prototype pollution blocked | Unknown key test, `__proto__` test, Object.keys() count |
| VAL-SEC-002b | tokenBudget in [100, 50000] | Boundary tests, clamp verification, type coercion |
| VAL-SEC-002c | confidenceDecay in [0, 1] | Boundary tests, negative clamp, >1 clamp |
| VAL-SEC-002d | stalenessDepth in [0, 10] | Integer validation, range clamping |
| VAL-SEC-002e | gcThreshold in [0, 1] | Boundary tests, range clamping |

---

## Implementation Notes

### Recommended Fix Pattern
```typescript
function sanitizeNumber(value: unknown, min: number, max: number, defaultValue: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(min, Math.min(max, value));
}

function sanitizeInteger(value: unknown, min: number, max: number, defaultValue: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function loadConfig(projectRoot: string): ProjectConfig {
  // ... existing code ...
  
  return {
    version: sanitizeInteger(raw.version, 1, 1, 1),
    ignore: sanitizePatterns(raw.ignore ?? DEFAULTS.ignore),
    tokenBudget: sanitizeInteger(raw.tokenBudget, 100, 50000, 4000),
    defaultMode: sanitizeMode(raw.defaultMode) ?? DEFAULTS.defaultMode,
    stalenessDepth: sanitizeInteger(raw.stalenessDepth, 0, 10, 2),
    confidenceDecay: sanitizeNumber(raw.confidenceDecay, 0, 1, 0.1),
    gcThreshold: sanitizeNumber(raw.gcThreshold, 0, 1, 0.1),
    embeddingModel: sanitizeOptionalString(raw.embeddingModel),
    primaryDirs: sanitizePatterns(raw.primaryDirs),
    archiveDirs: sanitizePatterns(raw.archiveDirs),
  };
}
```

### Warning Message Format
```typescript
if (raw.tokenBudget !== undefined && (raw.tokenBudget < 100 || raw.tokenBudget > 50000)) {
  process.stderr.write(
    `[contextweave] Warning: tokenBudget ${raw.tokenBudget} out of bounds [100, 50000], ` +
    `clamped to ${sanitizedValue}\n`
  );
}
```
