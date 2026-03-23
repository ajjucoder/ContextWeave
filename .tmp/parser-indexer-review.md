# ContextWeave Parser & Indexing System - Deep Review

## Executive Summary

The ContextWeave parser and indexing system is a sophisticated multi-language code analysis engine built on Tree-sitter, supporting 12+ programming languages with incremental indexing, framework detection, and advanced edge synthesis capabilities.

---

## 1. Language Support Analysis

### 1.1 Primary Languages (12 Languages)

| Language | Parser | Queries | Resolvers | Extensions |
|----------|--------|---------|-----------|------------|
| TypeScript | ✅ tree-sitter-typescript | ✅ Full | N/A | .ts, .tsx, .mts, .cts |
| JavaScript | ✅ tree-sitter-javascript | ✅ Full | N/A | .js, .jsx, .mjs, .cjs |
| Python | ✅ tree-sitter-python | ✅ Full | ✅ | .py |
| Go | ✅ tree-sitter-go | ✅ Full | ✅ | .go |
| Rust | ✅ tree-sitter-rust | ✅ Full | ✅ | .rs |
| Java | ✅ tree-sitter-java | ✅ Full | ✅ | .java |
| C | ✅ tree-sitter-c | ✅ Full | ✅ | .c, .h |
| C++ | ✅ tree-sitter-cpp | ✅ Full | ✅ | .cpp, .cc, .cxx, .hpp, .hxx, .hh |
| C# | ✅ tree-sitter-c-sharp | ✅ Full | ✅ | .cs |
| Ruby | ✅ tree-sitter-ruby | ✅ Full | ✅ | .rb, .rake |
| PHP | ✅ tree-sitter-php | ✅ Full | ✅ | .php |
| Bash | ✅ tree-sitter-bash | ✅ Basic | N/A | .sh, .bash |

### 1.2 Document Languages (5 Types)

- **Markdown** (.md, .markdown) - Extracted as searchable document symbols
- **YAML** (.yaml, .yml) - Structured key-value indexing
- **JSON** (.json) - Structured data indexing
- **TOML** (.toml) - Configuration file support
- **INI** (.ini) - Configuration file support

---

## 2. Tree-sitter Integration Architecture

### 2.1 Grammar Loading Strategy (`parser.ts` lines 28-46)

```typescript
const languageModules: Record<string, () => TreeSitterLanguage> = {
  typescript: () => require("tree-sitter-typescript").typescript,
  tsx: () => require("tree-sitter-typescript").tsx,
  javascript: () => require("tree-sitter-javascript"),
  // ... 12 languages
};
```

**Architecture Pattern:**
- Lazy loading via factory functions (not eagerly loaded)
- Parser caching with `parserCache` Map to avoid re-initialization
- Language detection via `extensionToLanguage` mapping (48-78)

### 2.2 Parsing Strategy & Error Recovery

**Large File Handling (lines 978-989):**
```typescript
// tree-sitter's string parse() throws for inputs >= 32768 bytes
// Use the callback (string-chunk) form for large files
if (content.length < 32768) {
  tree = parser.parse(content);
} else {
  tree = parser.parse(((index: number) => {
    const chunk = content.slice(index, index + 4096);
    return chunk.length > 0 ? chunk : null;
  }) as unknown as string);
}
```

**Error Recovery:**
- Benign TSX parse warnings are filtered (lines 857-886)
- JSX-specific error tolerance for `&`, `<`, `>` characters
- Non-fatal parsing - continues even with partial failures
- Error nodes collected via `collectErrorNodes()` (lines 838-855)

---

## 3. Symbol Extraction System

### 3.1 Symbol Types Supported

| Symbol Kind | Description | Languages |
|-------------|-------------|-----------|
| `function` | Named function declarations | All |
| `arrow` | Arrow functions / lambdas | TS/JS/Python/Go/Rust/C#/Java |
| `class` | Class/struct/enum definitions | All |
| `method` | Class/instance methods | All |
| `variable` | Variables and constants | All |
| `interface` | Interface declarations | TS/Java/C#/PHP |
| `type` | Type aliases | TS |
| `enum` | Enum declarations | TS/Java/C#/Rust/PHP |

