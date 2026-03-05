import Parser from "tree-sitter";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { getQueries } from "./queries/index.js";
import { createLogger } from "../utils/logger.js";
import type {
  ParsedSymbol,
  ParsedImport,
  ParsedCall,
  ParseResult,
  SymbolKind,
} from "./types.js";

const require = createRequire(import.meta.url);
const log = createLogger("parser");

type TreeSitterLanguage = ReturnType<Parser["getLanguage"]>;

const languageModules: Record<string, () => TreeSitterLanguage> = {
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

const extensionToLanguage: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
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

export function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return extensionToLanguage[ext] ?? null;
}

const parserCache = new Map<string, Parser>();

export function initParser(language: string): Parser {
  const cached = parserCache.get(language);
  if (cached) return cached;

  const getLanguage = languageModules[language];
  if (!getLanguage) throw new Error(`Unsupported language: ${language}`);

  const parser = new Parser();
  parser.setLanguage(getLanguage());
  parserCache.set(language, parser);
  return parser;
}

function extractDocComment(node: Parser.SyntaxNode): string | null {
  const prev = node.previousNamedSibling;
  if (!prev) return null;
  if (prev.type === "comment") return prev.text;
  return null;
}

function isExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "export_statement") return true;
  if (parent.type === "module") return true;
  if (parent.type === "source_file") return true;
  if (parent.type === "translation_unit") return true;
  if (parent.type === "compilation_unit") return true;
  if (parent.type === "program") return false;
  return isExported(parent);
}

function buildSignature(node: Parser.SyntaxNode, content: string): string {
  const lines = content.split("\n");
  const startLine = node.startPosition.row;
  const firstLine = lines[startLine] ?? "";
  const trimmed = firstLine.trim();

  const bodyChild = node.childForFieldName("body");
  if (!bodyChild) return trimmed;

  const bodyStart = bodyChild.startPosition.row;
  if (bodyStart === startLine) {
    const bodyCol = bodyChild.startPosition.column;
    return firstLine.slice(0, bodyCol).trim() || trimmed;
  }

  const sigLines: string[] = [];
  for (let i = startLine; i < bodyStart; i++) {
    const line = lines[i];
    if (line !== undefined) sigLines.push(line.trim());
  }
  return sigLines.join(" ").trim();
}

function hashContent(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function isFunctionScoped(node: Parser.SyntaxNode): boolean {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === "function_declaration" ||
      current.type === "generator_function_declaration" ||
      current.type === "function_expression" ||
      current.type === "arrow_function" ||
      current.type === "method_definition" ||
      current.type === "function_definition" ||
      current.type === "method_declaration" ||
      current.type === "constructor_declaration" ||
      current.type === "func_literal" ||
      current.type === "function_item" ||
      current.type === "closure_expression" ||
      current.type === "lambda_expression" ||
      current.type === "lambda" ||
      current.type === "method" ||
      current.type === "singleton_method" ||
      current.type === "anonymous_function_creation_expression"
    ) {
      return true;
    }
    if (
      current.type === "program" ||
      current.type === "module" ||
      current.type === "source_file" ||
      current.type === "translation_unit" ||
      current.type === "compilation_unit"
    ) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function isModuleLevelDeclaration(node: Parser.SyntaxNode): boolean {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === "function_definition" ||
      current.type === "lambda" ||
      current.type === "class_definition" ||
      current.type === "block"
    ) {
      return false;
    }
    if (
      current.type === "module" ||
      current.type === "program" ||
      current.type === "source_file" ||
      current.type === "translation_unit" ||
      current.type === "compilation_unit"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function stripStringQuotes(rawText: string): string {
  let text = rawText.trim();
  text = text.replace(/^[rubf]+/i, "");
  if (
    (text.startsWith("'''") && text.endsWith("'''")) ||
    (text.startsWith(`"""`) && text.endsWith(`"""`))
  ) {
    return text.slice(3, -3);
  }
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith(`"`) && text.endsWith(`"`))) {
    return text.slice(1, -1);
  }
  return text;
}

function collectPythonStringLiterals(node: Parser.SyntaxNode): string[] {
  const out: string[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.type === "string") {
      const value = stripStringQuotes(current.text);
      if (value.length > 0) out.push(value);
      continue;
    }
    for (const child of current.namedChildren) {
      stack.push(child);
    }
  }
  return out;
}

