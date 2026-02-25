import Parser from "tree-sitter";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { getQueries } from "./queries/index.js";
import type {
  ParsedSymbol,
  ParsedImport,
  ParsedCall,
  ParseResult,
  SymbolKind,
} from "./types.js";

const require = createRequire(import.meta.url);

const languageModules: Record<string, () => Parser.Language> = {
  typescript: () => require("tree-sitter-typescript").typescript,
  tsx: () => require("tree-sitter-typescript").tsx,
  javascript: () => require("tree-sitter-javascript"),
  jsx: () => require("tree-sitter-javascript"),
};

const extensionToLanguage: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
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
    return trimmed.slice(0, trimmed.indexOf("{")).trim() || trimmed;
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
        const effectiveKind =
          kind === "variable" && valueCapture?.node.type === "arrow_function"
            ? "arrow"
            : kind;

        symbols.push(
          nodeToSymbol(defCapture.node, nameCapture.node, effectiveKind, content)
        );
      }
    } catch {
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
  } catch {
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
  } catch {
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