### 3.2 Query Categories (`queries/index.ts`)

```typescript
export interface LanguageQuerySet {
  functionDeclarations: string;      // All languages
  arrowFunctions: string;            // Most languages
  classDeclarations: string;         // All languages
  methodDefinitions: string;         // All languages
  variableDeclarations: string;    // All languages
  importDeclarations: string;        // All languages
  exportDeclarations: string;        // All languages
  callExpressions: string;           // All languages
  interfaceDeclarations?: string;   // TS/Java/C#
  typeAliasDeclarations?: string;   // TS
  enumDeclarations?: string;        // TS/Java/C#/Rust/PHP
  typeReferences?: string;           // TS
  classHeritage?: string;           // TS (extends/implements)
  jsxUsages?: string;               // TSX/JSX
  reExportDeclarations?: string;     // TS/JS
  decoratorQueries?: string;         // TS/Python/Java/Rust/C#/PHP
}
```

### 3.3 Parent-Child Resolution

**Language-Specific Parent Assignment (`parser.ts` lines 365-414):**

```typescript
export function assignParentNames(
  symbols: ParsedSymbol[],
  language: string,
  nodeMap?: Map<string, Parser.SyntaxNode>
): ParsedSymbol[] {
  if (language === "go") {
    // Extract receiver type from signature: func (t *Type) Method()
  }
  if (language === "rust") {
    // Extract impl type from parent impl_item node
  }
  // Generic: Find containing class by line range overlap
}
```

---

## 4. Graph Construction & Edge Types

### 4.1 Edge Type Taxonomy (`types.ts` lines 14-29)

| Edge Kind | Description | Synthesis Method |
|-----------|-------------|------------------|
| `import` | ES6/CommonJS/Go import edges | Static analysis |
| `call` | Function call relationships | Tree-sitter query |
| `dynamic_dispatch` | Event-driven connections | Regex pattern matching |
| `reexport` | Re-export relationships | Import analysis |
| `reference` | Symbol references | Static analysis |
| `type_usage` | Type annotations | Tree-sitter query |
| `inheritance` | Class extends | Tree-sitter query |
| `implements` | Interface implementation | Tree-sitter query |
| `jsx_render` | React component usage | Tree-sitter query |
| `framework_entry` | Framework routing | Framework plugins |
| `callback` | Callback props | Tree-sitter query |
| `server-action` | Next.js server actions | Directive detection |
| `route-handler` | Express/Django routes | Framework plugins |
| `event` | Event-driven edges | Synthesis (see §7) |

### 4.2 Edge Resolution Strategy (`indexer.ts` lines 401-680)

**Multi-Pass Resolution:**
1. **Import Resolution**: Resolve imports to symbol IDs via `resolveEdges()`
2. **Re-Export Chains**: Handle re-export indirection with caching
3. **Call Resolution**: Map call sites to target symbols
4. **Framework Resolution**: Plugin-based framework edge resolution
5. **Global Fallback**: Limited fallback to exported symbols by name

**Edge Limits:**
```typescript
const MAX_EDGE_TARGETS_PER_REFERENCE = 24;
const MAX_IMPORT_EDGE_SOURCES = 8;
const MAX_GLOBAL_FALLBACK_TARGETS = 12;
```

---

## 5. Framework Detection System

### 5.1 Supported Frameworks (12 Plugins)

