# ContextWeave — Full Implementation Plan (Sprints 1–4)

## Current State

- **Languages:** TypeScript, JavaScript, Python (just added)
- **Architecture:** TypeScript ESM, Node 22, tree-sitter, better-sqlite3, MCP SDK stdio
- **Tests:** 59 passing (vitest), unit + integration
- **Build:** tsup single-bundle ESM, native modules externalized

---

## Sprint 1 — Language Parity (8 remaining languages)

### Architecture Context

Adding a language requires exactly 4 changes:

1. **Install npm grammar package** (with `--legacy-peer-deps` due to existing peer dep mismatches)
2. **Create query file** at `src/core/queries/<lang>.ts`
3. **Register in `src/core/queries/index.ts`** (import + add to `queryRegistry`)
4. **Wire in `src/core/parser.ts`** (add to `languageModules` + `extensionToLanguage`)
5. **Add file extensions to `src/core/indexer.ts`** glob pattern
6. **Add to `tsup.config.ts`** external array (native modules must not be bundled)

### Pattern to Follow

Use `src/core/queries/python.ts` as the template. Every query file exports these named constants matching the `LanguageQuerySet` interface:

```typescript
// Required exports (all strings containing tree-sitter S-expression queries):
export const functionDeclarations: string;   // captures: @name, @definition
export const arrowFunctions: string;         // captures: @name, @value, @definition
export const classDeclarations: string;      // captures: @name, @definition
export const methodDefinitions: string;      // captures: @name, @definition
export const variableDeclarations: string;   // captures: @name, @value (optional), @definition
export const importDeclarations: string;     // captures: @source, @name, @definition
export const exportDeclarations: string;     // captures: @name, @definition
export const callExpressions: string;        // captures: @callee, @call

// Optional exports (TypeScript-only today):
export const interfaceDeclarations?: string;  // captures: @name, @definition
export const typeAliasDeclarations?: string;  // captures: @name, @definition
export const enumDeclarations?: string;       // captures: @name, @definition
export const typeReferences?: string;         // captures: @name, @reference
```

### Critical Parser Constraints

The parser in `src/core/parser.ts` has these behaviors that affect query design:

1. **Deduplication:** `parseSymbols()` uses a `seen` Set keyed on `defCapture.node.id`. If two queries capture the same AST node as `@definition`, only the first one wins. Query execution order: functionDeclarations → arrowFunctions → classDeclarations → methodDefinitions → variableDeclarations → (optional: interface, type, enum).

2. **Arrow detection:** The parser checks `valueCapture?.node.type === "arrow_function"` to reclassify variables as "arrow" kind. For non-JS/TS languages, this check is harmless (won't match).

3. **Export detection:** `isExported()` checks `parent.type === "export_statement"` (JS/TS) or `parent.type === "module"` (Python). For new languages, you must add their root node type or export wrapper type to this function.

4. **Function scope filtering:** `isFunctionScoped()` checks parent types to skip trivial local variables. Currently handles: `function_declaration`, `generator_function_declaration`, `function_expression`, `arrow_function`, `method_definition`, `function_definition`. Add new language function node types here.

5. **Signature extraction:** `buildSignature()` uses `node.childForFieldName("body")` to find where the signature ends. Works for any language where the function/class has a `body` field. For same-line bodies, it slices at `bodyChild.startPosition.column`.

6. **Import parsing:** `parseImports()` expects `@source`, `@name`, `@definition` captures. It strips quotes from `@source` text (`/^['"]|['"]$/g`). For languages without quoted import sources (like Python, Go, etc.), the source text passes through unchanged. The `import_clause` classification code (namespace/default/named) is JS/TS-specific — for other languages, `kind` defaults to `"named"`, which is acceptable.

7. **Call parsing:** `parseCalls()` scopes calls to within each symbol's line range. The `@callee` capture gives the function/method name.

### Languages — for languages that don't have a concept (like "arrow functions" in Go), provide a valid tree-sitter query that targets a rare or nonexistent node. The query MUST be syntactically valid for that language's grammar or `new Parser.Query()` will throw. Use a legitimate node type for that language that rarely appears as a top-level construct.

---

### 1.1 Go

**Package:** `tree-sitter-go@0.23.4` (peer dep: `tree-sitter@^0.21.1`, ABI-compatible with 0.22.4)

**Install:** `npm install tree-sitter-go@0.23.4 --legacy-peer-deps`

**Import:** `require("tree-sitter-go")` — exports Language directly, no sub-property

**Extensions:** `.go`

**Parser changes needed:**
- `languageModules`: `go: () => require("tree-sitter-go")`
- `extensionToLanguage`: `".go": "go"`
- `isFunctionScoped`: add `"function_declaration"` — already present; Go also uses this name. Also add `"method_declaration"`, `"func_literal"` (anonymous functions)
- `isExported`: Go's root is `"source_file"`. Add `if (parent.type === "source_file") return true;` — but Go actually uses capitalization for exports (uppercase = exported). For now, treat all top-level symbols as exported (same approach as Python); a later enhancement could check `name[0]` case.

**Query file:** `src/core/queries/go.ts`

```typescript
export const functionDeclarations = `
(function_declaration
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(short_var_declaration
  left: (expression_list
    (identifier) @name)
  right: (expression_list
    (func_literal) @value)) @definition
`;

export const classDeclarations = `
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (struct_type))) @definition

(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (interface_type))) @definition
`;

export const methodDefinitions = `
(method_declaration
  name: (field_identifier) @name) @definition
`;

export const variableDeclarations = `
(var_declaration
  (var_spec
    name: (identifier) @name
    value: (expression_list (_) @value))) @definition

(const_declaration
  (const_spec
    name: (identifier) @name)) @definition

(short_var_declaration
  left: (expression_list
    (identifier) @name)
  right: (expression_list
    (_) @value)) @definition
`;

export const importDeclarations = `
(import_declaration
  (import_spec
    path: (interpreted_string_literal) @source) @definition) @name

(import_declaration
  (import_spec_list
    (import_spec
      path: (interpreted_string_literal) @source
      name: (package_identifier) @name)) @definition)

(import_declaration
  (import_spec_list
    (import_spec
      path: (interpreted_string_literal) @source @name)) @definition)
`;

export const exportDeclarations = `
(function_declaration
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (selector_expression
    field: (field_identifier) @callee)) @call
`;
```

**IMPORTANT NOTE on Go imports:** Go's import paths are quoted strings (`"fmt"`, `"os/path"`). The parser's `replace(/^['"]|['"]$/g, "")` strip will remove the quotes correctly. The `@name` capture for import names is tricky — Go imports by package path, not by individual symbol. The imported name is either the last segment of the path or an explicit alias. For edge resolution, the source text (minus quotes) is what matters. The import queries above may need iteration — test against real Go code to verify captures match. If `import_spec` without a `name:` field (no alias) doesn't provide `@name`, you'll need to add a pattern that captures the `interpreted_string_literal` as both `@source` and `@name`.

