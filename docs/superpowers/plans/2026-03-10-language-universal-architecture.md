# Language-Universal Architecture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ContextWeave's AST graph, flow tracing, impact analysis, capsule generation, and recall work flawlessly across all 12 supported languages — not just JS/TS.

**Architecture:** Six additive layers on top of the existing pipeline: (1) qualified names + parent tracking for disambiguation, (2) decorator/annotation extraction for framework detection, (3) per-language module resolvers for import graph completeness, (4) language-agnostic framework plugins for cross-boundary edges, (5) lightweight type inference for method call resolution, (6) semantic recall + tool improvements. No existing modules are replaced — changes are in the data collection layer (parser, resolvers, plugins) and data model (new columns, new types).

**Tech Stack:** TypeScript ESM, tree-sitter 0.21/0.23, better-sqlite3, vitest, existing MCP SDK stdio transport.

**Dependency graph:**
```
Layer 1 (Qualified Names) ──→ Layer 2 (Type Inference)
Layer 3 (Decorators)      ──→ Layer 4 (Framework Plugins 2.0)
Layer 5 (Module Resolvers)    [independent]
Layer 6 (Recall/Flow/Overview) [independent]
```

Layers 1, 3, 5, 6 can be parallelized. Layer 2 requires Layer 1. Layer 4 requires Layer 3.

---

## File Structure

### New Files
| Path | Responsibility |
|------|---------------|
| `src/core/resolvers/index.ts` | `ModuleResolver` interface + registry |
| `src/core/resolvers/python.ts` | Python import resolution (`from pkg.mod import X`) |
| `src/core/resolvers/go.ts` | Go import resolution (`import "pkg"` via go.mod) |
| `src/core/resolvers/rust.ts` | Rust module resolution (`use crate::mod::Type`) |
| `src/core/resolvers/java.ts` | Java package resolution (`import com.example.X`) |
| `src/core/resolvers/csharp.ts` | C# namespace resolution (`using Namespace.Class`) |
| `src/core/resolvers/cpp.ts` | C/C++ include resolution (`#include "header.h"`) |
| `src/core/resolvers/ruby.ts` | Ruby require resolution (`require_relative './x'`) |
| `src/core/resolvers/php.ts` | PHP PSR-4 resolution (`use App\Models\User`) |
| `src/core/type-inference.ts` | Lightweight type annotation extraction + propagation |
| `src/frameworks/plugins/fastapi.ts` | FastAPI route decorator synthesis |
| `src/frameworks/plugins/django.ts` | Django URL conf + view synthesis |
| `src/frameworks/plugins/flask.ts` | Flask route decorator synthesis |
| `src/frameworks/plugins/spring.ts` | Spring Boot annotation synthesis |
| `src/frameworks/plugins/aspnet.ts` | ASP.NET attribute routing synthesis |
| `src/frameworks/plugins/rails.ts` | Rails routes + controller synthesis |
| `src/frameworks/plugins/laravel.ts` | Laravel route + controller synthesis |
| `src/frameworks/plugins/gin.ts` | Gin/Echo route config synthesis |
| `src/frameworks/plugins/axum.ts` | Axum/Actix route attribute synthesis |
| `src/frameworks/plugins/grpc.ts` | gRPC proto → server impl synthesis |
| `src/frameworks/plugins/celery.ts` | Celery/Sidekiq task dispatch synthesis |
| `tests/core/qualified-names.test.ts` | Tests for parent tracking + qualified names |
| `tests/core/decorator-extraction.test.ts` | Tests for decorator parsing across languages |
| `tests/core/module-resolvers.test.ts` | Tests for import resolution per language |
| `tests/core/type-inference.test.ts` | Tests for type annotation extraction |
| `tests/frameworks/plugin-*.test.ts` | Tests per framework plugin |
| `tests/integration/cross-language-flow.test.ts` | Integration tests for flow across languages |
| `bench/scenarios/polyglot-fullstack/` | Multi-language fixture (Python+Go+TS+Rust) |

### Modified Files
| Path | Change |
|------|--------|
| `src/db/schema.ts` | Add `parent_symbol_id`, `qualified_name`, `decorators` columns to `symbols` |
| `src/db/migrations.ts` | Migration v19: new columns + indexes |
| `src/db/queries/symbols.ts` | Update insert/query to include new columns |
| `src/core/types.ts` | Add `ParsedDecorator`, extend `ParsedSymbol`, extend `LanguageQuerySet`, extend `FrameworkTracePlugin` |
| `src/core/parser.ts` | Parent tracking in `parseSymbols`, decorator extraction, qualified name construction |
| `src/core/queries/index.ts` | Add `decoratorQueries` to `LanguageQuerySet` interface |
| `src/core/queries/typescript.ts` | Add decorator query |
| `src/core/queries/python.ts` | Add decorator query |
| `src/core/queries/java.ts` | Add annotation query |
| `src/core/queries/rust.ts` | Add attribute query |
| `src/core/queries/csharp.ts` | Add attribute query |
| `src/core/queries/php.ts` | Add attribute query |
| `src/core/queries/go.ts` | No decorator query (Go has no decorators), but add struct tag extraction |
| `src/core/queries/ruby.ts` | No standard decorator, but add DSL method detection |
| `src/core/indexer.ts` | Wire module resolvers, store parent_symbol_id + qualified_name, use qualified names in edge resolution |
| `src/core/event-edge-synthesis.ts` | Add language-specific cross-boundary patterns (Go channels, Rust channels, etc.) |
| `src/core/weighted-bfs.ts` | Accept qualified names, minor edge-cost tuning |
| `src/mcp/tools/flow.ts` | Accept qualified names, edge-kind scoring, cross-file boundary bonus |
| `src/mcp/tools/impact.ts` | Accept qualified names, use parent tracking for method disambiguation |
| `src/mcp/tools/overview.ts` | Show entry points by PageRank, module boundary summary |
| `src/capsule/generator.ts` | Use qualified names in pivot resolution, prefer qualified matches |
| `src/memory/search.ts` | Hybrid BM25 + embedding search, auto-populate from capsule insights |
| `src/frameworks/registry.ts` | Register all new plugins |
| `src/frameworks/types.ts` | Extend `FrameworkTracePlugin` with decorator-based matching |

---

## Chunk 1: Foundation — Qualified Names + Parent Tracking

This is the highest-impact change. It eliminates 60-70% of false edges caused by name collisions across all languages. Every method `save`, `validate`, `handle`, `process` becomes `AuthService.save`, `InputValidator.validate`, `RequestHandler.handle`, `DataProcessor.process`.

### Task 1: Schema Migration v19

**Files:**
- Modify: `src/db/migrations.ts`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Write the migration**

In `src/db/migrations.ts`, add migration version 19 to the `migrations` array:

```typescript
{
  version: 19,
  up(db: Database.Database) {
    db.exec(`
      ALTER TABLE symbols ADD COLUMN parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL;
      ALTER TABLE symbols ADD COLUMN qualified_name TEXT;
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_parent ON symbols(parent_symbol_id)`);
  },
},
```

- [ ] **Step 2: Update the base schema**

In `src/db/schema.ts`, add both columns to the `CREATE TABLE symbols` statement (after `doc_comment`):

```sql
parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
qualified_name   TEXT,
```

And add the two indexes after the existing symbol indexes.

- [ ] **Step 3: Run tests to verify migration applies cleanly**

Run: `npx vitest run tests/db/ -v`
Expected: All DB tests pass (migration applies on fresh and existing DBs)

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations.ts src/db/schema.ts
git commit -m "feat(db): add parent_symbol_id and qualified_name to symbols (migration v19)"
```

---

### Task 2: Extend Core Types

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add `ParsedDecorator` interface**

```typescript
export interface ParsedDecorator {
  name: string;
  fullText: string;
  args?: string[];
}
```

- [ ] **Step 2: Extend `ParsedSymbol`**

Add to the existing `ParsedSymbol` interface:

```typescript
export interface ParsedSymbol {
  // ... existing fields ...
  parentName?: string;
  decorators?: ParsedDecorator[];
}
```

- [ ] **Step 3: Extend `SymbolRecord`**

Add to `SymbolRecord`:

```typescript
export interface SymbolRecord {
  // ... existing fields ...
  parentSymbolId: number | null;
  qualifiedName: string | null;
}
```

Also update `LightSymbolRecord` to include `qualifiedName: string | null`.

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Type errors in files that construct SymbolRecord without new fields (will fix in subsequent tasks)

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): add ParsedDecorator, parentName, qualifiedName to symbol types"
```

---

### Task 3: Update Symbol DB Queries

**Files:**
- Modify: `src/db/queries/symbols.ts`

- [ ] **Step 1: Update INSERT statement**

In the `symbolQueriesImpl` function, update the prepared insert statement to include `parent_symbol_id` and `qualified_name`:

```sql
INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, doc_comment, centrality, last_seen, parent_symbol_id, qualified_name)
VALUES (@fileId, @name, @kind, @startLine, @endLine, @signature, @bodyHash, @fullSource, @isExported, @docComment, @centrality, @lastSeen, @parentSymbolId, @qualifiedName)
```

- [ ] **Step 2: Update mapRow and mapRowLight**

Add to `mapRow`:
```typescript
parentSymbolId: row.parent_symbol_id as number | null,
qualifiedName: row.qualified_name as string | null,
```

Add `qualifiedName` to `mapRowLight` as well.

- [ ] **Step 3: Add `getByQualifiedName` query**

```typescript
getByQualifiedName(qualifiedName: string): SymbolRecord | undefined {
  return mapRow(stmtByQualifiedName.get({ qualifiedName }) as Record<string, unknown> | undefined);
},
```

With prepared statement:
```sql
SELECT * FROM symbols WHERE qualified_name = @qualifiedName LIMIT 1
```

- [ ] **Step 4: Add `getByParent` query**

```typescript
getByParent(parentId: number): SymbolRecord[] {
  return (stmtByParent.all({ parentId }) as Record<string, unknown>[]).map(mapRow);
},
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/db/ -v`
Expected: Existing tests may need minor updates to include new fields in assertions

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/symbols.ts
git commit -m "feat(db): update symbol queries for parent_symbol_id and qualified_name"
```

---

### Task 4: Parser — Parent Tracking in parseSymbols

**Files:**
- Modify: `src/core/parser.ts`
- Create: `tests/core/qualified-names.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/qualified-names.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

