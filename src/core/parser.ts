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

export function initParser(language: string): Parser {
  const getLanguage = languageModules[language];
  if (!getLanguage) throw new Error(`Unsupported language: ${language}`);

  const parser = new Parser();
  parser.setLanguage(getLanguage());
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

function nodeToSymbol(
  node: Parser.SyntaxNode,
  nameNode: Parser.SyntaxNode,
  kind: SymbolKind,
  content: string
): ParsedSymbol {
  const fullSource = node.text;
  return {
    name: nameNode.text,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: buildSignature(node, content),
    fullSource,
    bodyHash: hashContent(fullSource),
    isExported: isExported(node),
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

        symbols.push(
          nodeToSymbol(defCapture.node, nameCapture.node, effectiveKind, content)
        );
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
    const tree = parser.parse(content);

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
