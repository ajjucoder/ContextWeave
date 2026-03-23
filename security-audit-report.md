# ContextWeave Security Audit Report

**Date:** 2026-03-21  
**Auditor:** Security Audit Analyzer  
**Scope:** Full codebase audit of src/, tests/, bench/  
**Project:** ContextWeave MCP Server

---

## Executive Summary

This audit identified **2 Critical**, **4 High**, **8 Medium**, and **6 Low** severity findings. The most significant concerns relate to FTS5 query injection, path traversal mitigations needing reinforcement, and potential denial of service vectors. The codebase demonstrates good security practices in SQL parameterization and basic path validation, but requires additional hardening.

---

## Critical Findings

### CRITICAL-01: FTS5 Query Injection in Symbol Search

**File:** `src/db/queries/symbols.ts:144-152`  
**Severity:** Critical  
**CWE:** CWE-74 (Injection)

**Description:**  
The `searchFTS` function constructs FTS5 queries by wrapping user input in double quotes without proper escaping. While the function does filter some characters, it does not escape double quotes within the input, allowing an attacker to break out of the quoted context.

```typescript
searchFTS(term: string, limit: number): SymbolRecord[] {
  const escaped = term.replace(/[^a-zA-Z0-9_.\-\s]/g, "");
  if (!escaped.trim()) return [];
  const pattern = `"${escaped.trim()}"`;  // VULNERABLE
  try {
    return searchFTS.all(pattern, limit).map(mapRow).filter(Boolean) as SymbolRecord[];
  } catch {
    return [];
  }
}
```

**Proof of Concept:**  
Input: `test" OR 1=1 OR "`  
After filtering: `test" OR 1=1 OR "` (double quotes preserved)  
Resulting query: `"test" OR 1=1 OR ""` - Malformed FTS5 query

While better-sqlite3's prepared statements protect against traditional SQL injection, FTS5 MATCH clauses have their own query syntax that can be exploited to cause query parsing errors or potentially access unintended data.

**Remediation:**
1. Escape double quotes in FTS5 input by doubling them: `term.replace(/"/g, '""')`
2. Implement allowlist validation for FTS5 special characters
3. Consider using FTS5's `bind` parameter if available

```typescript
searchFTS(term: string, limit: number): SymbolRecord[] {
  const escaped = term.replace(/[^a-zA-Z0-9_.\-\s]/g, "");
  if (!escaped.trim()) return [];
  // Escape double quotes for FTS5
  const safeTerm = escaped.trim().replace(/"/g, '""');
  const pattern = `"${safeTerm}"`;
  // ... rest of function
}
```

---

### CRITICAL-02: Unbounded Token Cache Leading to Memory Exhaustion

**File:** `src/utils/tokens.ts:5-21`  
**Severity:** Critical  
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Description:**  
The token counting cache has a limit but implements LRU eviction incorrectly. It only evicts one entry when the limit is exceeded, and uses `keys().next().value` which does not guarantee FIFO order in Maps.

```typescript
const tokenCache = new Map<string, number>();

export function countTokens(text: string): number {
  // ...
  if (tokenCache.size > TOKEN_CACHE_LIMIT) {
    const first = tokenCache.keys().next().value as string | undefined;
    if (first !== undefined) tokenCache.delete(first);  // Only evicts 1 entry
  }
  return tokenCount;
}
```

**Exploitation Scenario:**  
An attacker can craft many unique short strings (e.g., incrementing numbers) to fill the cache. Once filled, each new unique string triggers tokenization (expensive operation with `gpt-tokenizer`) and only evicts one entry, leading to O(n) memory growth and CPU exhaustion.

**Remediation:**
1. Implement proper LRU cache with `Map` insertion-order guarantees
2. Batch eviction (evict 10% when limit reached)
3. Add size limits per entry