function parsePythonAllExports(tree: Parser.Tree): Set<string> | null {
  const exports = new Set<string>();
  let hasAllAssignment = false;
  const stack = [tree.rootNode];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.type === "assignment") {
      const left = node.childForFieldName("left");
      if (left?.type === "identifier" && left.text === "__all__") {
        hasAllAssignment = true;
        const right = node.childForFieldName("right");
        if (right) {
          for (const name of collectPythonStringLiterals(right)) {
            exports.add(name);
          }
        }
      }
    }

    for (const child of node.namedChildren) {
      stack.push(child);
    }
  }

  return hasAllAssignment ? exports : null;
}

function shouldSkipTrivialSymbol(
  node: Parser.SyntaxNode,
  kind: SymbolKind
): boolean {
  if (kind !== "variable") return false;
  const isSingleLine = node.startPosition.row === node.endPosition.row;
  if (!isSingleLine) return false;
  if (!isFunctionScoped(node)) return false;
  return true;
}

function languageOverrideExported(name: string, language: string): boolean | null {
  if (language === "go") {
    return name.length > 0 && /^[A-Z]/.test(name);
  }
  return null;
}

function nodeToSymbol(
  node: Parser.SyntaxNode,
  nameNode: Parser.SyntaxNode,
  kind: SymbolKind,
  content: string,
  language: string,
  exportedOverride?: boolean
): ParsedSymbol {
  const name = nameNode.text;
  const fullSource = node.text;
  const override = languageOverrideExported(name, language);
  return {
    name,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: buildSignature(node, content),
    fullSource,
    bodyHash: hashContent(fullSource),
    isExported: exportedOverride ?? (override !== null ? override : isExported(node)),
    docComment: extractDocComment(node),
  };
}

function parseSymbols(
  tree: Parser.Tree,
  language: string,
  content: string
): ParsedSymbol[] {
  const queries = getQueries(language);
  if (!queries) return [];

  const langModule = languageModules[language];
  if (!langModule) return [];
  const lang = langModule();

  const symbols: ParsedSymbol[] = [];
  const seen = new Set<number>();
  const pythonAllExports = language === "python" ? parsePythonAllExports(tree) : null;

  const runQuery = (queryStr: string, kind: SymbolKind) => {
    try {
      const query = new Parser.Query(lang, queryStr);
      const matches = query.matches(tree.rootNode);

      for (const match of matches) {
        const defCapture = match.captures.find((c) => c.name === "definition");
        const nameCapture = match.captures.find((c) => c.name === "name");

        if (!defCapture || !nameCapture) continue;
        if (seen.has(defCapture.node.id)) continue;
        seen.add(defCapture.node.id);

        const valueCapture = match.captures.find((c) => c.name === "value");
        const valueType = valueCapture?.node.type;
        const effectiveKind = kind === "variable" && valueType && (
          valueType === "arrow_function" ||
          valueType === "closure_expression" ||
          valueType === "lambda_expression" ||
          valueType === "lambda" ||
          valueType === "func_literal" ||
          valueType === "anonymous_function_creation_expression"
        )
          ? "arrow"
          : kind;

        if (shouldSkipTrivialSymbol(defCapture.node, effectiveKind)) {
          continue;
        }

        let exportedOverride: boolean | undefined;
        if (language === "python") {
          const symbolName = nameCapture.node.text;
          const moduleLevel = isModuleLevelDeclaration(defCapture.node);
          if (pythonAllExports) {
            exportedOverride = moduleLevel && pythonAllExports.has(symbolName);
          } else {
            exportedOverride = moduleLevel && !symbolName.startsWith("_");
          }
        }

        symbols.push(nodeToSymbol(
          defCapture.node,
          nameCapture.node,
          effectiveKind,
          content,
          language,
          exportedOverride
        ));
      }
    } catch (err) {
      log.debug("query execution failed in parseSymbols", { kind, error: err instanceof Error ? err.message : String(err) });
    }
  };

  runQuery(queries.functionDeclarations, "function");
  runQuery(queries.arrowFunctions, "arrow");
  runQuery(queries.classDeclarations, "class");
  runQuery(queries.methodDefinitions, "method");
  runQuery(queries.variableDeclarations, "variable");

  if (queries.interfaceDeclarations) {
    runQuery(queries.interfaceDeclarations, "interface");
  }
  if (queries.typeAliasDeclarations) {
    runQuery(queries.typeAliasDeclarations, "type");
  }
  if (queries.enumDeclarations) {
    runQuery(queries.enumDeclarations, "enum");
  }

  return symbols;
}