---

### 1.2 Rust

**Package:** `tree-sitter-rust@0.24.0` (peer dep: `tree-sitter@^0.22.1`, satisfies 0.22.4)

**Install:** `npm install tree-sitter-rust@0.24.0 --legacy-peer-deps`

**Import:** `require("tree-sitter-rust")` — exports Language directly

**Extensions:** `.rs`

**Parser changes needed:**
- `languageModules`: `rust: () => require("tree-sitter-rust")`
- `extensionToLanguage`: `".rs": "rust"`
- `isFunctionScoped`: add `"function_item"`, `"closure_expression"`
- `isExported`: Rust's root is `"source_file"`. Rust uses `pub` keyword for visibility. For now, treat all top-level symbols as exported. In Rust, the `pub` keyword is a child node `visibility_modifier` — a future enhancement could check for it.

**Query file:** `src/core/queries/rust.ts`

```typescript
export const functionDeclarations = `
(function_item
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(let_declaration
  pattern: (identifier) @name
  value: (closure_expression) @value) @definition
`;

export const classDeclarations = `
(struct_item
  name: (type_identifier) @name) @definition

(enum_item
  name: (type_identifier) @name) @definition

(trait_item
  name: (type_identifier) @name) @definition

(impl_item
  type: (type_identifier) @name) @definition

(union_item
  name: (type_identifier) @name) @definition
`;

export const methodDefinitions = `
(impl_item
  body: (declaration_list
    (function_item
      name: (identifier) @name) @definition))
`;

export const variableDeclarations = `
(let_declaration
  pattern: (identifier) @name
  value: (_) @value) @definition

(const_item
  name: (identifier) @name
  value: (_) @value) @definition

(static_item
  name: (identifier) @name
  value: (_) @value) @definition
`;

export const importDeclarations = `
(use_declaration
  argument: (scoped_identifier
    name: (identifier) @name
    path: (identifier) @source)) @definition

(use_declaration
  argument: (scoped_identifier
    name: (identifier) @name
    path: (scoped_identifier) @source)) @definition

(use_declaration
  argument: (identifier) @name @source) @definition

(use_declaration
  argument: (use_as_clause
    path: (scoped_identifier) @source
    alias: (identifier) @name)) @definition
`;

export const exportDeclarations = `
(function_item
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (field_expression
    field: (field_identifier) @callee)) @call

(call_expression
  function: (scoped_identifier
    name: (identifier) @callee)) @call

(macro_invocation
  macro: (identifier) @callee) @call
`;
```

**IMPORTANT NOTE on Rust imports:** Rust's `use` syntax is complex (`use std::collections::HashMap`, `use crate::{foo, bar}`, `use super::*`). The `scoped_identifier` node handles most cases. The `use_list` (curly-brace group imports) may need additional patterns — test with `use std::{io, fs}` to see if `use_list` children need separate captures. The `use_wildcard` (`use foo::*`) should be skipped (no meaningful @name).

**IMPORTANT NOTE on Rust methods:** Methods inside `impl` blocks use the same `function_item` node type as top-level functions. The `methodDefinitions` query captures them inside `impl_item > declaration_list`, but since `functionDeclarations` runs first in the parser, these will be classified as "function" not "method" (same dedup behavior as Python). This is acceptable.

---

### 1.3 Java

**Package:** `tree-sitter-java@0.23.5` (peer dep: `tree-sitter@^0.21.1`)

**Install:** `npm install tree-sitter-java@0.23.5 --legacy-peer-deps`

**Import:** `require("tree-sitter-java")` — exports Language directly

**Extensions:** `.java`

**Parser changes needed:**
- `languageModules`: `java: () => require("tree-sitter-java")`
- `extensionToLanguage`: `".java": "java"`
- `isFunctionScoped`: add `"method_declaration"` — already present as `"method_definition"` for JS; Java uses `"method_declaration"`. Add `"constructor_declaration"`, `"lambda_expression"`
- `isExported`: Java's root is `"program"` — same as JS/TS. But in Java, all top-level class members are accessible. Add `"class_body"` check: `if (parent.type === "class_body") return true;`. Actually, Java public/private is complex. Simplest: treat all symbols as exported for now.

**Query file:** `src/core/queries/java.ts`

```typescript
export const functionDeclarations = `
(method_declaration
  name: (identifier) @name) @definition

(constructor_declaration
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(local_variable_declaration
  declarator: (variable_declarator
    name: (identifier) @name
    value: (lambda_expression) @value)) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (identifier) @name) @definition

(interface_declaration
  name: (identifier) @name) @definition

(enum_declaration
  name: (identifier) @name) @definition

(record_declaration
  name: (identifier) @name) @definition

(annotation_type_declaration
  name: (identifier) @name) @definition
`;

export const methodDefinitions = `
(class_body
  (method_declaration
    name: (identifier) @name) @definition)
`;

export const variableDeclarations = `
(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name
    value: (_) @value)) @definition