| Framework | Plugin | Detection Method | Edge Type |
|-----------|--------|------------------|-----------|
| Next.js | `next.ts` | `fetch('/api/...')` | `next_fetch` |
| Express | `express.ts` | `app.get('/path', handler)` | `express_route` |
| Django | `django.ts` | `path('url', view)` | `django_url` |
| FastAPI | `fastapi.ts` | `@app.get('/path')` | `fastapi_route` |
| Flask | `flask.ts` | `@app.route('/path')` | `flask_route` |
| Spring | `spring.ts` | `@GetMapping('/path')` | `spring_mapping` |
| ASP.NET | `aspnet.ts` | Route attributes | `aspnet_route` |
| Rails | `rails.ts` | `get '/path'` | `rails_route` |
| Gin | `gin.ts` | `router.GET('/path', handler)` | `gin_route` |
| Axum | `axum.rs` | `.route("/path", get(handler))` | `axum_route` |
| Laravel | `laravel.ts` | `Route::get('/path')` | `laravel_route` |
| Convex | `convex.ts` | `useQuery(api.module.export)` | `convex_query/mutation/action` |
| Celery/Sidekiq | `celery-sidekiq.ts` | `@app.task`/`perform` | `celery_task`/`sidekiq_task` |

### 5.2 Plugin Architecture (`registry.ts`)

```typescript
interface FrameworkTracePlugin {
  id: string;
  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[];
  supports(call: ParsedFrameworkCall): boolean;
  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[];
}
```

---

## 6. Incremental Indexing & File Watching

### 6.1 File Watcher (`watcher.ts`)

**Technology:** `@parcel/watcher` v2.5.6

**Features:**
- Native platform support (14 platform binaries)
- Subscription-based event handling
- Ignore pattern support with glob patterns
- Queue-based change batching