function parseImports(
  tree: Parser.Tree,
  language: string
): ParsedImport[] {
  if (language === "typescript" || language === "tsx" || language === "javascript" || language === "jsx") {
    return parseJsLikeModuleImports(tree);
  }

  const queries = getQueries(language);
  if (!queries) return [];

  const langModule = languageModules[language];
  if (!langModule) return [];
  const lang = langModule();

  const imports: ParsedImport[] = [];

  try {
    const query = new Parser.Query(lang, queries.importDeclarations);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      const sourceCapture = match.captures.find((c) => c.name === "source");
      const nameCaptures = match.captures.filter((c) => c.name === "name");
      const defCapture = match.captures.find((c) => c.name === "definition");

      if (!sourceCapture || !defCapture) continue;

      const source = sourceCapture.node.text.replace(/^['"]|['"]$/g, "");
      const names = nameCaptures.map((c) => c.node.text);

      if (names.length === 0) continue;

      const importNode = defCapture.node;
      const importClause = importNode.childForFieldName("import_clause") ??
        importNode.namedChildren.find((c) => c.type === "import_clause");

      let kind: ParsedImport["kind"] = "named";

      if (importClause) {
        const hasNamespace = importClause.namedChildren.some(
          (c) => c.type === "namespace_import"
        );
        const hasDefaultId = importClause.namedChildren.some(
          (c) => c.type === "identifier"
        );
        const hasNamed = importClause.namedChildren.some(
          (c) => c.type === "named_imports"
        );

        if (hasNamespace) kind = "namespace";
        else if (hasDefaultId && !hasNamed) kind = "default";
        else kind = "named";
      }

      imports.push({ names, source, kind });
    }
  } catch (err) {
    log.debug("query execution failed in parseImports", { language, error: err instanceof Error ? err.message : String(err) });
  }

  if (queries.reExportDeclarations) {
    try {
      const reExportQuery = new Parser.Query(lang, queries.reExportDeclarations);
      const matches = reExportQuery.matches(tree.rootNode);

      for (const match of matches) {
        const sourceCapture = match.captures.find((c) => c.name === "source");
        const nameCaptures = match.captures.filter((c) => c.name === "name");

        if (!sourceCapture || nameCaptures.length === 0) continue;

        const source = sourceCapture.node.text.replace(/^['"]|['"]$/g, "");
        const names = nameCaptures.map((c) => c.node.text);

        imports.push({ names, source, kind: "named", isReExport: true });
      }
    } catch (err) {
      log.debug("query execution failed in parseReExports", { language, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return imports;
}

function unquoteJs(raw: string): string {
  const text = raw.trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith(`"`) && text.endsWith(`"`))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseJsLikeModuleImports(tree: Parser.Tree): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const node of tree.rootNode.namedChildren) {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      const source = sourceNode ? unquoteJs(sourceNode.text) : "";
      if (!source) continue;

      const importClause = node.childForFieldName("import_clause") ??
        node.namedChildren.find((child) => child.type === "import_clause");
      if (!importClause) continue;

      const specifiers: Array<{ localName: string; importedName: string }> = [];
      let kind: ParsedImport["kind"] = "named";

      const defaultImport = importClause.namedChildren.find((child) => child.type === "identifier");
      if (defaultImport) {
        specifiers.push({
          localName: defaultImport.text,
          importedName: "default",
        });
      }

      const namespaceImport = importClause.namedChildren.find((child) => child.type === "namespace_import");
      if (namespaceImport) {
        const nsIdentifier = namespaceImport.namedChildren.find((child) => child.type === "identifier");
        if (nsIdentifier) {
          kind = "namespace";
          specifiers.push({
            localName: nsIdentifier.text,
            importedName: "*",
          });
        }
      }

      const namedImports = importClause.namedChildren.find((child) => child.type === "named_imports");
      if (namedImports) {
        kind = "named";
        for (const child of namedImports.namedChildren) {
          if (child.type !== "import_specifier") continue;
          const importedNode = child.childForFieldName("name");
          if (!importedNode) continue;
          const aliasNode = child.childForFieldName("alias");
          specifiers.push({
            localName: aliasNode?.text ?? importedNode.text,
            importedName: importedNode.text,
          });
        }
      }

      if (!defaultImport && !namedImports && namespaceImport) {
        kind = "namespace";
      } else if (defaultImport && !namedImports && !namespaceImport) {
        kind = "default";
      }

      if (specifiers.length === 0) continue;
      imports.push({
        names: specifiers.map((specifier) => specifier.localName),
        source,
        kind,
        specifiers,
      });
      continue;
    }

    if (node.type !== "export_statement") continue;
    const sourceNode = node.childForFieldName("source");
    const source = sourceNode ? unquoteJs(sourceNode.text) : "";
    if (!source) continue;

    const exportClause = node.childForFieldName("export_clause") ??
      node.namedChildren.find((child) => child.type === "export_clause");
    if (!exportClause) {
      imports.push({
        names: [],
        source,
        kind: "namespace",
        isReExport: true,
        exportAll: true,
      });
      continue;
    }

    const specifiers: Array<{ localName: string; importedName: string }> = [];
    for (const child of exportClause.namedChildren) {
      if (child.type !== "export_specifier") continue;
      const importedNode = child.childForFieldName("name");
      if (!importedNode) continue;
      const aliasNode = child.childForFieldName("alias");
      specifiers.push({
        localName: aliasNode?.text ?? importedNode.text,
        importedName: importedNode.text,
      });
    }

    if (specifiers.length === 0) continue;
    imports.push({
      names: specifiers.map((specifier) => specifier.localName),
      source,
      kind: "named",
      isReExport: true,
      specifiers,
    });
  }

  return imports;
}

function parseCalls(
  tree: Parser.Tree,
  language: string,
  symbols: ParsedSymbol[]
): ParsedCall[] {
  const queries = getQueries(language);
  if (!queries) return [];

  const langModule = languageModules[language];
  if (!langModule) return [];
  const lang = langModule();

  const calls: ParsedCall[] = [];

  try {
    const query = new Parser.Query(lang, queries.callExpressions);

    for (const symbol of symbols) {
      const startLine = symbol.startLine - 1;
      const endLine = symbol.endLine - 1;

      const matches = query.matches(tree.rootNode, {
        startPosition: { row: startLine, column: 0 },
        endPosition: { row: endLine, column: Infinity },
      });

      for (const match of matches) {
        const calleeCapture = match.captures.find((c) => c.name === "callee");
        if (!calleeCapture) continue;

        const callLine = calleeCapture.node.startPosition.row + 1;
        if (callLine < symbol.startLine || callLine > symbol.endLine) continue;

        calls.push({
          callerSymbol: symbol.name,
          calleeName: calleeCapture.node.text,
          line: callLine,
        });
      }
    }
  } catch (err) {
    log.debug("query execution failed in parseCalls", { language, error: err instanceof Error ? err.message : String(err) });
  }

  if (queries.jsxUsages && (language === "tsx" || language === "jsx")) {
    try {
      const jsxQuery = new Parser.Query(lang, queries.jsxUsages);
      const seen = new Set<string>();

      for (const symbol of symbols) {
        const startLine = symbol.startLine - 1;
        const endLine = symbol.endLine - 1;

        const matches = jsxQuery.matches(tree.rootNode, {
          startPosition: { row: startLine, column: 0 },
          endPosition: { row: endLine, column: Infinity },
        });

        for (const match of matches) {
          const componentCapture = match.captures.find((c) => c.name === "component");
          if (componentCapture) {
            const callLine = componentCapture.node.startPosition.row + 1;
            if (callLine < symbol.startLine || callLine > symbol.endLine) continue;
            const name = componentCapture.node.text;
            if (name[0] && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
              const key = `${symbol.name}:${name}:jsx`;
              if (!seen.has(key)) {
                seen.add(key);
                calls.push({
                  callerSymbol: symbol.name,
                  calleeName: name,
                  line: callLine,
                  edgeKind: "jsx_render",
                });
              }
            }
          }

          const propValueCapture = match.captures.find((c) => c.name === "prop_value");
          if (propValueCapture) {
            const callLine = propValueCapture.node.startPosition.row + 1;
            if (callLine < symbol.startLine || callLine > symbol.endLine) continue;
            const name = propValueCapture.node.text;
            const key = `${symbol.name}:${name}:call`;
            if (!seen.has(key)) {
              seen.add(key);
              calls.push({
                callerSymbol: symbol.name,
                calleeName: name,
                line: callLine,
              });
            }
          }
        }
      }
    } catch (err) {
      log.debug("query execution failed in parseJsxUsages", { language, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (queries.typeReferences) {
    try {
      const typeQuery = new Parser.Query(lang, queries.typeReferences);
      const seen = new Set<string>();

      for (const symbol of symbols) {
        const startLine = symbol.startLine - 1;
        const endLine = symbol.endLine - 1;

        const matches = typeQuery.matches(tree.rootNode, {
          startPosition: { row: startLine, column: 0 },
          endPosition: { row: endLine, column: Infinity },
        });

        for (const match of matches) {
          const nameCapture = match.captures.find((c) => c.name === "name");
          if (!nameCapture) continue;

          const callLine = nameCapture.node.startPosition.row + 1;
          if (callLine < symbol.startLine || callLine > symbol.endLine) continue;

          const name = nameCapture.node.text;
          const key = `${symbol.name}:${name}:type`;
          if (!seen.has(key)) {
            seen.add(key);
            calls.push({
              callerSymbol: symbol.name,
              calleeName: name,
              line: callLine,
              edgeKind: "type_usage",
            });
          }
        }
      }
    } catch (err) {
      log.debug("query execution failed in parseTypeReferences", { language, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (queries.classHeritage) {
    try {
      const heritageQuery = new Parser.Query(lang, queries.classHeritage);

      for (const symbol of symbols) {
        if (symbol.kind !== "class") continue;
        const startLine = symbol.startLine - 1;
        const endLine = symbol.endLine - 1;

        const matches = heritageQuery.matches(tree.rootNode, {
          startPosition: { row: startLine, column: 0 },
          endPosition: { row: endLine, column: Infinity },
        });

        for (const match of matches) {
          const extendsCapture = match.captures.find((c) => c.name === "extends");
          if (extendsCapture) {
            const callLine = extendsCapture.node.startPosition.row + 1;
            if (callLine < symbol.startLine || callLine > symbol.endLine) continue;
            calls.push({
              callerSymbol: symbol.name,
              calleeName: extendsCapture.node.text,
              line: callLine,
              edgeKind: "inheritance",
            });
          }

          const implementsCapture = match.captures.find((c) => c.name === "implements");
          if (implementsCapture) {
            const callLine = implementsCapture.node.startPosition.row + 1;
            if (callLine < symbol.startLine || callLine > symbol.endLine) continue;
            calls.push({
              callerSymbol: symbol.name,
              calleeName: implementsCapture.node.text,
              line: callLine,
              edgeKind: "implements",
            });
          }
        }
      }
    } catch (err) {
      log.debug("query execution failed in parseClassHeritage", { language, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return calls;
}

export function parseFile(
  filePath: string,
  content: string,
  language: string
): ParseResult {
  const errors: string[] = [];

  try {
    const parser = initParser(language);
    // tree-sitter's string parse() throws for inputs >= 32768 bytes.
    // Use the callback (string-chunk) form for large files.
    let tree: ReturnType<typeof parser.parse>;
    if (content.length < 32768) {
      tree = parser.parse(content);
    } else {
      tree = parser.parse(((index: number) => {
        const chunk = content.slice(index, index + 4096);
        return chunk.length > 0 ? chunk : null;
      }) as unknown as string);
    }

    if (tree.rootNode.hasError) {
      errors.push(`Syntax errors detected in ${filePath}`);
    }

    const symbols = parseSymbols(tree, language, content);
    const imports = parseImports(tree, language);
    const calls = parseCalls(tree, language, symbols);

    return { symbols, imports, calls, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      symbols: [],
      imports: [],
      calls: [],
      errors: [`Failed to parse ${filePath}: ${message}`],
    };
  }
}