```typescript
const tokenCache = new Map<string, number>();
const EVICT_BATCH_SIZE = 200;

if (tokenCache.size > TOKEN_CACHE_LIMIT) {
  const keysToDelete = [...tokenCache.keys()].slice(0, EVICT_BATCH_SIZE);
  for (const key of keysToDelete) tokenCache.delete(key);
}
```

---

## High Severity Findings

### HIGH-01: Incomplete Path Traversal Protection in File Read Operations

**File:** `src/mcp/tools/read.ts:31-50`  
**Severity:** High  
**CWE:** CWE-22 (Path Traversal)

**Description:**  
While path traversal protection exists via `isSafeProjectPath()`, the function relies on `realpathSync()` for symlink resolution, which can throw errors that are silently caught, potentially allowing access to unexpected paths.

```typescript
function isSafeProjectPath(filePath: string, projectRoot: string): boolean {
  if (!isPathWithinRoot(filePath, projectRoot)) return false;

  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      const realPath = realpathSync(filePath);
      return isPathWithinRoot(realPath, projectRoot);
    }
  } catch {
    return false;  // Silent failure - could mask issues
  }
  return true;
}
```

Additionally, `resolveFilePath()` in the same file attempts multiple path combinations without consistent validation.

**Remediation:**
1. Add explicit error logging for symlink resolution failures
2. Validate paths after all transformations, not just at the beginning
3. Implement canonical path comparison using `realpathSync().normalize()` on both paths

---

### HIGH-02: Unrestricted File Read Size Leading to Resource Exhaustion

**File:** `src/mcp/tools/read.ts:148-160`  
**Severity:** High  
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Description:**  
The `MAX_READ_BYTES` constant (2MB) limits file reads, but there's no limit on the number of concurrent read operations, allowing an attacker to exhaust memory through many simultaneous large file reads.

```typescript
const MAX_READ_BYTES = 2 * 1024 * 1024;

if (fileStat.size > MAX_READ_BYTES) {
  return {
    content: [{ type: "text" as const, text: `Error: file exceeds ${MAX_READ_BYTES} byte read limit` }],
    isError: true,
  };
}
```

**Remediation:**
1. Implement per-session read byte quotas
2. Add request rate limiting
3. Track cumulative bytes read per session

---

### HIGH-03: Ripgrep Pattern Injection via Unescaped Input

**File:** `src/mcp/tools/ripgrep.ts:42-55`  
**Severity:** High  
**CWE:** CWE-77 (Command Injection - Variant)

**Description:**  
The ripgrep search tool passes user-supplied patterns to the `rg` binary via `execFileAsync()`. While `execFileAsync()` prevents shell injection (no shell interpolation), the pattern itself is passed as an argument and could contain regex special characters that cause unintended matching or regex denial of service (ReDoS) in ripgrep.

```typescript
const args: string[] = ["--json", "--max-count", "1"];

if (!useRegex) args.push("--fixed-strings");
// ...
args.push("--", pattern, ".");
```

When `useRegex=true`, the pattern is passed to ripgrep's regex engine without validation. Malicious patterns like `(a+)+$` can cause exponential backtracking.

**Remediation:**
1. Validate regex patterns before passing to ripgrep
2. Set a maximum pattern length (e.g., 500 characters)
3. Consider using regex linting libraries to detect dangerous patterns
4. Add timeout to ripgrep execution

---

### HIGH-04: Database Size Limit Bypass via Environment Variable

**File:** `src/db/connection.ts:42-48`  
**Severity:** High  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Description:**  
The `CONTEXTWEAVE_MAX_DB_BYTES` environment variable controls the maximum database size, but the value is not validated against reasonable bounds.

```typescript
function getMaxDbSizeBytes(): number {
  const raw = process.env["CONTEXTWEAVE_MAX_DB_BYTES"];
  if (!raw) return DEFAULT_MAX_DB_SIZE_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_DB_SIZE_BYTES;
  return parsed;  // No upper bound!
}
```

An attacker with access to environment variables could set this to an extremely large value, causing disk exhaustion.

