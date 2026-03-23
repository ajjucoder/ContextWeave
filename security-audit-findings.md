# ContextWeave Security Audit Report

**Date:** 2026-03-21  
**Auditor:** Security Audit Subagent  
**Scope:** Full codebase audit of /Users/aejjusingh/Developer/ContextWeave/src/

---

## Executive Summary

The ContextWeave codebase demonstrates **strong security practices** overall. Most critical areas are properly protected:
- **Path traversal** is effectively mitigated via `isPathWithinRoot()` and `isSafeProjectPath()` checks
- **SQL injection** is prevented through consistent use of parameterized queries with better-sqlite3
- **Command injection** in ripgrep is properly controlled via argument array (not shell string)

The primary areas of concern are **low-severity** issues related to:
1. Unvalidated glob patterns that could cause ReDoS
2. Unbounded file reads in certain edge cases
3. Missing Zod input size limits on some string fields

---

## Findings Table

| Severity | File | Line | Issue | Recommendation |
|----------|------|------|-------|----------------|
| Low | `src/mcp/tools/search.ts` | 120 | `globToRegExp()` accepts user patterns without complexity limits - potential ReDoS if malicious glob like `**/**/*{a,b}` is provided | Add glob pattern complexity validation (max depth, brace count) before regex conversion |
| Low | `src/mcp/tools/path-filters.ts` | 54 | `expandBracePatterns()` recursively expands braces without depth limit - could cause stack overflow with deeply nested braces like `{a,{b,{c,{d,e}}}}` | Add max recursion depth limit (e.g., 10 levels) to prevent stack exhaustion |
| Low | `src/mcp/tools/read.ts` | 12 | `MAX_READ_BYTES = 2MB` is a good limit, but no per-line length validation could still allow processing of very long lines | Add max line length validation (e.g., 10KB per line) before split operation |
| Low | `src/mcp/tools/overview.ts` | 131 | `max_tokens` has upper bound of 8000 but no validation on `query` parameter length before processing | Add `max(500)` or similar constraint on `query` length in Zod schema to prevent excessive tokenization |
| Low | `src/mcp/tools/remember.ts` | 20 | `note` field allows up to 10000 chars but no validation of content structure (could store encoded data) | Add content-type validation or suspicious pattern detection for stored observations |
| Low | `src/mcp/tools/ripgrep.ts` | 56 | `maxBuffer: 10MB` for ripgrep output could allow memory exhaustion if many large matches found | Consider making maxBuffer configurable or using streaming parsing for large result sets |
| Low | `src/mcp/server.ts` | 42 | `getServerDb()` caches DB instance globally without validation that `projectRoot` hasn't changed between calls | Add projectRoot validation to ensure cached DB matches requested project |
| Info | `src/db/queries/files.ts` | 52 | LIKE patterns use `ESCAPE '\'` but no validation that user input doesn't contain escape sequences | Document that path searches with `%` or `_` must be escaped, or add explicit escaping for special chars |
| Info | `src/mcp/tools/register-helper.ts` | 5 | `RegisterToolFn` uses `any[]` for args which bypasses TypeScript type safety | Consider using stricter typing for tool registration to catch parameter mismatches at compile time |
| Info | `src/core/parser.ts` | 1042 | `DOCUMENT_SOURCE_LIMIT = 6000` truncates documents but stores truncated indicator - could leak info about document size | Ensure truncation indicator doesn't expose sensitive metadata about truncated content |

---

## Detailed Analysis by Category

### 1. Path Traversal ✓ SECURE

**Files reviewed:**
- `src/mcp/tools/read.ts`
- `src/core/indexer.ts` (watcher.ts)
- `src/mcp/tools/reindex.ts`

**Findings:**
- ✅ `isSafeProjectPath()` properly validates paths with `isPathWithinRoot()`
- ✅ Symlink resolution checks (`realpathSync`) followed by re-validation
- ✅ All file operations validate resolved paths against project root
- ✅ `resolveFilePath()` properly handles path resolution through database lookup

**No critical or high severity issues found.**

---

### 2. SQL Injection ✓ SECURE

**Files reviewed:**
- `src/db/queries/files.ts`
- `src/db/queries/symbols.ts`
- `src/db/queries/edges.ts`
- `src/db/queries/chunks.ts`
- `src/db/queries/sessions.ts`
- `src/db/queries/observations.ts`
- `src/db/queries/capsule-log.ts`