**Handler Logic:**
```typescript
const subscription = await parcelWatcher.subscribe(
  projectRoot,
  (err, events) => {
    for (const event of events) {
      if (isIgnoreControlFile(event.path)) {
        scheduleFullReindex();  // Reindex on .gitignore change
        continue;
      }
      if (event.type === "delete") {
        handleRemove(event.path);
      } else {
        void handleChange(event.path);
      }
    }
  },
  { ignore: allIgnore.map((p) => `**/${p}/**`) }
);
```

### 6.2 Delta Updates (`indexer.ts` lines 281-364)

**Diff Algorithm:**
```typescript
interface IndexDiff {
  added: ParsedSymbol[];
  modified: Array<{ old: SymbolRecord; new: ParsedSymbol }>;
  deleted: SymbolRecord[];
  renamed: Array<{ old: SymbolRecord; new: ParsedSymbol }>;
  unchanged: SymbolRecord[];
}
```

**Key Features:**
- SHA-256 content hashing for change detection
- Symbol-level diffing via `symKey(name, kind)`
- Rename detection via body hash matching
- Transactional database updates

---

## 7. Edge Synthesis System

### 7.1 Synthesis Patterns (`event-edge-synthesis.ts`)

| Pattern | Languages | Detection Method |
|---------|-----------|----------------|
| Event Emitters/Listeners | JS/TS | `emit()`, `on()`, `addEventListener()` |
| HTTP Callers to API Routes | JS/TS | `fetch('/api/...')` → route handlers |
| Tauri Commands | JS/TS + Rust | `invoke('cmd')` → `#[tauri::command]` |
| Convex Calls | JS/TS | `useQuery(api.module.export)` → exports |
| WebSocket Methods | JS/TS | `request('method')` ↔ `case 'method':` |
| Go Channels | Go | `ch <- val` / `<-ch` patterns |
| Rust Tokio Channels | Rust | `.send()` / `.recv()` on mpsc channels |
| Django Signals | Python | `.send()` / `.connect()` / `@receiver` |
| C# Events | C# | `?.Invoke()` / `+=` subscription |

### 7.2 Synthesis Algorithm

```typescript
export function synthesizeEventEdges(db: Database.Database): number {
  // 1. Extract emitters/listeners by channel
  const emittersByChannel = new Map<string, number[]>();
  const listenersByChannel = new Map<string, number[]>();
  
  // 2. Scan all symbols with language-specific extractors
  for (const sym of allSymbols) {
    for (const channel of extractEventEmitters(source)) {
      // Bucket by normalized channel name
    }
  }
  
  // 3. Cross-product edge creation
  for (const [channel, emitterIds] of emittersByChannel) {
    const listenerIds = listenersByChannel.get(channel);
    if (!listenerIds) continue;
    for (const emitterId of emitterIds) {
      for (const listenerId of listenerIds) {
        pendingEdges.push({ sourceId: emitterId, targetId: listenerId, kind: "event" });
      }
    }
  }
}
```

---

## 8. Document Indexing

### 8.1 Document Symbol Construction (`parser.ts` lines 163-201)

```typescript
function buildDocumentSymbol(filePath: string, content: string, language: string): ParsedSymbol {
  // 1. Token limit: 6000 chars for source, 10 tokens for name, 24 for signature
  // 2. Markdown cleaning: Remove heading markers, blockquotes, list prefixes
  // 3. Tokenization: Split identifiers, deduplicate, filter short tokens
  // 4. Naming: Base name + unique body tokens
}
```

**Document Token Limits:**
```typescript
const DOCUMENT_SOURCE_LIMIT = 6000;
const DOCUMENT_NAME_TOKEN_LIMIT = 10;
const DOCUMENT_SIGNATURE_TOKEN_LIMIT = 24;
```

---

## 9. Error Handling

### 9.1 Parse Error Categories

| Category | Handling | Recovery |
|----------|----------|----------|
| Syntax Errors | Logged, file continues indexing | Partial AST used |
| Tree-sitter Query Failures | Debug log, non-fatal | Query skipped |
| File Read Errors | Logged, file skipped | File not indexed |
| Large Files (>5MB) | Skipped with error | Not indexed |
| TSX Benign Warnings | Filtered via `isBenignTsxParseWarning` | Continue indexing |
| Security Exclusions (.env, .pem) | Silently skipped | Not indexed |

### 9.2 Error Recovery Patterns

**Try-catch in query execution:**
```typescript
try {
  const query = new Parser.Query(lang, queryStr);
  const matches = query.matches(tree.rootNode);
  // ... process matches
} catch (err) {
  log.debug("query execution failed in parseSymbols", { kind, error: err.message });
  // Continue with other queries
}
```

---

## 10. Performance Optimizations

### 10.1 Worker Thread Architecture

```typescript
const WORKER_CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 1));
```

**Batching Strategy:**
- Files divided into `WORKER_CONCURRENCY` batches
- Each batch processed by a worker thread
- Worker script: `parser-worker.js` (falls back to main thread in dev)

### 10.2 Caching Systems

| Cache | Type | Purpose |
|-------|------|---------|
| `parserCache` | Map<string, Parser> | Reuse Tree-sitter parsers |
| `relativeImportCache` | Map<string, number[]> | Import resolution results |
| `fileRecordCache` | Map<number, FileRecord> | File metadata caching |
| `fileSymbolsCache` | Map<number, SymbolRecord[]> | Per-file symbol caching |
| `reExportCache` | Map<number, ReExportEntry[]> | Re-export parsing cache |
| `reExportResolutionCache` | Map<string, number[]> | Resolved re-export targets |
| `globalFallbackCache` | Map<string, number[]> | Global symbol lookups |
| `seenContentHashes` | Map<string, string> | Duplicate file detection |

### 10.3 Database Batching

```typescript
const CHUNK_SIZE = 400;        // SQL IN clause limits
const EDGE_CHUNK_SIZE = 500;   // Edge resolution batches
const CENTRALITY_UPDATE_BATCH_SIZE = 5000;  // PageRank updates
```

### 10.4 PageRank Computation (`graph.ts` lines 194-270)

**Compact Adjacency Representation:**
```typescript
interface CompactAdjacency {
  targets: Int32Array;    // All targets in one array
  offsets: Int32Array;    // Index offsets per node
  outDegree: Int32Array;  // Out-degree per node
}
```

**Parameters:**
- Damping factor: 0.85
- Max iterations: 50
- Convergence threshold: 1e-6
- Background worker support

---

## 11. Key Architectural Strengths

1. **Modular Query System**: Each language has isolated query definitions
2. **Incremental Updates**: Symbol-level diffing with rename detection
3. **Framework Agnostic**: Plugin-based framework detection
4. **Cross-Language Edges**: Unified graph across all supported languages
5. **Event Synthesis**: Runtime-independent event detection via patterns
6. **Worker Parallelization**: Multi-core file parsing
7. **Memory Efficient**: Streaming/chunked parsing for large files
8. **TSX Tolerance**: Special handling for JSX parse quirks

---

## 12. Potential Areas for Enhancement

1. **Language Coverage**: Kotlin, Swift, Scala, Erlang/Elixir missing
2. **Decorator Analysis**: Limited decorator argument parsing
3. **Generic Type Tracking**: Type parameters not fully resolved
4. **Macro Expansion**: Rust macros not expanded
5. **Conditional Compilation**: `#ifdef` regions in C/C++ not handled
6. **Import Graph Depth**: Limited re-export chain depth protection
7. **Worker Recovery**: Worker failure handling could be more robust

---

## 13. File Inventory

### Core Parser/Indexer Files (5)
- `src/core/parser.ts` (57KB) - Main parsing engine
- `src/core/indexer.ts` (57KB) - File indexing orchestration
- `src/core/graph.ts` (13KB) - Graph algorithms (PageRank, BFS)
- `src/core/watcher.ts` (6KB) - File watching with @parcel/watcher
- `src/core/event-edge-synthesis.ts` (9KB) - Synthetic edge detection

### Language Queries (15 files)
- `src/core/queries/index.ts` - Query registry
- `src/core/queries/typescript.ts` - TS/TSX
- `src/core/queries/javascript.ts` - JS/JSX
- `src/core/queries/python.ts` - Python
- `src/core/queries/go.ts` - Go
- `src/core/queries/rust.ts` - Rust
- `src/core/queries/java.ts` - Java
- `src/core/queries/c.ts` - C
- `src/core/queries/cpp.ts` - C++
- `src/core/queries/csharp.ts` - C#
- `src/core/queries/ruby.ts` - Ruby
- `src/core/queries/php.ts` - PHP
- `src/core/queries/bash.ts` - Bash

### Symbol Resolvers (9 files)
- `src/core/resolvers/index.ts` - Resolver registry
- `src/core/resolvers/python.ts` - Python import resolution
- `src/core/resolvers/go.ts` - Go module resolution
- `src/core/resolvers/rust.ts` - Rust crate resolution
- `src/core/resolvers/java.ts` - Java package resolution
- `src/core/resolvers/csharp.ts` - C# namespace resolution
- `src/core/resolvers/c.ts` - C include resolution
- `src/core/resolvers/ruby.ts` - Ruby require resolution
- `src/core/resolvers/php.ts` - PHP namespace resolution

### Framework Plugins (13 files)
- `src/frameworks/registry.ts` - Plugin registry
- `src/frameworks/plugins/next.ts` - Next.js
- `src/frameworks/plugins/express.ts` - Express.js
- `src/frameworks/plugins/django.ts` - Django
- `src/frameworks/plugins/fastapi.ts` - FastAPI
- `src/frameworks/plugins/flask.ts` - Flask
- `src/frameworks/plugins/spring.ts` - Spring Boot
- `src/frameworks/plugins/aspnet.ts` - ASP.NET Core
- `src/frameworks/plugins/rails.ts` - Ruby on Rails
- `src/frameworks/plugins/gin.ts` - Gin (Go)
- `src/frameworks/plugins/axum.ts` - Axum (Rust)
- `src/frameworks/plugins/laravel.ts` - Laravel (PHP)
- `src/frameworks/plugins/celery-sidekiq.ts` - Celery/Sidekiq

---

*Review completed: 2026-03-21*
*Total lines analyzed: ~150KB of source code*