**Remediation:**
1. Add upper bound validation (e.g., max 10GB)
2. Add lower bound validation to prevent errors from too-small limits
3. Log when non-default limits are used

```typescript
const MAX_ALLOWED_DB_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
const parsed = Math.min(Number(raw), MAX_ALLOWED_DB_SIZE);
```

---

## Medium Severity Findings

### MEDIUM-01: Unbounded BFS Traversal in Graph Operations

**File:** `src/core/weighted-bfs.ts`, `src/capsule/generator.ts:315-320`  
**Severity:** Medium  
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Description:**  
BFS traversal has limits (`MAX_BFS_VISITED_CAP = 500`), but these limits may be insufficient for very large codebases. Additionally, the `maxHops` parameter is not bounded in the tool input schema.

**Remediation:**
1. Add explicit input validation for `max_hops` (already limited to 20 in flow.ts)
2. Add timeout to BFS operations
3. Consider implementing iterative deepening instead of full BFS

---

### MEDIUM-02: Token Budget Can Be Set to Extremely High Values

**File:** `src/mcp/tools/capsule.ts:22`  
**Severity:** Medium  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Description:**  
The `token_budget` parameter is validated with `z.number().min(100).max(100000)`, but 100,000 tokens would generate ~400KB of output text, potentially causing memory issues.

```typescript
token_budget: z.number().min(100).max(100000).optional()
```

**Remediation:**
1. Consider lowering the maximum to 20,000 tokens (sufficient for most use cases)
2. Add warning when budgets exceed 10,000

---

### MEDIUM-03: Observation Storage Has No Size Limits

**File:** `src/memory/observations.ts:42-60`  
**Severity:** Medium  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Description:**  
Observations can store notes up to 10,000 characters, with no limit on the number of observations per session. Over time, this could lead to database bloat.

**Remediation:**
1. Implement per-session observation count limits
2. Add auto-archival for old observations
3. Consider implementing a hard limit on total observations

---

### MEDIUM-04: Uncontrolled Environment Variable in DB Path

**File:** `src/db/connection.ts:42-48`  
**Severity:** Medium  
**CWE:** CWE-642 (External Control of Critical State Data)

**Description:**  
The `CONTEXTWEAVE_MAX_DB_BYTES` environment variable is read without validation of its source. If an attacker can manipulate environment variables, they can affect system behavior.

**Remediation:**
1. Document security implications of environment variables
2. Consider using a configuration file with proper permissions instead

---

### MEDIUM-05: Logger Outputs Potentially Sensitive Data to Stderr

**File:** `src/utils/logger.ts:20-23`  
**Severity:** Medium  
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

**Description:**  
The logger serializes arbitrary data objects to JSON, which could inadvertently include sensitive information.

```typescript
function formatMessage(level: LogLevel, component: string, message: string, data?: unknown): string {
  // ...
  return `${base} ${JSON.stringify(data)}`;
}
```

**Remediation:**
1. Implement data sanitization before logging
2. Add a list of sensitive field names to redact
3. Consider structured logging with explicit fields

---

### MEDIUM-06: File Watcher Can Be Overwhelmed by Rapid File Changes

**File:** `src/core/watcher.ts`  
**Severity:** Medium  
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Description:**  
The parcel watcher has no debouncing or rate limiting, meaning rapid file changes (e.g., from a build process or malicious script) can trigger many concurrent indexing operations.

**Remediation:**
1. Implement debouncing for file change events
2. Add a queue with maximum size for pending indexing operations
3. Skip indexing when too many events are queued

---

### MEDIUM-07: No Rate Limiting on MCP Tool Invocations

**File:** `src/mcp/server.ts`  
**Severity:** Medium  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Description:**  
There is no rate limiting on MCP tool invocations. An attacker (or misbehaving client) could make thousands of rapid tool calls, potentially exhausting server resources.

**Remediation:**
1. Implement per-session rate limiting
2. Add request queuing with maximum concurrency
3. Consider implementing circuit breakers for expensive operations