(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition

(constant_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition
`;

export const importDeclarations = `
(import_declaration
  (scoped_identifier
    name: (identifier) @name
    scope: (_) @source)) @definition
`;

export const exportDeclarations = `
(class_declaration
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(method_invocation
  name: (identifier) @callee) @call

(object_creation_expression
  type: (type_identifier) @callee) @call
`;

export const interfaceDeclarations = `
(interface_declaration
  name: (identifier) @name) @definition
`;

export const enumDeclarations = `
(enum_declaration
  name: (identifier) @name) @definition
`;
```

**IMPORTANT NOTE on Java calls:** Java uses `method_invocation` not `call_expression`. Constructor calls use `object_creation_expression` with `new Foo()`. Static method calls use `method_invocation` with an object qualifier. The `@callee` capture on `method_invocation > name` gives the method name (e.g., `println` from `System.out.println()`).

**IMPORTANT NOTE on Java imports:** Java's `import java.util.HashMap` has a `scoped_identifier` with nested scopes. The @source capture on `scope` may give `java.util` and @name gives `HashMap`. Test with real Java code to verify. Star imports (`import java.util.*`) use `asterisk` node, not `identifier` — they won't match @name and will be silently skipped.

---

### 1.4 C

**Package:** `tree-sitter-c@0.24.1` (peer dep: `tree-sitter@^0.22.4`, exact match)

**Install:** `npm install tree-sitter-c@0.24.1 --legacy-peer-deps`

**Import:** `require("tree-sitter-c")` — exports Language directly

**Extensions:** `.c`, `.h`

**Parser changes needed:**
- `languageModules`: `c: () => require("tree-sitter-c")`
- `extensionToLanguage`: `".c": "c"`, `".h": "c"`
- `isFunctionScoped`: C uses `"function_definition"` — already added for Python
- `isExported`: C's root is `"translation_unit"`. Add `if (parent.type === "translation_unit") return true;` (all top-level C symbols are globally visible by default).

**Query file:** `src/core/queries/c.ts`

```typescript
export const functionDeclarations = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition
`;

export const arrowFunctions = `
(declaration
  declarator: (init_declarator
    declarator: (identifier) @name
    value: (compound_literal_expression) @value)) @definition
`;

export const classDeclarations = `
(struct_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(union_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(enum_specifier
  name: (type_identifier) @name
  body: (enumerator_list)) @definition

(type_definition
  declarator: (type_identifier) @name) @definition
`;

export const methodDefinitions = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition
`;

export const variableDeclarations = `
(declaration
  declarator: (init_declarator
    declarator: (identifier) @name
    value: (_) @value)) @definition

(declaration
  declarator: (identifier) @name) @definition
`;

export const importDeclarations = `
(preproc_include
  path: (string_literal) @source @name) @definition

(preproc_include
  path: (system_lib_string) @source @name) @definition
`;

export const exportDeclarations = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (field_expression
    field: (field_identifier) @callee)) @call
`;
```

**IMPORTANT NOTE on C:** C has no methods, classes, or modules. Structs/unions/enums use `_specifier` node types. `#include` is `preproc_include` with either `string_literal` (`"header.h"`) or `system_lib_string` (`<stdio.h>`). The quotes/angle brackets will be stripped by the parser's regex. `typedef` uses `type_definition`. Function pointers in declarations (`void (*callback)(int)`) have complex declarators — skip these for now.

**IMPORTANT NOTE on C headers:** `.h` files are mapped to language `"c"`. If the project has C++ headers using `.h`, they'll be parsed as C, which may miss C++-specific constructs. This is acceptable — `.hpp`/`.hxx` will map to C++ when added.

---

### 1.5 C++

**Package:** `tree-sitter-cpp@0.23.4` (peer dep: `tree-sitter@^0.21.1`)

**Install:** `npm install tree-sitter-cpp@0.23.4 --legacy-peer-deps`

**Import:** `require("tree-sitter-cpp")` — exports Language directly

**Extensions:** `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.hh`

**Parser changes needed:**
- `languageModules`: `cpp: () => require("tree-sitter-cpp")`
- `extensionToLanguage`: `".cpp": "cpp"`, `".cc": "cpp"`, `".cxx": "cpp"`, `".hpp": "cpp"`, `".hxx": "cpp"`, `".hh": "cpp"`
- `isFunctionScoped`: C++ uses `"function_definition"` — already present. Also add `"lambda_expression"`
- `isExported`: C++'s root is `"translation_unit"` — same as C. Add the same check if not already done in the C step.

**Query file:** `src/core/queries/cpp.ts`

```typescript
export const functionDeclarations = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition

(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier
      name: (identifier) @name))) @definition
`;

export const arrowFunctions = `
(declaration
  declarator: (init_declarator
    declarator: (identifier) @name
    value: (lambda_expression) @value)) @definition
`;

export const classDeclarations = `
(class_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(struct_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition

(enum_specifier
  name: (type_identifier) @name
  body: (enumerator_list)) @definition

(namespace_definition
  name: (namespace_identifier) @name) @definition
`;

export const methodDefinitions = `
(class_specifier
  body: (field_declaration_list
    (function_definition
      declarator: (function_declarator
        declarator: (field_identifier) @name)) @definition))
`;

export const variableDeclarations = `
(declaration
  declarator: (init_declarator
    declarator: (identifier) @name
    value: (_) @value)) @definition

(declaration
  declarator: (identifier) @name) @definition
`;

export const importDeclarations = `
(preproc_include
  path: (string_literal) @source @name) @definition

(preproc_include
  path: (system_lib_string) @source @name) @definition

(using_declaration
  (qualified_identifier) @source @name) @definition
`;

export const exportDeclarations = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition
`;

export const callExpressions = `
(call_expression
  function: (identifier) @callee) @call

(call_expression
  function: (field_expression
    field: (field_identifier) @callee)) @call

(call_expression
  function: (qualified_identifier
    name: (identifier) @callee)) @call

(call_expression
  function: (template_function
    name: (identifier) @callee)) @call
`;
```

**IMPORTANT NOTE on C++:** C++ inherits from C's grammar but adds classes, namespaces, templates, and lambdas. `class_specifier` (not `class_declaration`) is the C++ node type. Methods declared inside class bodies use `function_definition` with `field_identifier` names (not regular `identifier`). Out-of-class method implementations use `qualified_identifier` (`ClassName::methodName`). Template function calls use `template_function`. `using_declaration` handles `using std::string;`.

---

### 1.6 C#

**Package:** `tree-sitter-c-sharp@0.23.1` (peer dep: `tree-sitter@^0.21.1`)

**Install:** `npm install tree-sitter-c-sharp@0.23.1 --legacy-peer-deps`

**Import:** `require("tree-sitter-c-sharp")` — exports Language directly

**Extensions:** `.cs`

**Parser changes needed:**
- `languageModules`: `csharp: () => require("tree-sitter-c-sharp")`
- `extensionToLanguage`: `".cs": "csharp"`
- `isFunctionScoped`: add `"method_declaration"` — already present as `"method_definition"` for JS (different name). Also add `"constructor_declaration"`, `"local_function_statement"`, `"anonymous_method_expression"`, `"lambda_expression"`
- `isExported`: C#'s root is `"compilation_unit"`. Add `if (parent.type === "compilation_unit") return true;`

**Query file:** `src/core/queries/csharp.ts`

```typescript
export const functionDeclarations = `
(method_declaration
  name: (identifier) @name) @definition

(constructor_declaration
  name: (identifier) @name) @definition

(local_function_statement
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(variable_declaration
  (variable_declarator
    (identifier) @name
    (equals_value_clause
      (lambda_expression) @value))) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (identifier) @name) @definition

(struct_declaration
  name: (identifier) @name) @definition

(interface_declaration
  name: (identifier) @name) @definition

(enum_declaration
  name: (identifier) @name) @definition

(record_declaration
  name: (identifier) @name) @definition

(namespace_declaration
  name: (identifier) @name) @definition
`;

export const methodDefinitions = `
(class_declaration
  body: (declaration_list
    (method_declaration
      name: (identifier) @name) @definition))
`;

export const variableDeclarations = `
(field_declaration
  (variable_declaration
    (variable_declarator
      (identifier) @name))) @definition

(property_declaration
  name: (identifier) @name) @definition

(event_field_declaration
  (variable_declaration
    (variable_declarator
      (identifier) @name))) @definition
`;

export const importDeclarations = `
(using_directive
  (identifier) @source @name) @definition

(using_directive
  (qualified_name) @source @name) @definition
`;

export const exportDeclarations = `
(class_declaration
  name: (identifier) @name) @definition
`;

export const callExpressions = `
(invocation_expression
  function: (identifier) @callee) @call

(invocation_expression
  function: (member_access_expression
    name: (identifier) @callee)) @call

(object_creation_expression
  type: (identifier) @callee) @call
`;

export const interfaceDeclarations = `
(interface_declaration
  name: (identifier) @name) @definition
`;

export const enumDeclarations = `
(enum_declaration
  name: (identifier) @name) @definition
`;
```

**IMPORTANT NOTE on C#:** C# uses `invocation_expression` (not `call_expression`). `member_access_expression` handles `obj.Method()`. `object_creation_expression` handles `new Foo()`. Properties are first-class and captured via `property_declaration`. C# namespaces can be file-scoped (`file_scoped_namespace_declaration` in C# 10+) — add that pattern if supporting modern C#.

---

### 1.7 Ruby

**Package:** `tree-sitter-ruby@0.23.1` (peer dep: `tree-sitter@^0.21.1`)

**Install:** `npm install tree-sitter-ruby@0.23.1 --legacy-peer-deps`

**Import:** `require("tree-sitter-ruby")` — exports Language directly

**Extensions:** `.rb`, `.rake`

**Parser changes needed:**
- `languageModules`: `ruby: () => require("tree-sitter-ruby")`
- `extensionToLanguage`: `".rb": "ruby"`, `".rake": "ruby"`
- `isFunctionScoped`: add `"method"`, `"singleton_method"`, `"do_block"`, `"block"`, `"lambda"`
- `isExported`: Ruby's root is `"program"` — same as JS/TS, but JS returns false for this. Need special handling: `if (parent.type === "program" && language === "ruby")` — but `isExported()` doesn't receive language. Simplest fix: just add `"program"` to the "return true" list alongside `"module"`. This would also make JS/TS top-level symbols exported, which changes behavior. **ALTERNATIVE:** Since Ruby has no export keyword, just leave it as-is (all Ruby symbols will be non-exported). The export bonus is small (controlled by `exportBonus` weight in scorer). This is the safer approach.

**Query file:** `src/core/queries/ruby.ts`

```typescript
export const functionDeclarations = `
(method
  name: (identifier) @name) @definition

(singleton_method
  name: (identifier) @name) @definition
`;

export const arrowFunctions = `
(assignment
  left: (identifier) @name
  right: (lambda) @value) @definition
`;

export const classDeclarations = `
(class
  name: (constant) @name) @definition

(module
  name: (constant) @name) @definition

(singleton_class
  value: (_) @name) @definition
`;

export const methodDefinitions = `
(class
  body: (body_statement
    (method
      name: (identifier) @name) @definition))
`;

export const variableDeclarations = `
(assignment
  left: (identifier) @name
  right: (_) @value) @definition

(assignment
  left: (constant) @name
  right: (_) @value) @definition
`;

export const importDeclarations = `
(call
  method: (identifier) @_method
  arguments: (argument_list
    (string
      (string_content) @source @name))
  (#eq? @_method "require")) @definition

(call
  method: (identifier) @_method
  arguments: (argument_list
    (string
      (string_content) @source @name))
  (#eq? @_method "require_relative")) @definition
`;

export const exportDeclarations = `
(call
  method: (identifier) @_method
  arguments: (argument_list
    (constant) @name)
  (#eq? @_method "include")) @definition
`;

export const callExpressions = `
(call
  method: (identifier) @callee) @call

(call
  receiver: (_)
  method: (identifier) @callee) @call
`;
```

**IMPORTANT NOTE on Ruby node types:** Ruby uses bare names — `method` not `method_declaration`, `class` not `class_declaration`, `module` not `module_definition`. This is unique among all languages.

**IMPORTANT NOTE on Ruby imports:** Ruby's `require "foo"` and `require_relative "./bar"` parse as `call` nodes with method name `require`/`require_relative`. The `#eq?` predicate in tree-sitter queries filters by method name. The source is the string argument content. This approach using `#eq?` predicates may need testing — verify that `tree-sitter@0.22.4` supports `#eq?` in query predicates. If not supported, remove the `#eq?` lines and handle filtering in the parser code instead.

**IMPORTANT NOTE on Ruby `module` conflict:** Ruby uses `module` as an AST node type name, which conflicts with Python's `module` (the root node). Currently `isExported()` has `if (parent.type === "module") return true;`. For Ruby, a symbol inside a `module` block would have parent type `body_statement` → `module`, and `isExported` would recurse up and hit `module` → return true. This is actually correct behavior for Ruby (module members are public by default), so the existing code works.

---

### 1.8 Bash

**Package:** `tree-sitter-bash@0.23.3` (peer dep: `tree-sitter@^0.21.1`)

**Install:** `npm install tree-sitter-bash@0.23.3 --legacy-peer-deps`

**Import:** `require("tree-sitter-bash")` — exports Language directly

**Extensions:** `.sh`, `.bash`

**Parser changes needed:**
- `languageModules`: `bash: () => require("tree-sitter-bash")`
- `extensionToLanguage`: `".sh": "bash"`, `".bash": "bash"`
- `isFunctionScoped`: add `"function_definition"` — already present for Python
- `isExported`: Bash's root is `"program"` — same issue as Ruby. Leave as-is (bash symbols won't get export bonus). This is acceptable since bash scripts rarely need export-based scoring.

**Query file:** `src/core/queries/bash.ts`

```typescript
export const functionDeclarations = `
(function_definition
  name: (word) @name) @definition
`;

export const arrowFunctions = `
(variable_assignment
  name: (variable_name) @name
  value: (_) @value) @definition
`;

export const classDeclarations = `
(function_definition
  name: (word) @name) @definition
`;

export const methodDefinitions = `
(function_definition
  name: (word) @name) @definition
`;

export const variableDeclarations = `
(variable_assignment
  name: (variable_name) @name
  value: (_) @value) @definition

(declaration_command
  (variable_assignment
    name: (variable_name) @name
    value: (_) @value)) @definition
`;

export const importDeclarations = `
(command
  name: (command_name) @_cmd
  argument: (word) @source @name
  (#eq? @_cmd "source")) @definition

(command
  name: (command_name) @_cmd
  argument: (word) @source @name
  (#eq? @_cmd ".")) @definition
`;

export const exportDeclarations = `
(declaration_command
  (variable_assignment
    name: (variable_name) @name)) @definition
`;

export const callExpressions = `
(command
  name: (command_name) @callee) @call
`;
```

**IMPORTANT NOTE on Bash:** Bash is minimal — no classes, no methods, no modules. `function_definition` handles both `function foo { }` and `foo() { }` syntax. Variables use `variable_assignment` with `variable_name` (includes the `$` prefix in some contexts). `command` is the universal call node — every external command, built-in, and function call is a `command`. `source` and `.` (dot-source) are parsed as `command` nodes. `declaration_command` wraps `declare`, `export`, `local`, `readonly`.

**IMPORTANT NOTE:** Since Bash duplicates `functionDeclarations` in `classDeclarations` and `methodDefinitions`, the dedup via `seen` will prevent double-counting. This is intentional — Bash has no classes or methods, so those queries just need to be valid.

---

### 1.9 PHP

**Package:** `tree-sitter-php@0.24.2` (peer dep: `tree-sitter@^0.22.4`, exact match)

**Install:** `npm install tree-sitter-php@0.24.2 --legacy-peer-deps`

**Import:** `require("tree-sitter-php").php` — **DUAL EXPORT** like tree-sitter-typescript. Uses `.php` sub-property for full PHP (handles `<?php` tags). Alternatively `.php_only` for pure PHP without HTML embedding.

**Extensions:** `.php`

**Parser changes needed:**
- `languageModules`: `php: () => require("tree-sitter-php").php`
- `extensionToLanguage`: `".php": "php"`
- `isFunctionScoped`: add `"method_declaration"` (already covered by JS check for `"method_definition"`? No — PHP uses `method_declaration`, different name). Also add `"anonymous_function_creation_expression"`, `"arrow_function"`
- `isExported`: PHP's root is `"program"` — same issue as Ruby/Bash. Leave as-is.

**Query file:** `src/core/queries/php.ts`

```typescript
export const functionDeclarations = `
(function_definition
  name: (name) @name) @definition
`;

export const arrowFunctions = `
(expression_statement
  (assignment_expression
    left: (variable_name) @name
    right: (arrow_function) @value)) @definition
`;

export const classDeclarations = `
(class_declaration
  name: (name) @name) @definition

(interface_declaration
  name: (name) @name) @definition

(trait_declaration
  name: (name) @name) @definition

(enum_declaration
  name: (name) @name) @definition

(namespace_definition
  name: (namespace_name) @name) @definition
`;

export const methodDefinitions = `
(class_declaration
  body: (declaration_list
    (method_declaration
      name: (name) @name) @definition))
`;

export const variableDeclarations = `
(const_declaration
  (const_element
    name: (name) @name
    value: (_) @value)) @definition

(property_declaration
  (property_element
    (variable_name) @name)) @definition

(expression_statement
  (assignment_expression
    left: (variable_name) @name
    right: (_) @value)) @definition
`;

export const importDeclarations = `
(namespace_use_declaration
  (namespace_use_clause
    (qualified_name) @source @name)) @definition

(namespace_use_declaration
  (namespace_use_group
    (namespace_use_clause
      (namespace_name) @name))
  prefix: (namespace_name) @source) @definition
`;

export const exportDeclarations = `
(class_declaration
  name: (name) @name) @definition
`;

export const callExpressions = `
(function_call_expression
  function: (name) @callee) @call

(function_call_expression
  function: (qualified_name) @callee) @call

(member_call_expression
  name: (name) @callee) @call

(scoped_call_expression
  name: (name) @callee) @call

(nullsafe_member_call_expression
  name: (name) @callee) @call
`;

export const interfaceDeclarations = `
(interface_declaration
  name: (name) @name) @definition
`;

export const enumDeclarations = `
(enum_declaration
  name: (name) @name) @definition
`;
```

**IMPORTANT NOTE on PHP calls:** PHP has 5 different call types: `function_call_expression` (standalone), `member_call_expression` (`$obj->method()`), `scoped_call_expression` (`Class::method()`), `nullsafe_member_call_expression` (`$obj?->method()`). All need separate patterns.

**IMPORTANT NOTE on PHP dual export:** `tree-sitter-php` exports `.php` (with `<?php` tag handling) and `.php_only` (pure PHP). Use `.php` for real-world files that start with `<?php`. If `.php` causes issues with files that don't have the opening tag, switch to `.php_only`.

---

### Shared Parser Changes (all languages)

After adding all 8 languages, `src/core/parser.ts` needs these cumulative changes:

#### `languageModules` (add 8 entries):
```typescript
const languageModules: Record<string, () => Parser.Language> = {
  typescript: () => require("tree-sitter-typescript").typescript,
  tsx: () => require("tree-sitter-typescript").tsx,
  javascript: () => require("tree-sitter-javascript"),
  jsx: () => require("tree-sitter-javascript"),
  python: () => require("tree-sitter-python"),
  go: () => require("tree-sitter-go"),
  rust: () => require("tree-sitter-rust"),
  java: () => require("tree-sitter-java"),
  c: () => require("tree-sitter-c"),
  cpp: () => require("tree-sitter-cpp"),
  csharp: () => require("tree-sitter-c-sharp"),
  ruby: () => require("tree-sitter-ruby"),
  bash: () => require("tree-sitter-bash"),
  php: () => require("tree-sitter-php").php,
};
```

#### `extensionToLanguage` (add all new extensions):
```typescript
const extensionToLanguage: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".hh": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".rake": "ruby",
  ".sh": "bash",
  ".bash": "bash",
  ".php": "php",
};
```

#### `isExported()` — add root node types:
```typescript
function isExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "export_statement") return true;
  // Language root nodes where top-level = exported:
  if (parent.type === "module") return true;           // Python
  if (parent.type === "source_file") return true;      // Go, Rust
  if (parent.type === "translation_unit") return true;  // C, C++
  if (parent.type === "compilation_unit") return true;  // C#
  if (parent.type === "program") return false;          // JS/TS (NOT exported unless in export_statement)
  return isExported(parent);
}
```

**CRITICAL:** `"program"` must remain `return false` for JS/TS backward compatibility. Ruby, Bash, PHP, and Java all use `"program"` as root — they will NOT get export bonus. This is acceptable and safe. Making `"program"` return true would break JS/TS export detection.

#### `isFunctionScoped()` — add language-specific function node types:
```typescript
function isFunctionScoped(node: Parser.SyntaxNode): boolean {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === "function_declaration" ||
      current.type === "generator_function_declaration" ||
      current.type === "function_expression" ||
      current.type === "arrow_function" ||
      current.type === "method_definition" ||
      current.type === "function_definition" ||    // Python, C, C++, Bash
      current.type === "method_declaration" ||      // Java, C#, PHP
      current.type === "constructor_declaration" || // Java, C#
      current.type === "func_literal" ||            // Go (anonymous functions)
      current.type === "function_item" ||           // Rust
      current.type === "closure_expression" ||      // Rust
      current.type === "lambda_expression" ||       // Java, C#, C++
      current.type === "lambda" ||                  // Ruby
      current.type === "method" ||                  // Ruby
      current.type === "singleton_method" ||        // Ruby
      current.type === "anonymous_function_creation_expression" // PHP
    ) {
      return true;
    }
    if (
      current.type === "program" ||
      current.type === "module" ||
      current.type === "source_file" ||
      current.type === "translation_unit" ||
      current.type === "compilation_unit"
    ) return false;
    current = current.parent;
  }
  return false;
}
```

#### `indexer.ts` glob pattern:
```typescript
const pattern = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,c,h,cpp,cc,cxx,hpp,hxx,hh,cs,rb,rake,sh,bash,php}";
```

#### `tsup.config.ts` externals:
```typescript
external: [
  "better-sqlite3",
  "tree-sitter",
  "tree-sitter-typescript",
  "tree-sitter-javascript",
  "tree-sitter-python",
  "tree-sitter-go",
  "tree-sitter-rust",
  "tree-sitter-java",
  "tree-sitter-c",
  "tree-sitter-cpp",
  "tree-sitter-c-sharp",
  "tree-sitter-ruby",
  "tree-sitter-bash",
  "tree-sitter-php",
],
```

#### `queries/index.ts`:
```typescript
import * as tsQueries from "./typescript.js";
import * as jsQueries from "./javascript.js";
import * as pyQueries from "./python.js";
import * as goQueries from "./go.js";
import * as rustQueries from "./rust.js";
import * as javaQueries from "./java.js";
import * as cQueries from "./c.js";
import * as cppQueries from "./cpp.js";
import * as csharpQueries from "./csharp.js";
import * as rubyQueries from "./ruby.js";
import * as bashQueries from "./bash.js";
import * as phpQueries from "./php.js";

const queryRegistry: Record<string, LanguageQuerySet> = {
  typescript: tsQueries,
  tsx: tsQueries,
  javascript: jsQueries,
  jsx: jsQueries,
  python: pyQueries,
  go: goQueries,
  rust: rustQueries,
  java: javaQueries,
  c: cQueries,
  cpp: cppQueries,
  csharp: csharpQueries,
  ruby: rubyQueries,
  bash: bashQueries,
  php: phpQueries,
};
```

### Testing Strategy for Sprint 1

For each language:
1. Create a fixture file at `tests/fixtures/sample.<ext>` with representative code covering functions, classes/structs, variables, imports, and calls
2. Add a test in `tests/unit/parser.test.ts` that:
   - Verifies `detectLanguage("file.<ext>")` returns the correct language
   - Parses the fixture and checks symbol count > 0
   - Verifies at least one function, one class/struct, one import, and one call are captured
3. Update the "returns null for unknown extensions" test to remove newly-supported extensions

Example fixture for Go (`tests/fixtures/sample.go`):
```go
package main

import (
    "fmt"
    "os"
)

type UserService struct {
    DB *Database
}

func (s *UserService) GetUser(id int) (*User, error) {
    return s.DB.Query(id)
}

func NewUserService(db *Database) *UserService {
    return &UserService{DB: db}
}

var MaxRetries = 3
```

---

## Sprint 2 — Performance Fixes

### 2.1 PageRank O(n²) Dangling Node Fix

**File:** `src/core/graph.ts`, lines 94–101

**Current code (O(n²)):**
```typescript
for (let i = 0; i < n; i++) {
  const links = outLinks.get(i);
  if (!links || links.length === 0) {
    const share = ranks[i]! / n;
    for (let j = 0; j < n; j++) {           // <-- inner O(n) loop per dangling node
      newRanks[j] = newRanks[j]! + DAMPING * share;
    }
    continue;
  }
  // ... distribute to outlinks
}
```

**Fix (O(n)):** Accumulate total dangling mass in a single scalar, then distribute evenly in one pass:

```typescript
// Before the main loop, compute dangling mass
let danglingSum = 0;
for (let i = 0; i < n; i++) {
  const links = outLinks.get(i);
  if (!links || links.length === 0) {
    danglingSum += ranks[i]!;
  }
}
const danglingContribution = DAMPING * danglingSum / n;

// In the main iteration:
newRanks.fill((1 - DAMPING) / n + danglingContribution);  // base + dangling in one shot

for (let i = 0; i < n; i++) {
  const links = outLinks.get(i);
  if (!links || links.length === 0) continue;  // skip danglers (already handled)

  const share = ranks[i]! / links.length;
  for (const target of links) {
    newRanks[target] = newRanks[target]! + DAMPING * share;
  }
}
```

**Impact:** For a codebase with 5000 symbols where 3000 are dangling (leaf functions, constants), this reduces from 3000 * 5000 = 15M iterations to 5000 iterations per PageRank pass.

### 2.2 PageRank `getAll()` Projection Query

**File:** `src/core/graph.ts`, line 68 + `src/db/queries/symbols.ts`

**Current:** `symbols.getAll()` runs `SELECT * FROM symbols`, loading `full_source` TEXT for every symbol into JS heap. PageRank only needs `id`.

**Fix:**
1. Add a new query method to `src/db/queries/symbols.ts`:
```typescript
const getAllIds = db.prepare("SELECT id FROM symbols");

getAllIds(): number[] {
  return getAllIds.all().map((r) => (r as { id: number }).id);
}
```

2. In `computePageRank()`, replace `symbols.getAll()` with `symbols.getAllIds()`:
```typescript
const symbolIds = symbols.getAllIds();
const n = symbolIds.length;
const idToIndex = new Map(symbolIds.map((id, i) => [id, i]));
```

**Impact:** For 5000 symbols averaging 500 chars of source, this reduces memory from ~2.5MB of string allocation to ~40KB of integer IDs.

### 2.3 BFS Preloaded Adjacency Map

**Files:** `src/capsule/generator.ts` (lines 186–188, 230–232) and `src/core/graph.ts` (lines 35–36)

**Current:** Both BFS implementations issue 2 SQLite queries per dequeued node:
```typescript
const outEdges = edges.getBySource(id);   // SELECT * FROM edges WHERE source_symbol_id = ?
const inEdges = edges.getByTarget(id);    // SELECT * FROM edges WHERE target_symbol_id = ?
```

At BFS depth 5 with 1000 visited nodes, that's 2000 synchronous SQLite round-trips per capsule generation.

**Fix:** Load ALL edges once before BFS and build an in-memory adjacency map:

1. Add a helper function (could go in `src/core/graph.ts` or a new `src/utils/adjacency.ts`):
```typescript
export interface AdjacencyMap {
  outgoing: Map<number, number[]>;   // symbolId -> [targetSymbolIds]
  incoming: Map<number, number[]>;   // symbolId -> [sourceSymbolIds]
  degree: Map<number, number>;       // symbolId -> total degree
}

export function buildAdjacencyMap(db: Database.Database): AdjacencyMap {
  const allEdges = edgeQueries(db).getAll();
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  const degree = new Map<number, number>();

  for (const edge of allEdges) {
    const out = outgoing.get(edge.sourceSymbolId) ?? [];
    out.push(edge.targetSymbolId);
    outgoing.set(edge.sourceSymbolId, out);

    const inc = incoming.get(edge.targetSymbolId) ?? [];
    inc.push(edge.sourceSymbolId);
    incoming.set(edge.targetSymbolId, inc);

    degree.set(edge.sourceSymbolId, (degree.get(edge.sourceSymbolId) ?? 0) + 1);
    degree.set(edge.targetSymbolId, (degree.get(edge.targetSymbolId) ?? 0) + 1);
  }

  return { outgoing, incoming, degree };
}
```

2. In `generateCapsule()`, call `buildAdjacencyMap(db)` once before the BFS loop, then replace all `edges.getBySource(id)` / `edges.getByTarget(id)` calls with map lookups.

3. In `bfsTraversal()` (graph.ts), accept an optional `AdjacencyMap` parameter and use it instead of per-node queries.

**Impact:** Reduces SQLite round-trips from O(visited_nodes * 2) to exactly 1. For a 1000-node BFS traversal, that's 2000 queries → 1 query.

---

## Sprint 3 — Retrieval Quality

### 3.1 Synonym/Alias Bridging

**Problem:** Querying "notification" when the code uses "toast" returns zero results because there's no lexical match. Common concept synonyms are missed.

**Solution:** Add a lightweight alias resolution layer.

**File to create:** `src/utils/synonyms.ts`

```typescript
// Hardcoded common concept synonyms
const SYNONYM_MAP: Record<string, string[]> = {
  notification: ["toast", "alert", "banner", "snackbar", "message"],
  toast: ["notification", "alert", "snackbar"],
  auth: ["authentication", "login", "signin", "sso", "oauth"],
  authentication: ["auth", "login", "signin"],
  login: ["auth", "signin", "authentication"],
  user: ["account", "profile", "member"],
  error: ["exception", "fault", "failure"],
  modal: ["dialog", "popup", "overlay"],
  nav: ["navigation", "menu", "sidebar", "header"],
  config: ["configuration", "settings", "preferences", "options"],
  db: ["database", "store", "repository", "repo"],
  api: ["endpoint", "route", "handler"],
  cache: ["memoize", "memo", "store"],
  validate: ["verify", "check", "sanitize"],
  // ... extend as needed
};

export function expandQueryWithSynonyms(queryTerms: string[]): string[] {
  const expanded = new Set(queryTerms);
  for (const term of queryTerms) {
    const synonyms = SYNONYM_MAP[term.toLowerCase()];
    if (synonyms) {
      for (const syn of synonyms) expanded.add(syn);
    }
  }
  return [...expanded];
}
```

**Integration point:** In `generateCapsule()` (generator.ts), after building `queryTerms`, call `expandQueryWithSynonyms(queryTerms)` and use the expanded terms for pivot resolution and lexical scoring. Weight original terms higher (2x) than synonym matches (1x) in `getLexicalScore()`.

**Auto-learn enhancement (future):** Track which symbols were actually used after capsule delivery (via `cw_remember` or post-tool-use hook miss tracking). Build a learned synonym table from capsule hit patterns. Store in SQLite alongside BM25 index.

### 3.2 Directory Scoring

**Problem:** Files in `/scripts/`, `/tests/`, `/vendor/`, `/examples/`, `/docs/` get the same scoring weight as core source files, polluting capsule results.

**Solution:** Add directory-based weight adjustments to the scoring pipeline.

**File to create:** `src/utils/directory-weights.ts`

```typescript
const DOWNWEIGHT_PATTERNS = [
  { pattern: /\/(tests?|__tests?__|spec)\//i, weight: 0.6 },
  { pattern: /\/(scripts?|bin)\//i, weight: 0.5 },
  { pattern: /\/(vendor|third_party|external)\//i, weight: 0.3 },
  { pattern: /\/(examples?|samples?|demo)\//i, weight: 0.5 },
  { pattern: /\/(docs?|documentation)\//i, weight: 0.4 },
  { pattern: /\/(mocks?|stubs?|fakes?|fixtures?)\//i, weight: 0.4 },
  { pattern: /\/(migrations?|seeds?)\//i, weight: 0.5 },
];

export function getDirectoryWeight(filePath: string): number {
  for (const { pattern, weight } of DOWNWEIGHT_PATTERNS) {
    if (pattern.test(filePath)) return weight;
  }
  return 1.0;
}
```

**Integration point:** In `generateCapsule()` (generator.ts), after computing `localityBoost`, multiply by `getDirectoryWeight(candidate.file.path)`:

```typescript
const directoryWeight = getDirectoryWeight(candidate.file.path);
// Pass directoryWeight into scoreNode or multiply into localityBoost
const adjustedLocalityBoost = localityBoost * directoryWeight;
```

### 3.3 Real Tokenizer

**Problem:** `src/utils/tokens.ts` uses `Math.ceil(text.length / 3.5)` which is inaccurate for source code. Code has more tokens per character than English prose due to punctuation, short identifiers, and operators.

**Solution:** Replace with `gpt-tokenizer` (pure JS, no native deps, works with Claude's tokenizer family).

**Install:** `npm install gpt-tokenizer`

**File change:** `src/utils/tokens.ts`

```typescript
import { encode } from "gpt-tokenizer";

export function countTokens(text: string): number {
  return encode(text).length;
}

export function tokenBudgetToChars(tokens: number): number {
  // Keep as estimate for pre-allocation; exact count happens via countTokens
  return Math.floor(tokens * 3.5);
}

export function fitsInBudget(text: string, remainingTokens: number): boolean {
  return countTokens(text) <= remainingTokens;
}
```

**Performance consideration:** `encode()` is called in the hot path of `packNodes()` (packer.ts, line 37) for every rendered symbol at every compression level. If this is too slow, add a memoization cache keyed by the rendered text string. Alternatively, use `gpt-tokenizer`'s `encode` with a fixed model (e.g., `"gpt-4"` or `"cl100k_base"`) for consistent results.

**Alternative:** If `gpt-tokenizer` adds too much bundle size or latency, use `tiktoken` (Rust WASM, faster but larger install) or `js-tiktoken` (pure JS, lighter).

---

## Sprint 4 — Production Hardening

### 4.1 CLAUDE.md Auto-Generation

**Problem:** vexp auto-generates a CLAUDE.md with tool descriptions on init. ContextWeave doesn't.

**File to change:** `src/cli/commands/init.ts`

**Implementation:** After successful indexing in `runInit()`, generate a `.claude/CLAUDE.md` file in the project root:

```typescript
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function generateClaudeMd(projectRoot: string): void {
  const claudeDir = resolve(projectRoot, ".claude");
  const claudeMdPath = resolve(claudeDir, "CLAUDE.md");

  if (existsSync(claudeMdPath)) return; // don't overwrite existing

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  const content = `# ContextWeave MCP Tools

This project uses ContextWeave for AST-aware context management.

## Available Tools

### cw_capsule
Generate a token-budgeted context capsule for a query. Returns relevant code symbols with dependency-aware scoring.
\`\`\`
cw_capsule({ query: "UserService", tokenBudget: 4000, mode: "feature" })
\`\`\`

### cw_impact
Analyze the impact of changing a symbol — what depends on it, what might break.
\`\`\`
cw_impact({ symbol: "validateEmail" })
\`\`\`

### cw_flow
Trace call flow from a symbol — outgoing calls or incoming callers.
\`\`\`
cw_flow({ symbol: "handleRequest", direction: "outgoing" })
\`\`\`

### cw_remember
Persist a cross-session observation about the codebase.
\`\`\`
cw_remember({ scope: "architecture", note: "Auth uses JWT with refresh tokens" })
\`\`\`

### cw_recall
Search past observations by keyword.
\`\`\`
cw_recall({ query: "auth" })
\`\`\`

### cw_status
Show index health — file count, symbol count, edge count, observation count.
\`\`\`
cw_status()
\`\`\`

### cw_reindex
Force reindex a specific file or the entire project.
\`\`\`
cw_reindex({ file: "src/core/parser.ts" })
\`\`\`
`;

  writeFileSync(claudeMdPath, content);
  process.stdout.write(`  Created ${claudeMdPath}\n`);
}
```

Call `generateClaudeMd(projectRoot)` at the end of `runInit()`, before the success message.

### 4.2 Multi-Agent Session Isolation

**Problem:** `cw_remember` hardcodes `sessionId: "current"` (line 35 of `src/mcp/tools/remember.ts`). Multiple agents hitting the same MCP server share observation context.

**Fix:** Pass the server's `sessionId` to `registerRememberTool()`:

1. **`src/mcp/server.ts`:** Change the registration call:
```typescript
registerRememberTool(server, db, serverSessionId);  // pass sessionId
```

2. **`src/mcp/tools/remember.ts`:** Accept and use `sessionId`:
```typescript
export function registerRememberTool(
  server: McpServer,
  db: Database.Database,
  sessionId: string
): void {
  // ... in the handler:
  const result = store.create({
    sessionId,  // use server session, not "current"
    scope,
    note,
    symbolId,
    confidence,
  });
```

### 4.3 cw serve Daemon Mode (optional, lower priority)

**Problem:** `cw serve` blocks the terminal via stdio transport. For non-Claude-Code usage, a daemon mode would be useful.

**Implementation sketch** (not critical for Claude Code since MCP manages the lifecycle):

1. Add a `--daemon` flag to `cw serve`
2. When `--daemon`, fork the process with `child_process.fork()`, write PID to `.contextweave/cw.pid`
3. Add `cw stop` command that reads the PID file and sends SIGTERM
4. This is OPTIONAL and low priority since Claude Code manages MCP servers via stdio natively

---

## Validation Checklist

After all sprints, verify:

- [ ] `npm run build` succeeds (tsup bundle with all externals)
- [ ] `npm run lint` passes (tsc --noEmit)
- [ ] `npm test` passes (all existing + new tests)
- [ ] Each language parses a representative fixture file with >0 symbols, >0 imports, >0 calls
- [ ] PageRank completes in <100ms for 5000 symbols (was potentially seconds with O(n²))
- [ ] Capsule generation uses <5 SQLite queries total (was 2000+)
- [ ] Token counting is within 10% of actual Claude tokenization
- [ ] `cw init` generates `.claude/CLAUDE.md` on fresh projects
- [ ] `cw_remember` uses the server session ID, not hardcoded "current"

---

## File Summary

### New files to create:
- `src/core/queries/go.ts`
- `src/core/queries/rust.ts`
- `src/core/queries/java.ts`
- `src/core/queries/c.ts`
- `src/core/queries/cpp.ts`
- `src/core/queries/csharp.ts`
- `src/core/queries/ruby.ts`
- `src/core/queries/bash.ts`
- `src/core/queries/php.ts`
- `src/utils/synonyms.ts`
- `src/utils/directory-weights.ts`
- Test fixtures: `tests/fixtures/sample.{go,rs,java,c,cpp,cs,rb,sh,php}`

### Files to modify:
- `package.json` — add 8 grammar dependencies
- `tsup.config.ts` — add 8 entries to `external` array
- `src/core/parser.ts` — `languageModules`, `extensionToLanguage`, `isExported()`, `isFunctionScoped()`
- `src/core/queries/index.ts` — import and register all 9 new query sets
- `src/core/indexer.ts` — expand glob pattern
- `src/core/graph.ts` — PageRank O(n) fix, projection query
- `src/capsule/generator.ts` — preloaded adjacency map, synonym expansion, directory weights
- `src/db/queries/symbols.ts` — add `getAllIds()` method
- `src/utils/tokens.ts` — replace char/3.5 with real tokenizer
- `src/cli/commands/init.ts` — CLAUDE.md generation
- `src/mcp/tools/remember.ts` — accept sessionId parameter
- `src/mcp/server.ts` — pass sessionId to registerRememberTool
- `tests/unit/parser.test.ts` — add language detection + parsing tests

### npm packages to install:
```bash
npm install --legacy-peer-deps \
  tree-sitter-go@0.23.4 \
  tree-sitter-rust@0.24.0 \
  tree-sitter-java@0.23.5 \
  tree-sitter-c@0.24.1 \
  tree-sitter-cpp@0.23.4 \
  tree-sitter-c-sharp@0.23.1 \
  tree-sitter-ruby@0.23.1 \
  tree-sitter-bash@0.23.3 \
  tree-sitter-php@0.24.2 \
  gpt-tokenizer
```

---

## Implementation Order (recommended)

1. Install all npm packages in one batch
2. Create all 9 query files (can be parallelized)
3. Update `parser.ts` with all language modules, extensions, and `isExported`/`isFunctionScoped` changes
4. Update `queries/index.ts` with all imports and registry entries
5. Update `indexer.ts` glob pattern
6. Update `tsup.config.ts` externals
7. Create test fixtures and tests for each language
8. Run `npm test` — fix any query syntax errors
9. Run `npm run build` — verify bundle
10. Apply Sprint 2 perf fixes (graph.ts, generator.ts, symbols.ts, tokens.ts)
11. Apply Sprint 3 quality improvements (synonyms.ts, directory-weights.ts, generator.ts integration)
12. Apply Sprint 4 hardening (init.ts, remember.ts, server.ts)
13. Final `npm test` + `npm run build` + manual smoke test