**Findings:**
- ✅ All queries use better-sqlite3 parameterized statements with `@param` syntax
- ✅ No string concatenation or template literals used for SQL
- ✅ Proper use of prepared statements throughout

**No SQL injection vulnerabilities found.**

---

### 3. Command Injection ✓ SECURE

**Files reviewed:**
- `src/mcp/tools/ripgrep.ts`
- `src/core/parser.ts`

**Findings:**
- ✅ `execFileAsync()` uses argument array (not shell string) for `rg` command
- ✅ Pattern passed as separate argument, not shell-escaped
- ✅ User input (`pattern`) is not directly executed
- ✅ `maxBuffer` limits prevent runaway output

**No command injection vulnerabilities found.**

---

### 4. Input Validation (Zod Schemas) ✓ MOSTLY SECURE

**Files reviewed:**
- All MCP tool registration files

**Findings:**
- ✅ Most tools use proper Zod validation with `.min()`, `.max()`, `.int()` constraints
- ✅ `capsule.ts`: token_budget limited to 100-100000
- ✅ `read.ts`: max_lines limited to 1-500
- ✅ `search.ts`: max_results limited to 1-200
- ⚠️ Some string fields lack upper bounds or have very high limits (10000 chars)

**Recommendation:** Add stricter bounds on string inputs that could affect processing time.

---

### 5. Safe Reads ✓ SECURE

**Files reviewed:**
- `src/mcp/tools/read.ts`
- `src/db/queries/files.ts`

**Findings:**
- ✅ `MAX_READ_BYTES = 2 * 1024 * 1024` (2MB) hard limit on file reads
- ✅ `max_lines` capped at 500 lines
- ✅ Proper bounds checking on `start_line`/`end_line` ranges
- ✅ File existence and file-type validation before read

**No unsafe read vulnerabilities found.**

---

### 6. Secrets ✓ SECURE

**Files reviewed:**
- All source files
- Configuration files

**Findings:**
- ✅ No hardcoded API keys found
- ✅ No hardcoded credentials found
- ✅ No hardcoded tokens found
- ✅ `embeddingModel` config is user-provided, not hardcoded

**No secrets exposure found.**

---

### 7. DoS Vectors ⚠️ MINOR CONCERNS

**Files reviewed:**
- `src/capsule/generator.ts`
- `src/mcp/tools/search.ts`
- `src/mcp/tools/path-filters.ts`

**Findings:**
| Severity | Issue | Details |
|----------|-------|---------|
| Low | Unbounded recursion in brace expansion | `expandBracePatterns()` at `path-filters.ts:54` has no depth limit |
| Low | Glob pattern complexity | `globToRegExp()` at `search.ts:120` can create expensive regexes |
| Low | Large file processing | `read.ts` reads up to 2MB which could be slow on many parallel requests |

**Recommendations:**
1. Add recursion depth limit to `expandBracePatterns()`
2. Add complexity scoring for glob patterns before regex conversion
3. Consider rate limiting for expensive operations

---

### 8. MCP Security ✓ SECURE

**Files reviewed:**
- `src/mcp/server.ts`
- `src/mcp/session-lock.ts`
- `src/mcp/tools/register-helper.ts`

**Findings:**
- ✅ Session isolation via `randomUUID()`
- ✅ File-based locking with PID validation prevents stale locks
- ✅ Primary/secondary mode separation for concurrent access
- ✅ Proper cleanup on shutdown (SIGINT, SIGTERM, uncaughtException)

**No MCP security issues found.**

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 6 |
| Info | 3 |
| **Total** | **9** |

---

## Recommendations

### Immediate (Low Priority)
1. Add recursion depth limit to `expandBracePatterns()` in `path-filters.ts`
2. Add glob pattern complexity validation in `search.ts`
3. Add per-line length validation in `read.ts`

### Nice to Have (Info Priority)
1. Document LIKE escape requirements in `files.ts`
2. Add stricter typing to `register-helper.ts`
3. Review document truncation indicator for info leakage

---

**Overall Security Rating: GOOD**

The ContextWeave codebase follows security best practices for the most critical vulnerabilities (path traversal, SQL injection, command injection). The identified issues are low-severity edge cases that would require specific malicious input patterns to exploit.