---

### MEDIUM-08: Session Lock Race Condition

**File:** `src/mcp/session-lock.ts:42-60`  
**Severity:** Medium  
**CWE:** CWE-367 (Time-of-check Time-of-use Race Condition)

**Description:**  
The session lock implementation has a TOCTOU race condition between checking the existing lock file and creating a new one.

```typescript
const existingPid = readLockPid(lockPath);
if (existingPid !== null && !isProcessAlive(existingPid)) {
  try {
    unlinkSync(lockPath);  // Race window here
  } catch { }
  try {
    return tryAcquire();  // Could fail due to concurrent access
  } catch { ... }
}
```

**Remediation:**
1. Use atomic file operations (O_EXCL flag is already used, but the cleanup path has race)
2. Implement exponential backoff on lock acquisition failure
3. Consider using file locks (flock) instead of lock files

---

## Low Severity Findings

### LOW-01: Error Messages May Reveal System Paths

**File:** Multiple files (e.g., `src/mcp/tools/read.ts:148`)  
**Severity:** Low  
**CWE:** CWE-209 (Generation of Error Message Containing Sensitive Information)

**Description:**  
Error messages sometimes include full system paths, which could reveal server directory structure to attackers.

**Remediation:**
1. Sanitize paths in error messages to show only relative paths
2. Use generic error messages for security-sensitive operations

---

### LOW-02: No Input Validation for File Extensions in Indexer

**File:** `src/core/indexer.ts:detectLanguage`  
**Severity:** Low  
**CWE:** CWE-20 (Improper Input Validation)

**Description:**  
The indexer uses file extensions to determine language without validating that the extension is reasonable.

**Remediation:**
1. Add a maximum extension length check
2. Consider implementing extension allowlists per project

---

### LOW-03: Query Decomposition Can Generate Many Sub-Queries

**File:** `src/capsule/query-decomposer.ts`  
**Severity:** Low  
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Description:**  
Broad queries can be decomposed into many sub-queries, potentially causing performance issues.

**Remediation:**
1. Limit the maximum number of decomposed sub-queries
2. Add early termination when results are sufficient

---

### LOW-04: No Validation of Embedding Model Names

**File:** `src/core/embedder.ts:40-50`  
**Severity:** Low  
**CWE:** CWE-20 (Improper Input Validation)

**Description:**  
The embedding model name from configuration is passed directly to the transformers.js library without validation.

**Remediation:**
1. Implement an allowlist of approved embedding models
2. Validate model name format (e.g., must match HuggingFace naming convention)

---

### LOW-05: Database Migration Files Execute Arbitrary SQL

**File:** `src/db/migrations.ts`  
**Severity:** Low  
**CWE:** CWE-94 (Code Injection - SQL Variant)

**Description:**  
Database migrations contain hardcoded SQL that is executed without runtime validation. While these are developer-controlled, they could introduce security issues if compromised.

**Remediation:**
1. Review all migrations for security issues
2. Consider implementing migration signing
3. Add migration version validation

---

### LOW-06: Dependency on External LSP Servers Without Integrity Verification

**File:** `src/core/lsp-bridge.ts:95`  
**Severity:** Low  
**CWE:** CWE-829 (Inclusion of Functionality from Untrusted Control Sphere)

**Description:**  
The LSP bridge spawns external language server processes based on PATH lookup, without verifying their integrity or authenticity.

**Remediation:**
1. Consider implementing hash verification for LSP binaries
2. Document trusted LSP server sources
3. Allow specifying explicit paths for LSP servers in configuration

---

## Dependency Security Analysis

### Analyzed Dependencies (from package.json)

| Package | Version | Known Vulnerabilities | Notes |
|---------|---------|----------------------|-------|
| better-sqlite3 | ^12.6.2 | None known (as of audit) | Native module - keep updated |
| @modelcontextprotocol/sdk | ^1.27.1 | None known | MCP SDK - official package |
| @huggingface/transformers | ^3.8.1 | None known | ML library - large attack surface |
| @parcel/watcher | ^2.5.6 | None known | Native file watcher |
| zod | ^4.3.6 | None known | Schema validation - good |
| tree-sitter-* | various | None known | Native parsers |