let db: Database.Database;
let root: string;

afterEach(() => {
  db?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("qualified names", () => {
  it("assigns parent and qualified name for TypeScript class methods", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    root = mkdtempSync(join(tmpdir(), "cw-qn-ts-"));
    writeFileSync(join(root, "service.ts"), `
export class AuthService {
  login(email: string, password: string) {
    return this.validate(email);
  }

  validate(email: string) {
    return email.includes("@");
  }
}
`);
    await indexProject(db, root);
    const syms = symbolQueries(db);
    const authService = syms.getByName("AuthService")[0];
    const login = syms.getByName("login")[0];
    const validate = syms.getByName("validate")[0];

    expect(authService).toBeDefined();
    expect(authService.qualifiedName).toBe("AuthService");
    expect(authService.parentSymbolId).toBeNull();

    expect(login).toBeDefined();
    expect(login.qualifiedName).toBe("AuthService.login");
    expect(login.parentSymbolId).toBe(authService.id);

    expect(validate).toBeDefined();
    expect(validate.qualifiedName).toBe("AuthService.validate");
    expect(validate.parentSymbolId).toBe(authService.id);
  });

  it("assigns parent for Python class methods", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    root = mkdtempSync(join(tmpdir(), "cw-qn-py-"));
    writeFileSync(join(root, "service.py"), `
class UserService:
    def create_user(self, name: str) -> dict:
        return {"name": name}

    def delete_user(self, user_id: int) -> bool:
        return True
`);
    await indexProject(db, root);
    const syms = symbolQueries(db);
    const cls = syms.getByName("UserService")[0];
    const create = syms.getByName("create_user")[0];

    expect(cls.qualifiedName).toBe("UserService");
    expect(create.qualifiedName).toBe("UserService.create_user");
    expect(create.parentSymbolId).toBe(cls.id);
  });

  it("assigns parent for Go struct methods", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    root = mkdtempSync(join(tmpdir(), "cw-qn-go-"));
    writeFileSync(join(root, "handler.go"), `
package main

type Handler struct{}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("ok"))
}

func NewHandler() *Handler {
    return &Handler{}
}
`);
    await indexProject(db, root);
    const syms = symbolQueries(db);
    const handler = syms.getByName("Handler")[0];
    const serve = syms.getByName("ServeHTTP")[0];
    const newH = syms.getByName("NewHandler")[0];

    expect(serve.qualifiedName).toBe("Handler.ServeHTTP");
    expect(serve.parentSymbolId).toBe(handler.id);
    expect(newH.qualifiedName).toBe("NewHandler");
    expect(newH.parentSymbolId).toBeNull();
  });

  it("assigns parent for Rust impl methods", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    root = mkdtempSync(join(tmpdir(), "cw-qn-rs-"));
    writeFileSync(join(root, "lib.rs"), `
pub struct Server {
    port: u16,
}

impl Server {
    pub fn new(port: u16) -> Self {
        Server { port }
    }

    pub fn start(&self) {
        println!("Starting on {}", self.port);
    }
}
`);
    await indexProject(db, root);
    const syms = symbolQueries(db);
    const server = syms.getByName("Server")[0];
    const newFn = syms.getByName("new")[0];
    const start = syms.getByName("start")[0];

    expect(newFn.qualifiedName).toBe("Server.new");
    expect(newFn.parentSymbolId).toBe(server.id);
    expect(start.qualifiedName).toBe("Server.start");
  });

  it("assigns parent for Java class methods", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    root = mkdtempSync(join(tmpdir(), "cw-qn-java-"));
    writeFileSync(join(root, "UserRepo.java"), `
public class UserRepository {
    public User findById(long id) {
        return null;
    }

    public void save(User user) {
    }
}
`);
    await indexProject(db, root);
    const syms = symbolQueries(db);
    const repo = syms.getByName("UserRepository")[0];
    const find = syms.getByName("findById")[0];
    const save = syms.getByName("save")[0];

    expect(find.qualifiedName).toBe("UserRepository.findById");
    expect(find.parentSymbolId).toBe(repo.id);
    expect(save.qualifiedName).toBe("UserRepository.save");
  });

  it("assigns parent for C# class methods", async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    root = mkdtempSync(join(tmpdir(), "cw-qn-cs-"));
    writeFileSync(join(root, "Controller.cs"), `
public class UsersController : ControllerBase {
    public IActionResult GetAll() {
        return Ok();
    }

    public IActionResult Create(UserDto dto) {
        return Created();
    }
}
`);
    await indexProject(db, root);
    const syms = symbolQueries(db);
    const ctrl = syms.getByName("UsersController")[0];
    const getAll = syms.getByName("GetAll")[0];

    expect(getAll.qualifiedName).toBe("UsersController.GetAll");
    expect(getAll.parentSymbolId).toBe(ctrl.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/qualified-names.test.ts -v`
Expected: FAIL — `qualifiedName` is null/undefined, `parentSymbolId` is null/undefined

- [ ] **Step 3: Implement parent tracking in parser.ts**

In `parseSymbols`, after collecting all symbols, run a post-pass to assign `parentName`:

```typescript
function assignParentNames(symbols: ParsedSymbol[]): void {
  const containers = symbols.filter(
    (s) => s.kind === "class" || s.kind === "interface" || s.kind === "enum"
  );

  for (const sym of symbols) {
    if (sym.kind === "method" || sym.kind === "function" || sym.kind === "arrow") {
      const parent = containers.find(
        (c) =>
          c.startLine <= sym.startLine &&
          c.endLine >= sym.endLine &&
          c.name !== sym.name
      );
      if (parent) {
        sym.parentName = parent.name;
      }
    }
  }
}
```

Call `assignParentNames(symbols)` at the end of `parseSymbols`, before `return symbols`.

For **Go** (receiver methods), add special handling in the Go query for `method_definition`. Go methods have a receiver: `func (h *Handler) ServeHTTP(...)`. The tree-sitter query for Go `functionDeclarations` already captures these. Add a post-pass that detects Go receiver syntax:

```typescript
function assignGoReceiverParents(symbols: ParsedSymbol[], content: string): void {
  const structs = symbols.filter((s) => s.kind === "class");
  for (const sym of symbols) {
    if (sym.kind !== "function") continue;
    const sig = sym.signature;
    const receiverMatch = sig.match(/^func\s*\(\s*\w+\s+\*?(\w+)\s*\)/);
    if (receiverMatch) {
      const receiverType = receiverMatch[1];
      const parent = structs.find((s) => s.name === receiverType);
      if (parent) sym.parentName = parent.name;
    }
  }
}
```

For **Rust** (impl blocks), add:

```typescript
function assignRustImplParents(symbols: ParsedSymbol[], tree: Parser.Tree): void {
  const implBlocks: Array<{ typeName: string; startLine: number; endLine: number }> = [];
  const cursor = tree.rootNode.walk();
  let reachedRoot = false;
  while (!reachedRoot) {
    if (cursor.nodeType === "impl_item") {
      const node = cursor.currentNode;
      const typeNode = node.childForFieldName("type");
      if (typeNode) {
        implBlocks.push({
          typeName: typeNode.text.split("<")[0].trim(),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (cursor.gotoParent()) {
      if (cursor.gotoNextSibling()) break;
      if (!cursor.currentNode.parent) { reachedRoot = true; break; }
    }
  }
  for (const sym of symbols) {
    if (sym.kind === "function" || sym.kind === "method") {
      const impl = implBlocks.find(
        (b) => b.startLine <= sym.startLine && b.endLine >= sym.endLine
      );
      if (impl) sym.parentName = impl.typeName;
    }
  }
}
```

- [ ] **Step 4: Implement qualified name construction + storage in indexer**

In `src/core/indexer.ts`, after symbols are inserted into the DB, run a second pass to:
1. For each symbol with `parentName`, look up the parent symbol ID in the same file
2. Build `qualifiedName = parentName ? parentName + "." + name : name`
3. UPDATE the symbol row with `parent_symbol_id` and `qualified_name`

```typescript
function assignQualifiedNames(
  db: Database.Database,
  fileId: number,
  parsedSymbols: ParsedSymbol[],
  insertedIds: number[]
): void {
  const syms = symbolQueries(db);
  const update = db.prepare(
    "UPDATE symbols SET parent_symbol_id = ?, qualified_name = ? WHERE id = ?"
  );
  const fileSymbols = syms.getByFileId(fileId);

  for (let i = 0; i < parsedSymbols.length; i++) {
    const parsed = parsedSymbols[i];
    const symId = insertedIds[i];
    let parentId: number | null = null;
    let qualifiedName = parsed.name;

    if (parsed.parentName) {
      const parent = fileSymbols.find(
        (s) => s.name === parsed.parentName &&
          (s.kind === "class" || s.kind === "interface" || s.kind === "enum")
      );
      if (parent) {
        parentId = parent.id;
        qualifiedName = `${parsed.parentName}.${parsed.name}`;
      }
    }

    update.run(parentId, qualifiedName, symId);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/core/qualified-names.test.ts -v`
Expected: All 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/core/parser.ts src/core/indexer.ts tests/core/qualified-names.test.ts
git commit -m "feat(parser): parent tracking and qualified name construction for all languages"
```

---

### Task 5: Edge Resolution — Prefer Qualified Matches

**Files:**
- Modify: `src/core/indexer.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/core/qualified-names.test.ts`:

```typescript
it("resolves method calls to correct class when qualified name available", async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  root = mkdtempSync(join(tmpdir(), "cw-qn-resolve-"));
  writeFileSync(join(root, "auth.ts"), `
export class AuthService {
  validate(token: string) { return true; }
}
`);
  writeFileSync(join(root, "input.ts"), `
export class InputValidator {
  validate(input: string) { return input.length > 0; }
}
`);
  writeFileSync(join(root, "handler.ts"), `
import { AuthService } from "./auth";

export class Handler {
  private auth = new AuthService();
  handle() {
    this.auth.validate("token");
  }
}
`);
  await indexProject(db, root);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);

  const handleSym = syms.getByName("handle")[0];
  const authValidate = syms.getByName("validate").find(
    (s) => s.qualifiedName === "AuthService.validate"
  );
  const inputValidate = syms.getByName("validate").find(
    (s) => s.qualifiedName === "InputValidator.validate"
  );

  const outgoing = edges.getBySource(handleSym.id);
  const validateEdges = outgoing.filter(
    (e) => e.targetSymbolId === authValidate!.id || e.targetSymbolId === inputValidate!.id
  );

  // Should prefer AuthService.validate because AuthService is imported
  expect(validateEdges.some((e) => e.targetSymbolId === authValidate!.id)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/qualified-names.test.ts -t "resolves method calls" -v`
Expected: FAIL (currently resolves to both or wrong one)

- [ ] **Step 3: Update edge resolution in indexer**

In the call edge creation loop in `indexer.ts`, update `pickTargets` (or its underlying `narrowToSameOwnerLocalTargets`) to:

1. If the call has a receiver (detected from the AST or from the callee having a `.` — e.g., `auth.validate` → receiver `auth`, method `validate`), look up imports to find the type of `auth`
2. Prefer symbols whose `qualified_name` starts with the resolved type name
3. Fall back to current name-only resolution if no qualified match found

The key function to modify is the call resolution section (~lines 833-850):

```typescript
function resolveCallWithQualification(
  call: ParsedCall,
  fileImports: ParsedImport[],
  fileSymbols: SymbolRecord[],
  allSymbolsByName: (name: string) => SymbolRecord[]
): number[] {
  const candidates = allSymbolsByName(call.calleeName);
  if (candidates.length <= 1) return candidates.map((c) => c.id);

  // Check if any imported type matches a parent of a candidate
  const importedNames = new Set(fileImports.flatMap((i) => i.names));
  const localClassNames = new Set(
    fileSymbols
      .filter((s) => s.kind === "class" || s.kind === "interface")
      .map((s) => s.name)
  );

  const qualified = candidates.filter((c) => {
    if (!c.qualifiedName?.includes(".")) return false;
    const parent = c.qualifiedName.split(".")[0];
    return importedNames.has(parent) || localClassNames.has(parent);
  });

  return qualified.length > 0
    ? qualified.map((c) => c.id)
    : candidates.map((c) => c.id);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/core/qualified-names.test.ts -v`
Expected: All tests pass

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All 931+ tests pass

- [ ] **Step 6: Commit**

```bash
git add src/core/indexer.ts tests/core/qualified-names.test.ts
git commit -m "feat(indexer): qualified name edge resolution for method call disambiguation"
```

---

### Task 6: Update MCP Tools to Accept Qualified Names

**Files:**
- Modify: `src/mcp/tools/flow.ts`
- Modify: `src/mcp/tools/impact.ts`
- Modify: `src/capsule/generator.ts`

- [ ] **Step 1: Update flow.ts symbol resolution**

In `buildFlowResult`, update `resolveExactSymbolMatches` to first try `qualified_name` exact match before falling back to `name` match:

```typescript
function resolveExactSymbolMatches(db: Database.Database, query: string): SymbolRecord[] {
  const syms = symbolQueries(db);
  // Try qualified name first (e.g., "AuthService.validate")
  const byQualified = syms.getByQualifiedName(query);
  if (byQualified) return [byQualified];
  // Fall back to name match
  return syms.getByName(query);
}
```

- [ ] **Step 2: Update impact.ts**

Same pattern — try qualified name first in the target resolution.

- [ ] **Step 3: Update generator.ts pivot resolution**

In the pivot resolution phase, when searching for symbols by query terms, also search `qualified_name`:

```sql
SELECT * FROM symbols WHERE qualified_name LIKE '%' || @term || '%' LIMIT 10
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mcp/ tests/capsule/ tests/integration/ -v`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/flow.ts src/mcp/tools/impact.ts src/capsule/generator.ts
git commit -m "feat(mcp): accept qualified names in flow, impact, and capsule tools"
```

---

## Chunk 2: Decorator/Annotation Extraction

Decorators and annotations are how frameworks in Python, Java, Rust, C#, and PHP declare routes, services, and event handlers. Without extracting them, the framework plugin system is blind to 80% of non-JS/TS frameworks.

### Task 7: Extend LanguageQuerySet

**Files:**
- Modify: `src/core/queries/index.ts`
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add optional `decoratorQueries` to LanguageQuerySet**

In `src/core/queries/index.ts`:

```typescript
export interface LanguageQuerySet {
  // ... existing fields ...
  decoratorQueries?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/queries/index.ts
git commit -m "feat(queries): add decoratorQueries to LanguageQuerySet interface"
```

---

### Task 8: Tree-sitter Decorator Queries Per Language

**Files:**
- Modify: `src/core/queries/typescript.ts`
- Modify: `src/core/queries/python.ts`
- Modify: `src/core/queries/java.ts`
- Modify: `src/core/queries/rust.ts`
- Modify: `src/core/queries/csharp.ts`
- Modify: `src/core/queries/php.ts`
- Create: `tests/core/decorator-extraction.test.ts`

- [ ] **Step 1: Write failing tests for decorator extraction**

Create `tests/core/decorator-extraction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFile } from "../../src/core/parser.js";

describe("decorator extraction", () => {
  it("extracts Python decorators", () => {
    const result = parseFile("test.py", `
from fastapi import FastAPI
app = FastAPI()

@app.get("/users")
def list_users():
    return []

@app.post("/users")
def create_user(user: dict):
    return user
`, "python");

    const listUsers = result.symbols.find((s) => s.name === "list_users");
    expect(listUsers?.decorators).toBeDefined();
    expect(listUsers!.decorators!.length).toBeGreaterThanOrEqual(1);
    expect(listUsers!.decorators![0].name).toBe("app.get");
    expect(listUsers!.decorators![0].args).toContain("/users");
  });

  it("extracts Java annotations", () => {
    const result = parseFile("Controller.java", `
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController {
    @GetMapping("/{id}")
    public User getUser(@PathVariable long id) {
        return null;
    }

    @PostMapping
    public User createUser(@RequestBody UserDto dto) {
        return null;
    }
}
`, "java");

    const cls = result.symbols.find((s) => s.name === "UserController");
    expect(cls?.decorators).toBeDefined();
    expect(cls!.decorators!.some((d) => d.name === "RestController")).toBe(true);
    expect(cls!.decorators!.some((d) => d.name === "RequestMapping")).toBe(true);

    const getUser = result.symbols.find((s) => s.name === "getUser");
    expect(getUser?.decorators?.some((d) => d.name === "GetMapping")).toBe(true);
  });

  it("extracts Rust attributes", () => {
    const result = parseFile("main.rs", `
use actix_web::{get, post, web, HttpResponse};

#[get("/users")]
async fn list_users() -> HttpResponse {
    HttpResponse::Ok().finish()
}

#[post("/users")]
async fn create_user(body: web::Json<User>) -> HttpResponse {
    HttpResponse::Created().finish()
}
`, "rust");

    const listUsers = result.symbols.find((s) => s.name === "list_users");
    expect(listUsers?.decorators).toBeDefined();
    expect(listUsers!.decorators!.some((d) => d.name === "get")).toBe(true);
  });

  it("extracts C# attributes", () => {
    const result = parseFile("Controller.cs", `
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("{id}")]
    public IActionResult Get(int id)
    {
        return Ok();
    }
}
`, "csharp");

    const cls = result.symbols.find((s) => s.name === "UsersController");
    expect(cls?.decorators?.some((d) => d.name === "ApiController")).toBe(true);
    expect(cls?.decorators?.some((d) => d.name === "Route")).toBe(true);

    const get = result.symbols.find((s) => s.name === "Get");
    expect(get?.decorators?.some((d) => d.name === "HttpGet")).toBe(true);
  });

  it("extracts TypeScript decorators", () => {
    const result = parseFile("app.module.ts", `
import { Module, Controller, Get } from "@nestjs/common";

@Controller("users")
export class UsersController {
  @Get()
  findAll() {
    return [];
  }
}
`, "typescript");

    const ctrl = result.symbols.find((s) => s.name === "UsersController");
    expect(ctrl?.decorators?.some((d) => d.name === "Controller")).toBe(true);

    const findAll = result.symbols.find((s) => s.name === "findAll");
    expect(findAll?.decorators?.some((d) => d.name === "Get")).toBe(true);
  });

  it("extracts PHP 8 attributes", () => {
    const result = parseFile("Controller.php", `<?php
use Symfony\\Component\\Routing\\Annotation\\Route;

class UserController
{
    #[Route('/users', methods: ['GET'])]
    public function index(): Response
    {
        return new Response();
    }
}
`, "php");

    const index = result.symbols.find((s) => s.name === "index");
    expect(index?.decorators?.some((d) => d.name === "Route")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/decorator-extraction.test.ts -v`
Expected: All FAIL — decorators field is undefined

- [ ] **Step 3: Add tree-sitter queries**

**Python** (`src/core/queries/python.ts`):
```typescript
export const decoratorQueries = `
(decorated_definition
  (decorator (identifier) @decorator_name) @decorator
  definition: (_) @definition)
(decorated_definition
  (decorator (attribute) @decorator_name) @decorator
  definition: (_) @definition)
`;
```

**Java** (`src/core/queries/java.ts`):
```typescript
export const decoratorQueries = `
(marker_annotation name: (identifier) @decorator_name) @decorator
(annotation name: (identifier) @decorator_name
  arguments: (annotation_argument_list) @decorator_args) @decorator
`;
```

**Rust** (`src/core/queries/rust.ts`):
```typescript
export const decoratorQueries = `
(attribute_item
  (attribute (identifier) @decorator_name)) @decorator
(attribute_item
  (attribute (scoped_identifier) @decorator_name)) @decorator
`;
```

**C#** (`src/core/queries/csharp.ts`):
```typescript
export const decoratorQueries = `
(attribute_list
  (attribute name: (identifier) @decorator_name) @decorator)
(attribute_list
  (attribute name: (qualified_name) @decorator_name) @decorator)
`;
```

**TypeScript** (`src/core/queries/typescript.ts`):
```typescript
export const decoratorQueries = `
(decorator (identifier) @decorator_name) @decorator
(decorator (call_expression function: (identifier) @decorator_name
  arguments: (arguments) @decorator_args)) @decorator
`;
```

**PHP** (`src/core/queries/php.ts`):
```typescript
export const decoratorQueries = `
(attribute_list
  (attribute (name) @decorator_name) @decorator)
`;
```

**Note:** These queries may need adjustment based on exact tree-sitter grammar node types. Run `tree-sitter parse` on sample files to verify node names. If a query fails to compile at runtime, adjust the s-expression to match the actual grammar.

- [ ] **Step 4: Implement `parseDecorators` in parser.ts**

Add a new function:

```typescript
function parseDecorators(
  tree: Parser.Tree,
  language: string,
  content: string,
  symbols: ParsedSymbol[]
): void {
  const queries = getQueries(language);
  if (!queries?.decoratorQueries) return;

  const langModule = languageModules[language];
  if (!langModule) return;
  const lang = langModule();

  let query: Parser.Query;
  try {
    query = new Parser.Query(lang, queries.decoratorQueries);
  } catch {
    return; // Query syntax doesn't match this grammar version
  }

  const matches = query.matches(tree.rootNode);
  for (const match of matches) {
    const decoratorCapture = match.captures.find((c) => c.name === "decorator");
    const nameCapture = match.captures.find((c) => c.name === "decorator_name");
    const argsCapture = match.captures.find((c) => c.name === "decorator_args");
    const defCapture = match.captures.find((c) => c.name === "definition");

    if (!nameCapture) continue;

    const decoratorLine = (decoratorCapture ?? nameCapture).node.startPosition.row + 1;
    const decoratorName = nameCapture.node.text;
    const fullText = decoratorCapture?.node.text ?? nameCapture.node.text;
    const args = argsCapture
      ? extractDecoratorArgs(argsCapture.node.text)
      : extractDecoratorArgsFromFull(fullText);

    // Find the symbol this decorator is attached to
    // Strategy: decorator appears on lines immediately before the symbol
    const targetLine = defCapture
      ? defCapture.node.startPosition.row + 1
      : decoratorLine + 1;

    const targetSymbol = symbols.find(
      (s) => s.startLine >= targetLine - 1 && s.startLine <= targetLine + 2
    );

    if (targetSymbol) {
      if (!targetSymbol.decorators) targetSymbol.decorators = [];
      targetSymbol.decorators.push({ name: decoratorName, fullText, args });
    }
  }
}

function extractDecoratorArgs(argsText: string): string[] {
  // Remove outer parens, split by comma, trim
  const inner = argsText.replace(/^\(/, "").replace(/\)$/, "").trim();
  if (!inner) return [];
  return inner.split(",").map((a) => a.trim().replace(/^["']|["']$/g, ""));
}

function extractDecoratorArgsFromFull(fullText: string): string[] | undefined {
  const match = fullText.match(/\(([^)]*)\)/);
  if (!match) return undefined;
  return extractDecoratorArgs(`(${match[1]})`);
}
```

Call `parseDecorators(tree, language, content, symbols)` at the end of `parseFile`, after `parseSymbols` but before returning.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/core/decorator-extraction.test.ts -v`
Expected: All pass (may need query adjustments per grammar — iterate)

- [ ] **Step 6: Run full suite**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add src/core/parser.ts src/core/queries/*.ts tests/core/decorator-extraction.test.ts
git commit -m "feat(parser): extract decorators/annotations for Python, Java, Rust, C#, TS, PHP"
```

---

## Chunk 3: Per-Language Module Resolvers

Import edges currently point to nothing for non-JS/TS languages. This chunk adds resolution logic so `from auth.service import AuthService` actually connects to the `AuthService` symbol in `auth/service.py`.

### Task 9: ModuleResolver Interface + Registry

**Files:**
- Create: `src/core/resolvers/index.ts`

- [ ] **Step 1: Define the interface and registry**

```typescript
import { resolve, dirname, join, sep } from "node:path";
import { existsSync } from "node:fs";

export interface ModuleResolver {
  language: string;
  resolve(
    importPath: string,
    fromFile: string,
    projectRoot: string
  ): string | null;
}

const resolvers = new Map<string, ModuleResolver>();

export function registerResolver(resolver: ModuleResolver): void {
  resolvers.set(resolver.language, resolver);
}

export function resolveImport(
  language: string,
  importPath: string,
  fromFile: string,
  projectRoot: string
): string | null {
  const resolver = resolvers.get(language);
  if (!resolver) return null;
  return resolver.resolve(importPath, fromFile, projectRoot);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/resolvers/index.ts
git commit -m "feat(resolvers): module resolver interface and registry"
```

---

### Task 10: Python Module Resolver

**Files:**
- Create: `src/core/resolvers/python.ts`
- Create: `tests/core/module-resolvers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveImport, registerResolver } from "../../src/core/resolvers/index.js";
import { pythonResolver } from "../../src/core/resolvers/python.js";

registerResolver(pythonResolver);

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("Python module resolver", () => {
  it("resolves relative import from.module import X", () => {
    root = mkdtempSync(join(tmpdir(), "cw-pyres-"));
    mkdirSync(join(root, "auth"), { recursive: true });
    writeFileSync(join(root, "auth", "__init__.py"), "");
    writeFileSync(join(root, "auth", "service.py"), "class AuthService: pass");
    writeFileSync(join(root, "handler.py"), "from auth.service import AuthService");

    const result = resolveImport(
      "python",
      "auth.service",
      join(root, "handler.py"),
      root
    );
    expect(result).toBe(join(root, "auth", "service.py"));
  });

  it("resolves relative dot import", () => {
    root = mkdtempSync(join(tmpdir(), "cw-pyres2-"));
    mkdirSync(join(root, "pkg"), { recursive: true });
    writeFileSync(join(root, "pkg", "__init__.py"), "");
    writeFileSync(join(root, "pkg", "utils.py"), "def helper(): pass");
    writeFileSync(join(root, "pkg", "main.py"), "from .utils import helper");

    const result = resolveImport(
      "python",
      ".utils",
      join(root, "pkg", "main.py"),
      root
    );
    expect(result).toBe(join(root, "pkg", "utils.py"));
  });

  it("resolves package __init__.py", () => {
    root = mkdtempSync(join(tmpdir(), "cw-pyres3-"));
    mkdirSync(join(root, "auth"), { recursive: true });
    writeFileSync(join(root, "auth", "__init__.py"), "class Auth: pass");

    const result = resolveImport(
      "python",
      "auth",
      join(root, "main.py"),
      root
    );
    expect(result).toBe(join(root, "auth", "__init__.py"));
  });

  it("returns null for external packages", () => {
    root = mkdtempSync(join(tmpdir(), "cw-pyres4-"));
    const result = resolveImport(
      "python",
      "fastapi",
      join(root, "main.py"),
      root
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Implement Python resolver**

```typescript
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { ModuleResolver } from "./index.js";

export const pythonResolver: ModuleResolver = {
  language: "python",
  resolve(importPath, fromFile, projectRoot) {
    // Handle relative imports (.module, ..module)
    const dotMatch = importPath.match(/^(\.+)(.*)/);
    if (dotMatch) {
      const dots = dotMatch[1].length;
      const rest = dotMatch[2];
      let base = dirname(fromFile);
      for (let i = 1; i < dots; i++) base = dirname(base);
      return resolveModulePath(base, rest, projectRoot);
    }

    // Absolute import — search from project root and common src dirs
    const searchRoots = [projectRoot];
    for (const sub of ["src", "lib", "app"]) {
      const candidate = join(projectRoot, sub);
      if (existsSync(candidate)) searchRoots.push(candidate);
    }

    for (const searchRoot of searchRoots) {
      const result = resolveModulePath(searchRoot, importPath, projectRoot);
      if (result) return result;
    }

    return null;
  },
};

function resolveModulePath(
  base: string,
  modulePath: string,
  projectRoot: string
): string | null {
  if (!modulePath) return null;
  const parts = modulePath.split(".");
  const dirPath = join(base, ...parts);

  // Check package (__init__.py)
  const initFile = join(dirPath, "__init__.py");
  if (existsSync(initFile)) return initFile;

  // Check module file
  const pyFile = dirPath + ".py";
  if (existsSync(pyFile)) return pyFile;

  // Check partial — first N-1 parts as dirs, last part as file
  if (parts.length > 1) {
    const parentDir = join(base, ...parts.slice(0, -1));
    const fileName = parts[parts.length - 1] + ".py";
    const candidate = join(parentDir, fileName);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/core/module-resolvers.test.ts -t "Python" -v`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/core/resolvers/python.ts tests/core/module-resolvers.test.ts
git commit -m "feat(resolvers): Python module resolver with relative imports and __init__.py"
```

---

### Task 11: Go Module Resolver

**Files:**
- Create: `src/core/resolvers/go.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/core/module-resolvers.test.ts`:

```typescript
import { goResolver } from "../../src/core/resolvers/go.js";
registerResolver(goResolver);

describe("Go module resolver", () => {
  it("resolves internal package import", () => {
    root = mkdtempSync(join(tmpdir(), "cw-gores-"));
    mkdirSync(join(root, "internal", "auth"), { recursive: true });
    writeFileSync(join(root, "go.mod"), "module github.com/user/project\n\ngo 1.21");
    writeFileSync(join(root, "internal", "auth", "service.go"), "package auth");
    writeFileSync(join(root, "main.go"), 'import "github.com/user/project/internal/auth"');

    const result = resolveImport(
      "go",
      "github.com/user/project/internal/auth",
      join(root, "main.go"),
      root
    );
    expect(result).toBe(join(root, "internal", "auth"));
  });

  it("returns null for external module", () => {
    root = mkdtempSync(join(tmpdir(), "cw-gores2-"));
    writeFileSync(join(root, "go.mod"), "module github.com/user/project\n\ngo 1.21");

    const result = resolveImport(
      "go",
      "github.com/gin-gonic/gin",
      join(root, "main.go"),
      root
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleResolver } from "./index.js";

export const goResolver: ModuleResolver = {
  language: "go",
  resolve(importPath, fromFile, projectRoot) {
    const goModPath = join(projectRoot, "go.mod");
    if (!existsSync(goModPath)) return null;

    const goMod = readFileSync(goModPath, "utf8");
    const moduleMatch = goMod.match(/^module\s+(\S+)/m);
    if (!moduleMatch) return null;

    const moduleName = moduleMatch[1];
    if (!importPath.startsWith(moduleName)) return null;

    const relativePath = importPath.slice(moduleName.length + 1);
    if (!relativePath) return null;

    const dirPath = join(projectRoot, ...relativePath.split("/"));
    if (existsSync(dirPath)) return dirPath;

    return null;
  },
};
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run tests/core/module-resolvers.test.ts -t "Go" -v
git add src/core/resolvers/go.ts tests/core/module-resolvers.test.ts
git commit -m "feat(resolvers): Go module resolver via go.mod"
```

---

### Task 12: Rust Module Resolver

**Files:**
- Create: `src/core/resolvers/rust.ts`

- [ ] **Step 1: Write failing test, then implement**

Rust resolution: `use crate::auth::service::AuthService` → look for `src/auth/service.rs` or `src/auth/service/mod.rs`. Also handle `super::` (parent module) and `self::` (current module).

```typescript
export const rustResolver: ModuleResolver = {
  language: "rust",
  resolve(importPath, fromFile, projectRoot) {
    const srcDir = existsSync(join(projectRoot, "src"))
      ? join(projectRoot, "src")
      : projectRoot;

    let normalized = importPath
      .replace(/^crate::/, "")
      .replace(/^self::/, getCurrentModule(fromFile, srcDir))
      .replace(/^super::/, getParentModule(fromFile, srcDir));

    const parts = normalized.split("::");
    // Drop the final item name (it's a symbol, not a module)
    const moduleParts = parts.slice(0, -1);
    if (moduleParts.length === 0) return null;

    const filePath = join(srcDir, ...moduleParts) + ".rs";
    if (existsSync(filePath)) return filePath;

    const modPath = join(srcDir, ...moduleParts, "mod.rs");
    if (existsSync(modPath)) return modPath;

    return null;
  },
};
```

- [ ] **Step 2: Test + commit** (same pattern)

---

### Task 13: Java, C#, C/C++, Ruby, PHP Resolvers

Each follows the same pattern — implement and test:

**Java** (`src/core/resolvers/java.ts`):
- `import com.example.service.UserService` → `com/example/service/UserService.java`
- Search `src/main/java/`, `src/`, and project root
- Handle wildcard imports (`import com.example.service.*`) → resolve to directory

**C#** (`src/core/resolvers/csharp.ts`):
- `using App.Models.User` → namespace convention: `App/Models/User.cs`
- Search project root and any `src/` directories

**C/C++** (`src/core/resolvers/cpp.ts`):
- `#include "auth/service.h"` → relative to including file's directory and project root
- `#include <system/header.h>` → return null (system header)
- Parse CMakeLists.txt for `include_directories()` if present

**Ruby** (`src/core/resolvers/ruby.ts`):
- `require_relative './auth/service'` → resolve relative to file + `.rb` extension
- `require 'auth/service'` → search `lib/`, project root
- Return null for gem requires

**PHP** (`src/core/resolvers/php.ts`):
- `use App\Models\User` → parse `composer.json` for PSR-4 autoload map
- Map namespace prefix to directory, then `\` to `/` + `.php`

Each resolver: ~30-60 lines. Each test: ~20-40 lines.

- [ ] **Step 1-5 per resolver: Write test, implement, verify, commit**

One commit per resolver:
```bash
git commit -m "feat(resolvers): Java package resolution"
git commit -m "feat(resolvers): C# namespace resolution"
git commit -m "feat(resolvers): C/C++ include path resolution"
git commit -m "feat(resolvers): Ruby require resolution"
git commit -m "feat(resolvers): PHP PSR-4 autoload resolution"
```

---

### Task 14: Wire Resolvers into Indexer

**Files:**
- Modify: `src/core/indexer.ts`
- Modify: `src/core/resolvers/index.ts`

- [ ] **Step 1: Register all resolvers on init**

In `src/core/resolvers/index.ts`, add:

```typescript
import { pythonResolver } from "./python.js";
import { goResolver } from "./go.js";
import { rustResolver } from "./rust.js";
import { javaResolver } from "./java.js";
import { csharpResolver } from "./csharp.js";
import { cppResolver } from "./cpp.js";
import { rubyResolver } from "./ruby.js";
import { phpResolver } from "./php.js";

export function initResolvers(): void {
  registerResolver(pythonResolver);
  registerResolver(goResolver);
  registerResolver(rustResolver);
  registerResolver(javaResolver);
  registerResolver(csharpResolver);
  registerResolver(cppResolver);
  registerResolver(rubyResolver);
  registerResolver(phpResolver);
}
```

- [ ] **Step 2: Call `initResolvers()` at the start of `indexProject`**

- [ ] **Step 3: Use resolver in import edge creation**

In the import edge loop (~line 768), after getting `parsedImport.source`, try:

```typescript
const resolvedPath = resolveImport(language, parsedImport.source, filePath, projectRoot);
if (resolvedPath) {
  const targetFile = files.getByPath(resolvedPath);
  if (targetFile) {
    // Look up symbols in the resolved file by imported names
    for (const name of parsedImport.names) {
      const targetSym = symbols.getByFileAndName(targetFile.id, name);
      if (targetSym) {
        edges.insert({
          sourceSymbolId: callerSymbolId,
          targetSymbolId: targetSym.id,
          kind: "import",
          createdAt: now,
        });
      }
    }
    continue; // Skip the old pickTargets fallback
  }
}
// Fall back to existing pickTargets logic
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All pass (resolvers add edges, don't remove any)

- [ ] **Step 5: Commit**

```bash
git add src/core/resolvers/ src/core/indexer.ts
git commit -m "feat(indexer): wire per-language module resolvers into import edge creation"
```

---

## Chunk 4: Framework Plugin System 2.0

Extends the existing `FrameworkTracePlugin` interface to support decorator-based matching and adds plugins for major frameworks across all languages.

### Task 15: Extend Plugin Interface

**Files:**
- Modify: `src/frameworks/types.ts`

- [ ] **Step 1: Add decorator-based matching to the plugin interface**

```typescript
export interface FrameworkTracePlugin {
  id: string;
  languages: string[];  // NEW: which languages this plugin applies to
  // Existing: regex-based extraction from symbol source
  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[];
  // NEW: decorator-based extraction (higher priority, more accurate)
  extractFromDecorators?(symbols: ParsedSymbol[]): ParsedFrameworkCall[];
  supports(call: ParsedFrameworkCall): boolean;
  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[];
}
```

- [ ] **Step 2: Update registry to call `extractFromDecorators` when available**

In `src/frameworks/registry.ts`, update `extractFrameworkCalls`:

```typescript
export function extractFrameworkCalls(
  language: string,
  symbols: ParsedSymbol[]
): ParsedFrameworkCall[] {
  const calls: ParsedFrameworkCall[] = [];
  for (const plugin of FRAMEWORK_TRACE_PLUGINS) {
    if (plugin.languages && !plugin.languages.includes(language)) continue;
    if (plugin.extractFromDecorators) {
      calls.push(...plugin.extractFromDecorators(symbols));
    }
    calls.push(...plugin.extractCalls(language, symbols));
  }
  return calls;
}
```

- [ ] **Step 3: Extend `ParsedFrameworkCall` framework union type**

Add to the `framework` field union in `types.ts`:

```typescript
framework:
  | "next_fetch" | "express_route"
  | "convex_mutation" | "convex_query" | "convex_action"
  | "fastapi_route" | "django_url" | "flask_route"
  | "spring_mapping" | "aspnet_action"
  | "rails_route" | "laravel_route"
  | "gin_route" | "axum_route" | "actix_route"
  | "grpc_service"
  | "celery_task" | "sidekiq_job";
```

- [ ] **Step 4: Commit**

```bash
git add src/frameworks/types.ts src/frameworks/registry.ts src/core/types.ts
git commit -m "feat(frameworks): extend plugin interface with decorator matching and multi-language support"
```

---

### Task 16: Python Framework Plugins (FastAPI, Django, Flask, Celery)

**Files:**
- Create: `src/frameworks/plugins/fastapi.ts`
- Create: `src/frameworks/plugins/django.ts`
- Create: `src/frameworks/plugins/flask.ts`
- Create: `src/frameworks/plugins/celery.ts`
- Create: `tests/frameworks/plugin-python.test.ts`

- [ ] **Step 1: FastAPI plugin**

```typescript
import type { FrameworkTracePlugin, ParsedFrameworkCall } from "../types.js";
import type { ParsedSymbol } from "../../core/types.js";

const HTTP_DECORATORS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export const fastapiPlugin: FrameworkTracePlugin = {
  id: "fastapi",
  languages: ["python"],

  extractFromDecorators(symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    const calls: ParsedFrameworkCall[] = [];
    for (const sym of symbols) {
      if (!sym.decorators) continue;
      for (const dec of sym.decorators) {
        // @app.get("/users") or @router.post("/users")
        const parts = dec.name.split(".");
        const method = parts[parts.length - 1].toLowerCase();
        if (!HTTP_DECORATORS.has(method)) continue;
        const routePath = dec.args?.[0] ?? "/";
        calls.push({
          callerSymbol: sym.name,
          targetName: `${method.toUpperCase()} ${routePath}`,
          line: sym.startLine,
          framework: "fastapi_route",
          httpMethod: method.toUpperCase(),
          routePath,
        });
      }
    }
    return calls;
  },

  extractCalls(_language, _symbols) { return []; },
  supports(call) { return call.framework === "fastapi_route"; },
  resolveTargets(_call, _context) { return []; },
};
```

- [ ] **Step 2: Flask plugin** — nearly identical to FastAPI, same HTTP decorator pattern

- [ ] **Step 3: Django plugin** — different pattern: scans for `urlpatterns = [path("route", view_func)]` in `urls.py` files. Uses regex on symbol source, not decorators.

- [ ] **Step 4: Celery plugin** — scans for `@shared_task` / `@app.task` decorators, then finds `.delay()` / `.apply_async()` callers:

```typescript
extractFromDecorators(symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
  const calls: ParsedFrameworkCall[] = [];
  for (const sym of symbols) {
    const isTask = sym.decorators?.some(
      (d) => d.name === "shared_task" || d.name.endsWith(".task")
    );
    if (isTask) {
      calls.push({
        callerSymbol: sym.name,
        targetName: sym.name,
        line: sym.startLine,
        framework: "celery_task",
      });
    }
  }
  return calls;
},
```

- [ ] **Step 5: Write tests, run, commit**

```bash
git add src/frameworks/plugins/fastapi.ts src/frameworks/plugins/flask.ts \
  src/frameworks/plugins/django.ts src/frameworks/plugins/celery.ts \
  tests/frameworks/plugin-python.test.ts
git commit -m "feat(frameworks): Python plugins for FastAPI, Flask, Django, Celery"
```

---

### Task 17: Java Plugin (Spring Boot)

**Files:**
- Create: `src/frameworks/plugins/spring.ts`
- Create: `tests/frameworks/plugin-java.test.ts`

Key decorators to detect: `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping`, `@RestController`, `@Controller`, `@Service`, `@Repository`, `@Component`, `@Autowired`, `@EventListener`.

```typescript
const MAPPING_ANNOTATIONS = new Map([
  ["GetMapping", "GET"], ["PostMapping", "POST"], ["PutMapping", "PUT"],
  ["DeleteMapping", "DELETE"], ["PatchMapping", "PATCH"],
]);

extractFromDecorators(symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
  const calls: ParsedFrameworkCall[] = [];
  // Find class-level @RequestMapping for base path
  let basePath = "";
  for (const sym of symbols) {
    if (sym.kind !== "class") continue;
    const reqMapping = sym.decorators?.find((d) => d.name === "RequestMapping");
    if (reqMapping?.args?.[0]) basePath = reqMapping.args[0];
  }

  for (const sym of symbols) {
    if (sym.kind !== "method") continue;
    if (!sym.decorators) continue;
    for (const dec of sym.decorators) {
      const method = MAPPING_ANNOTATIONS.get(dec.name);
      if (!method) continue;
      const routePath = basePath + (dec.args?.[0] ?? "");
      calls.push({
        callerSymbol: sym.name,
        targetName: `${method} ${routePath}`,
        line: sym.startLine,
        framework: "spring_mapping",
        httpMethod: method,
        routePath,
      });
    }
  }
  return calls;
},
```

- [ ] **Steps 1-5: Write test, implement, verify, commit**

---

### Task 18: C# Plugin (ASP.NET)

**Files:**
- Create: `src/frameworks/plugins/aspnet.ts`

Pattern: `[HttpGet("path")]`, `[HttpPost("path")]`, `[ApiController]`, `[Route("api/[controller]")]`.
Very similar to Spring — read `[HttpGet]` → GET, etc. Read `[Route]` for base path from class.

---

### Task 19: Go Plugin (Gin/Echo)

**Files:**
- Create: `src/frameworks/plugins/gin.ts`

Go doesn't have decorators. Uses regex extraction on symbol source:
- `r.GET("/users", handlers.ListUsers)` → route edge
- `e.POST("/users", createUser)` → route edge

```typescript
extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
  if (language !== "go") return [];
  const calls: ParsedFrameworkCall[] = [];
  const routeRe = /\b(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"\s*,\s*(\w+(?:\.\w+)?)/g;
  for (const sym of symbols) {
    for (const match of sym.fullSource.matchAll(routeRe)) {
      calls.push({
        callerSymbol: sym.name,
        targetName: match[2],
        line: sym.startLine,
        framework: "gin_route",
        httpMethod: match[0].match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/)![0],
        routePath: match[1],
      });
    }
  }
  return calls;
},
```

---

### Task 20: Rust Plugin (Axum/Actix)

**Files:**
- Create: `src/frameworks/plugins/axum.ts`

Uses decorator extraction: `#[get("/path")]`, `#[post("/path")]` from Actix-web. Axum uses `Router::new().route("/path", get(handler))` — regex-based.

---

### Task 21: Ruby Plugin (Rails) + PHP Plugin (Laravel)

**Rails**: Parse `config/routes.rb` for `resources :users`, `get '/users', to: 'users#index'`. Map to `UsersController` methods (index, show, create, update, destroy).

**Laravel**: Parse `routes/web.php` / `routes/api.php` for `Route::get('/users', [UserController::class, 'index'])`.

Both are regex-based since Ruby/PHP routes are in configuration files, not decorators on the handlers themselves.

---

### Task 22: gRPC Plugin

**Files:**
- Create: `src/frameworks/plugins/grpc.ts`

Scans `.proto` files (if indexed) or Go/Python/Java generated stubs. Matches `service ServiceName { rpc MethodName(...) returns (...) }` to server implementations.

- [ ] **Steps per plugin: Write test, implement, register in registry.ts, verify, commit**

After all plugins are registered:

```bash
git add src/frameworks/plugins/*.ts src/frameworks/registry.ts tests/frameworks/
git commit -m "feat(frameworks): register all new language framework plugins"
```

---

### Task 23: Extend Event Edge Synthesis for Non-JS Patterns

**Files:**
- Modify: `src/core/event-edge-synthesis.ts`

Add language-specific cross-boundary patterns:

**Go channels:**
```typescript
const GO_CHANNEL_SEND = /(\w+)\s*<-\s*/g;
const GO_CHANNEL_RECV = /<-\s*(\w+)/g;
```

**Rust tokio channels:**
```typescript
const RUST_CHANNEL_SEND = /(\w+)\.send\s*\(/g;
const RUST_CHANNEL_RECV = /(\w+)\.recv\s*\(\s*\)/g;
```

**Python Django signals:**
```typescript
const PYTHON_SIGNAL_SEND = /(\w+)\.send\s*\(\s*sender\s*=/g;
const PYTHON_SIGNAL_CONNECT = /(\w+)\.connect\s*\(\s*(\w+)/g;
```

**Java Spring events:**
```typescript
const JAVA_PUBLISH_EVENT = /publishEvent\s*\(\s*new\s+(\w+)/g;
const JAVA_EVENT_LISTENER = /@EventListener/; // decorator-based, handled by Spring plugin
```

**C# events:**
```typescript
const CSHARP_EVENT_INVOKE = /(\w+)\s*\?\.\s*Invoke\s*\(/g;
const CSHARP_EVENT_HANDLER = /event\s+\w+\s+(\w+)/g;
```

Each pattern pair: scan all symbols of the appropriate language, build channel→symbol maps, create `event` edges.

- [ ] **Steps: Add patterns, test with fixtures, commit**

```bash
git commit -m "feat(edges): cross-boundary event synthesis for Go, Rust, Python, Java, C# patterns"
```

---

## Chunk 5: Lightweight Type Inference

This is the highest-effort, highest-impact change. It resolves method calls like `user.save()` to the correct `User.save` by tracking type annotations that are already present in the source code.

### Task 24: Type Annotation Extractor

**Files:**
- Create: `src/core/type-inference.ts`
- Create: `tests/core/type-inference.test.ts`

- [ ] **Step 1: Define the type map structure**

```typescript
export interface TypeBinding {
  variableName: string;
  typeName: string;
  line: number;
  source: "annotation" | "constructor" | "return_type" | "parameter";
}

export interface FileTypeMap {
  bindings: TypeBinding[];
  getTypeAt(variableName: string, line: number): string | null;
}
```

- [ ] **Step 2: Write failing tests**

```typescript
describe("type inference", () => {
  it("extracts TypeScript type annotations", () => {
    const map = extractTypeBindings("test.ts", `
const service: AuthService = new AuthService();
function handle(req: Request, res: Response) {
  const user: User = service.getUser(req.id);
  user.save();
}
`, "typescript");

    expect(map.getTypeAt("service", 2)).toBe("AuthService");
    expect(map.getTypeAt("req", 3)).toBe("Request");
    expect(map.getTypeAt("user", 4)).toBe("User");
  });

  it("extracts constructor calls without annotations", () => {
    const map = extractTypeBindings("test.ts", `
const service = new AuthService();
const handler = new RequestHandler(service);
`, "typescript");

    expect(map.getTypeAt("service", 2)).toBe("AuthService");
    expect(map.getTypeAt("handler", 3)).toBe("RequestHandler");
  });

  it("extracts Python type hints", () => {
    const map = extractTypeBindings("test.py", `
def process(service: AuthService, user: User) -> Result:
    token: str = service.generate_token(user)
    return Result(token)
`, "python");

    expect(map.getTypeAt("service", 2)).toBe("AuthService");
    expect(map.getTypeAt("user", 2)).toBe("User");
  });

  it("extracts Go variable types from declarations", () => {
    const map = extractTypeBindings("test.go", `
func main() {
    var server Server
    handler := NewHandler()
    var db *Database
}
`, "go");

    expect(map.getTypeAt("server", 3)).toBe("Server");
    expect(map.getTypeAt("db", 5)).toBe("Database");
  });

  it("extracts Rust type annotations", () => {
    const map = extractTypeBindings("test.rs", `
fn main() {
    let server: Server = Server::new(8080);
    let mut handler: Handler = Handler::default();
}
`, "rust");

    expect(map.getTypeAt("server", 3)).toBe("Server");
    expect(map.getTypeAt("handler", 4)).toBe("Handler");
  });

  it("extracts Java variable types", () => {
    const map = extractTypeBindings("Test.java", `
public class Main {
    public void run() {
        UserService service = new UserService();
        List<User> users = service.findAll();
    }
}
`, "java");

    expect(map.getTypeAt("service", 4)).toBe("UserService");
  });
});
```

- [ ] **Step 3: Implement type extraction**

Strategy: use a combination of tree-sitter queries and lightweight regex for each language. The tree-sitter approach is preferred for structured extraction, but regex provides a fast fallback.

```typescript
export function extractTypeBindings(
  filePath: string,
  content: string,
  language: string
): FileTypeMap {
  const bindings: TypeBinding[] = [];

  // Strategy 1: Constructor calls (works for most languages)
  // Pattern: variable = new Type(...) or Type.new(...) or Type{...}
  const constructorPatterns: Record<string, RegExp> = {
    typescript: /(?:const|let|var)\s+(\w+)(?:\s*:\s*\w+)?\s*=\s*new\s+(\w+)/g,
    javascript: /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(\w+)/g,
    python: /(\w+)\s*(?::\s*\w+)?\s*=\s*(\w+)\s*\(/g,
    go: /(\w+)\s*:=\s*(\w+)\{/g,
    rust: /let\s+(?:mut\s+)?(\w+)(?:\s*:\s*\w+)?\s*=\s*(\w+)::/g,
    java: /(\w+)\s+(\w+)\s*=\s*new\s+\2/g,
    csharp: /(?:var\s+)?(\w+)\s*=\s*new\s+(\w+)/g,
  };

  // Strategy 2: Type annotations (language-specific)
  const annotationPatterns: Record<string, RegExp> = {
    typescript: /(?:const|let|var)\s+(\w+)\s*:\s*(\w+)/g,
    python: /(\w+)\s*:\s*(\w+)\s*[=,)]/g,
    go: /var\s+(\w+)\s+\*?(\w+)/g,
    rust: /let\s+(?:mut\s+)?(\w+)\s*:\s*(\w+)/g,
    java: /(\w+)\s+(\w+)\s*[=;,)]/g,
    csharp: /(\w+)\s+(\w+)\s*[=;,)]/g,
  };

  // Strategy 3: Parameter type annotations
  const paramPatterns: Record<string, RegExp> = {
    typescript: /(\w+)\s*:\s*(\w+)/g,
    python: /(\w+)\s*:\s*(\w+)/g,
    go: /(\w+)\s+\*?(\w+)/g,
    java: /(\w+)\s+(\w+)/g,
    csharp: /(\w+)\s+(\w+)/g,
    rust: /(\w+)\s*:\s*(?:&(?:mut\s+)?)?(\w+)/g,
  };

  const lang = language.replace("tsx", "typescript").replace("jsx", "javascript");

  // Apply constructor patterns
  const ctorRe = constructorPatterns[lang];
  if (ctorRe) {
    const re = new RegExp(ctorRe.source, ctorRe.flags);
    for (const match of content.matchAll(re)) {
      const line = content.slice(0, match.index).split("\n").length;
      bindings.push({
        variableName: match[1],
        typeName: match[2],
        line,
        source: "constructor",
      });
    }
  }

  // Apply annotation patterns
  const annoRe = annotationPatterns[lang];
  if (annoRe) {
    const re = new RegExp(annoRe.source, annoRe.flags);
    for (const match of content.matchAll(re)) {
      const line = content.slice(0, match.index).split("\n").length;
      const typeName = match[2];
      // Skip lowercase types (primitives: string, number, int, bool, etc.)
      if (typeName[0] === typeName[0].toLowerCase()) continue;
      bindings.push({
        variableName: match[1],
        typeName,
        line,
        source: "annotation",
      });
    }
  }

  return {
    bindings,
    getTypeAt(variableName: string, line: number): string | null {
      // Find the closest binding before the given line
      const matches = bindings
        .filter((b) => b.variableName === variableName && b.line <= line)
        .sort((a, b) => b.line - a.line);
      return matches[0]?.typeName ?? null;
    },
  };
}
```

- [ ] **Step 4: Run tests, iterate until passing, commit**

---

### Task 25: Wire Type Inference into Edge Resolution

**Files:**
- Modify: `src/core/indexer.ts`

- [ ] **Step 1: Use type map during call edge creation**

For each `ParsedCall`, if the callee appears to be a method call (detected from the call expression pattern), use the `FileTypeMap` to resolve the receiver type:

```typescript
// In the call edge creation loop:
const typeMap = extractTypeBindings(filePath, content, language);

for (const call of parsedCalls) {
  // Detect if this is a method call by checking the original AST
  // The calleeName is already just the method name (e.g., "validate")
  // We need to check if there's a receiver in the original source
  const receiverType = inferReceiverType(call, typeMap, fileContent);

  if (receiverType) {
    // Look for qualified match: ReceiverType.calleeName
    const qualifiedTarget = `${receiverType}.${call.calleeName}`;
    const qualified = syms.getByQualifiedName(qualifiedTarget);
    if (qualified) {
      edges.insert({ sourceSymbolId, targetSymbolId: qualified.id, kind: call.edgeKind ?? "call", createdAt: now });
      continue;
    }
  }

  // Fall back to existing resolution
  const targets = pickTargets(call.calleeName);
  // ... existing logic
}
```

- [ ] **Step 2: Implement `inferReceiverType`**

```typescript
function inferReceiverType(
  call: ParsedCall,
  typeMap: FileTypeMap,
  content: string
): string | null {
  // Look at the source line for a receiver pattern: receiver.method(
  const lines = content.split("\n");
  const line = lines[call.line - 1];
  if (!line) return null;

  const receiverRe = new RegExp(`(\\w+)\\.${call.calleeName}\\s*\\(`);
  const match = line.match(receiverRe);
  if (!match) return null;

  const receiverName = match[1];
  if (receiverName === "this" || receiverName === "self") {
    // Look for the containing class
    return null; // Handled by parent tracking
  }

  return typeMap.getTypeAt(receiverName, call.line);
}
```

- [ ] **Step 3: Run full test suite, commit**

```bash
git commit -m "feat(indexer): type-informed method call resolution"
```

---

### Task 26: Go Interface Satisfaction Detection

**Files:**
- Modify: `src/core/parser.ts` or new `src/core/go-interfaces.ts`

Go interfaces are implemented implicitly — no `implements` keyword. Detect satisfaction by comparing method sets:

```typescript
function detectGoInterfaceSatisfaction(
  db: Database.Database,
  fileId: number
): void {
  const syms = symbolQueries(db);
  const fileSymbols = syms.getByFileId(fileId);

  // Get all interfaces (kind=class in Go that are actually interfaces)
  const interfaces = fileSymbols.filter(
    (s) => s.kind === "interface" || s.signature.includes("interface")
  );
  const structs = fileSymbols.filter(
    (s) => s.kind === "class" && s.signature.includes("struct")
  );

  for (const iface of interfaces) {
    const ifaceMethods = syms.getByParent(iface.id).map((s) => s.name);
    if (ifaceMethods.length === 0) continue;

    for (const struct of structs) {
      const structMethods = new Set(
        syms.getByParent(struct.id).map((s) => s.name)
      );
      if (ifaceMethods.every((m) => structMethods.has(m))) {
        edges.insert({
          sourceSymbolId: struct.id,
          targetSymbolId: iface.id,
          kind: "implements",
          createdAt: Date.now(),
        });
      }
    }
  }
}
```

Note: This only works within a single file currently. Cross-file interface satisfaction requires a post-indexing pass similar to `synthesizeEventEdges`.

- [ ] **Steps: Write test with Go interface fixture, implement, verify, commit**

---

### Task 27: Rust Trait Impl Detection

**Files:**
- Modify: `src/core/parser.ts`

When parsing Rust `impl Trait for Type` blocks, create an `implements` edge from `Type` to `Trait`:

In the Rust-specific post-pass (alongside `assignRustImplParents`), scan for `impl_item` nodes that have a `trait` field:

```typescript
function detectRustTraitImpls(tree: Parser.Tree, symbols: ParsedSymbol[]): ParsedCall[] {
  const calls: ParsedCall[] = [];
  // Walk tree looking for impl_item nodes with trait field
  // impl TraitName for TypeName { ... }
  // Create an edge: TypeName --implements--> TraitName
  // ... tree walking logic
  return calls;
}
```

- [ ] **Steps: Write test, implement, verify, commit**

---

## Chunk 6: Recall, Overview, and Flow Improvements

### Task 28: Hybrid Recall — BM25 + Embeddings

**Files:**
- Modify: `src/memory/search.ts`

- [ ] **Step 1: Wire `chunk_embeddings` into search**

The `chunk_embeddings` table already exists. Add an embedding similarity search path:

```typescript
async search(query: string, options?: SearchOptions): Promise<ScoredObservation[]> {
  // Layer 1: BM25 (existing)
  const bm25Results = this.bm25Search(query, options);

  // Layer 2: Embedding similarity (NEW)
  const embeddingResults = this.embeddingSearch(query, options);

  // Hybrid merge with RRF (Reciprocal Rank Fusion)
  return this.mergeWithRRF(bm25Results, embeddingResults, options?.limit ?? 20);
}

private mergeWithRRF(
  bm25: ScoredObservation[],
  embedding: ScoredObservation[],
  limit: number,
  k = 60
): ScoredObservation[] {
  const scores = new Map<number, number>();
  bm25.forEach((obs, i) => {
    scores.set(obs.id, (scores.get(obs.id) ?? 0) + 1 / (k + i + 1));
  });
  embedding.forEach((obs, i) => {
    scores.set(obs.id, (scores.get(obs.id) ?? 0) + 1 / (k + i + 1));
  });

  const all = new Map<number, ScoredObservation>();
  for (const obs of [...bm25, ...embedding]) {
    if (!all.has(obs.id)) all.set(obs.id, obs);
  }

  return [...all.values()]
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
    .slice(0, limit);
}
```

- [ ] **Step 2: Implement embedding search fallback**

If no embedding runtime is available, skip embedding layer gracefully:

```typescript
private embeddingSearch(query: string, options?: SearchOptions): ScoredObservation[] {
  if (!this.embeddingRuntime) return [];
  // ... compute query embedding, search chunk_embeddings table by cosine similarity
  // ... map chunks back to observations
}
```

- [ ] **Step 3: Test, commit**

```bash
git commit -m "feat(recall): hybrid BM25 + embedding search with RRF fusion"
```

---

### Task 29: Auto-Populate Observations from Capsule Insights

**Files:**
- Modify: `src/capsule/generator.ts`

- [ ] **Step 1: After generating a HIGH-confidence capsule, store key insights**

At the end of `generateCapsule`, after confidence is computed:

```typescript
if (
  metadata.quality.confidence === "HIGH" &&
  metadata.quality.coverageConfidence >= 0.7
) {
  const topSymbols = packed.slice(0, 5).map((n) => n.name).join(", ");
  const topFiles = [...uniqueFiles].slice(0, 3).join(", ");
  observationQueries(db).insert({
    sessionId,
    scope: "capsule-insight",
    note: `Query "${query}" resolved to: ${topSymbols} in ${topFiles}`,
    confidence: metadata.quality.coverageConfidence,
    symbolId: packed[0]?.id ?? null,
    fileId: null,
  });
}
```

- [ ] **Step 2: Expand synonym map in search.ts**

Grow the 14-entry synonym map to cover more domain terms:

```typescript
const SYNONYM_MAP: Record<string, string[]> = {
  auth: ["authentication", "authorization", "login", "session", "jwt", "token", "oauth"],
  db: ["database", "sql", "query", "schema", "migration", "model", "repository"],
  api: ["endpoint", "route", "handler", "controller", "rest", "graphql", "request"],
  ui: ["component", "view", "template", "render", "layout", "page", "screen"],
  test: ["spec", "fixture", "mock", "stub", "assert", "expect", "coverage"],
  config: ["configuration", "settings", "environment", "env", "options", "preferences"],
  error: ["exception", "failure", "crash", "bug", "issue", "fault"],
  cache: ["memoize", "store", "redis", "memcached", "ttl", "invalidate"],
  queue: ["job", "worker", "task", "background", "async", "celery", "sidekiq"],
  event: ["listener", "handler", "emit", "publish", "subscribe", "dispatch", "signal"],
  middleware: ["interceptor", "filter", "hook", "plugin", "pipe"],
  validation: ["validate", "sanitize", "check", "verify", "constraint", "rule"],
  // ... add more as needed
};
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(recall): auto-populate insights from capsules, expand synonym map"
```

---

### Task 30: Overview Tool — Structural View

**Files:**
- Modify: `src/mcp/tools/overview.ts`

- [ ] **Step 1: Add entry point detection**

Show top 10 symbols by PageRank centrality as "entry points":

```typescript
const entryPoints = db.prepare(`
  SELECT s.name, s.qualified_name, s.kind, s.centrality, f.path
  FROM symbols s JOIN files f ON s.file_id = f.id
  WHERE s.is_exported = 1
  ORDER BY s.centrality DESC
  LIMIT 10
`).all() as { name: string; qualified_name: string; kind: string; centrality: number; path: string }[];

sections.push("## Entry Points (by centrality)");
for (const ep of entryPoints) {
  sections.push(`- ${ep.qualified_name ?? ep.name} (${ep.kind}) — ${ep.path.replace(projectRoot + "/", "")}`);
}
```

- [ ] **Step 2: Add module boundary summary**

Show top-level directories with their edge connections:

```typescript
const moduleBoundaries = db.prepare(`
  SELECT
    substr(sf.path, 1, instr(substr(sf.path, length(?1) + 2), '/') + length(?1)) AS src_module,
    substr(tf.path, 1, instr(substr(tf.path, length(?1) + 2), '/') + length(?1)) AS tgt_module,
    COUNT(*) AS edge_count
  FROM edges e
  JOIN symbols ss ON e.source_symbol_id = ss.id
  JOIN symbols ts ON e.target_symbol_id = ts.id
  JOIN files sf ON ss.file_id = sf.id
  JOIN files tf ON ts.file_id = tf.id
  WHERE sf.path LIKE ?1 || '%' AND tf.path LIKE ?1 || '%'
  GROUP BY src_module, tgt_module
  HAVING src_module != tgt_module
  ORDER BY edge_count DESC
  LIMIT 15
`).all(projectRoot + "/") as { src_module: string; tgt_module: string; edge_count: number }[];
```

- [ ] **Step 3: Test, commit**

```bash
git commit -m "feat(overview): entry points by centrality and module boundary summary"
```

---

### Task 31: Flow Tool — Edge-Kind Scoring + Path Diversification

**Files:**
- Modify: `src/mcp/tools/flow.ts`

- [ ] **Step 1: Add edge-kind scoring to path ranking**

When selecting the final MAX_PATHS paths, score each path by the quality of its edges:

```typescript
const FLOW_EDGE_QUALITY: Record<string, number> = {
  call: 1.0,
  dynamic_dispatch: 0.9,
  callback: 0.85,
  "server-action": 0.85,
  "route-handler": 0.85,
  event: 0.8,
  jsx_render: 0.7,
  framework_entry: 0.7,
  implements: 0.6,
  inheritance: 0.6,
  type_usage: 0.3,
  import: 0.2,
  reexport: 0.1,
  reference: 0.1,
};

function scorePath(path: FlowStep[]): number {
  if (path.length === 0) return 0;
  let score = 0;
  let crossFileBoundaries = 0;
  for (let i = 0; i < path.length; i++) {
    score += FLOW_EDGE_QUALITY[path[i].edgeKind] ?? 0.5;
    if (i > 0 && path[i].file !== path[i - 1].file) crossFileBoundaries++;
  }
  // Bonus for paths that cross file boundaries (more architecturally interesting)
  score += crossFileBoundaries * 0.3;
  return score / path.length;
}
```

Sort candidate paths by score descending before selecting top MAX_PATHS.

- [ ] **Step 2: Filter out import-only paths**

Paths that consist entirely of `import` edges are not useful for flow understanding:

```typescript
const meaningfulPaths = allPaths.filter(
  (path) => path.some((step) => step.edgeKind !== "import" && step.edgeKind !== "reexport")
);
```

- [ ] **Step 3: Test, commit**

```bash
git commit -m "feat(flow): edge-kind quality scoring and import-path filtering"
```

---

### Task 32: Flow Tool — Use Qualified Names in Output

**Files:**
- Modify: `src/mcp/tools/flow.ts`

- [ ] **Step 1: Include qualified_name in FlowStep output**

When building `FlowStep` objects, include the `qualified_name`:

```typescript
interface FlowStep {
  symbol: string;
  qualifiedName?: string;  // NEW
  file: string;
  line: number;
  edgeKind: string;
}
```

Populate from the symbol record.

- [ ] **Step 2: Format output with qualified names**

```
AuthService.validate (src/auth/service.ts:24) --call--> TokenUtils.verify (src/utils/token.ts:12)
```

Instead of:
```
validate (src/auth/service.ts:24) --call--> verify (src/utils/token.ts:12)
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(flow): display qualified names in flow output"
```

---

## Future Considerations (Out of Scope for This Plan)

These are known limitations that are either infeasible with static analysis alone or require disproportionate effort:

| Item | Why Deferred |
|------|-------------|
| **Macro expansion** (Rust proc macros, C/C++ preprocessor) | Requires running the compiler/expander. Possible future approach: index expanded output if build artifacts exist. |
| **Template/generic instantiation** (C++ templates, Java generics) | Requires type solver. Partial mitigation: track `List<User>` as referencing `User`. |
| **Dynamic language metaprogramming** (Ruby `method_missing`, Python `__getattr__`) | Fundamentally undecidable at static analysis time. |
| **Full type inference** (Hindley-Milner, flow-sensitive) | Building a type checker per language is years of work. Our lightweight approach covers 60-70% of cases. |
| **Generated code tracking** (protobuf → Go/Java, GraphQL codegen) | Generated files ARE indexed. Missing: `.proto` → generated file relationship. |
| **Monorepo workspace boundaries** (Cargo workspaces, npm workspaces) | Currently treated as one project. Future: detect workspace roots, restrict BFS to workspace boundary. |
| **External dependency type stubs** | Could index `.d.ts` / `*.pyi` stub files for type info on external packages. |
| **Conditional compilation** (`#[cfg(test)]`, `#ifdef`, `if TYPE_CHECKING:`) | Symbols may or may not exist at runtime. Currently all paths are indexed. |
| **Python `super()` resolution** | Requires MRO (Method Resolution Order) computation from class hierarchy. |
| **Cross-project references** | When Project A imports from Project B (monorepo). Future: multi-root indexing. |

---

## Verification Checklist

After all chunks are complete:

- [ ] `npx tsc --noEmit` — zero TypeScript errors
- [ ] `npx vitest run` — all tests pass (existing + new)
- [ ] `npx vitest run tests/core/qualified-names.test.ts` — parent tracking for TS, Python, Go, Rust, Java, C#
- [ ] `npx vitest run tests/core/decorator-extraction.test.ts` — decorators for Python, Java, Rust, C#, TS, PHP
- [ ] `npx vitest run tests/core/module-resolvers.test.ts` — resolvers for all 8 non-JS languages
- [ ] `npx vitest run tests/core/type-inference.test.ts` — type extraction for TS, Python, Go, Rust, Java
- [ ] `npx vitest run tests/frameworks/` — all framework plugin tests
- [ ] `npx vitest run tests/integration/cross-language-flow.test.ts` — end-to-end multi-language flow
- [ ] Manual smoke test: index a real polyglot project (e.g., a Tauri app with Rust+TS), run `cw_flow`, `cw_impact`, `cw_capsule`
- [ ] Performance: capsule generation for 100k-line codebase still under 8s
- [ ] All new DB migrations apply cleanly on existing `.contextweave.db` files

---

## Execution Order (for parallel subagent dispatch)

**Wave 1 (parallel — no dependencies):**
- Tasks 1-6: Qualified Names + Parent Tracking (Chunk 1)
- Tasks 7-8: Decorator Extraction (Chunk 2)
- Tasks 9-14: Module Resolvers (Chunk 3)
- Tasks 28-30: Recall + Overview improvements (Chunk 6, partial)

**Wave 2 (depends on Wave 1):**
- Tasks 15-23: Framework Plugins 2.0 (Chunk 4, depends on Chunk 2)
- Tasks 24-27: Type Inference (Chunk 5, depends on Chunk 1)
- Tasks 31-32: Flow improvements (Chunk 6, partial)

**Wave 3 (integration):**
- Run full verification checklist
- Performance benchmarks
- Manual smoke tests on real projects