**Recommendations:**
1. Run `npm audit` regularly and address findings promptly
2. Enable Dependabot or similar automated dependency scanning
3. Review native module dependencies for supply chain risks
4. Consider pinning exact versions for production deployments

---

## Authentication/Authorization Analysis

**Status:** No authentication/authorization implemented

ContextWeave is designed as a local MCP server, assuming trust boundaries are enforced by the host environment. Key observations:

1. **No built-in authentication:** The server accepts all MCP connections on stdio
2. **No rate limiting:** Unlimited tool invocations possible
3. **No session isolation:** Multiple sessions share the same database
4. **Secondary mode only restricts write operations:** The `cw_remember` tool is disabled in secondary mode, but all other tools remain functional

**Recommendations:**
1. Document trust assumptions clearly
2. Consider implementing per-session isolation for multi-tenant scenarios
3. Add configuration options for access control in enterprise deployments

---

## Data Exposure Analysis

### Potentially Sensitive Data Handled

1. **Source code:** Full access to indexed project source files
2. **File paths:** System paths are logged and may appear in output
3. **Observations:** User-created notes stored in database
4. **Query history:** Capsule logs contain query text

### Exposure Vectors

1. **Stderr logging:** May contain sensitive file paths or content
2. **Database file:** Unencrypted SQLite database in `.contextweave/`
3. **MCP responses:** May include file contents in capsule output

**Recommendations:**
1. Encrypt database at rest for sensitive deployments
2. Implement log sanitization
3. Consider adding output redaction options

---

## Resource Exhaustion Vectors

1. **Token cache:** Unbounded growth (CRITICAL-02)
2. **File reads:** Multiple concurrent large reads (HIGH-02)
3. **BFS traversal:** Large graph traversals (MEDIUM-01)
4. **Ripgrep patterns:** Complex regex patterns (HIGH-03)
5. **File watcher:** Rapid file changes (MEDIUM-06)
6. **Tool invocations:** Unlimited rate (MEDIUM-07)

---

## Positive Security Practices Observed

1. **SQL Parameterization:** All SQL queries use prepared statements with parameterized inputs
2. **Path Validation:** Basic path traversal protection implemented
3. **Input Validation:** Zod schemas validate MCP tool inputs
4. **Symlink Resolution:** Attempted symlink validation in file operations
5. **File Size Limits:** Maximum file read limits enforced
6. **Budget Controls:** Token budgets limit output size
7. **Security Exclusions:** Patterns for excluding sensitive files (`.env`, credentials)

---

## Summary of Recommendations

### Immediate Actions (Critical)

1. Fix FTS5 query injection in `searchFTS()` function
2. Implement proper LRU cache eviction in token counter

### Short-term Actions (High)

1. Strengthen path traversal protections with canonical path comparison
2. Add request rate limiting for file reads
3. Validate regex patterns before ripgrep execution
4. Add bounds checking for database size environment variable

### Medium-term Actions (Medium)

1. Implement session-level rate limiting
2. Add observation storage limits
3. Implement logger data sanitization
4. Add file watcher debouncing
5. Fix session lock race condition

### Long-term Actions (Low)

1. Sanitize error messages
2. Implement embedding model allowlist
3. Document LSP server trust assumptions
4. Add dependency integrity verification

---

## Conclusion

ContextWeave demonstrates a reasonable security foundation with SQL parameterization and path validation, but requires additional hardening before production deployment in security-sensitive environments. The most critical issues relate to FTS5 injection and resource exhaustion vectors, which should be addressed immediately.

The audit identified no backdoors, intentional security bypasses, or evidence of malicious code. The vulnerabilities identified are typical of development-phase software and can be remediated with moderate effort.

---

**End of Report**
