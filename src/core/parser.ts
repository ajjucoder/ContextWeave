import Parser from "tree-sitter";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { getQueries } from "./queries/index.js";
import { createLogger } from "../utils/logger.js";
import { splitIdentifier } from "../utils/camel-split.js";
import { extractFrameworkCalls } from "../frameworks/registry.js";
import type {
  ParsedSymbol,
  ParsedDecorator,
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
  ".md": "markdown",
  ".markdown": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".ini": "ini",
};

const DOCUMENT_SOURCE_LIMIT = 6000;
const DOCUMENT_NAME_TOKEN_LIMIT = 10;
const DOCUMENT_SIGNATURE_TOKEN_LIMIT = 24;

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

function isDocumentLanguage(language: string): boolean {
  return (
    language === "markdown" ||
    language === "yaml" ||
    language === "json" ||
    language === "toml" ||
    language === "ini"
  );
}

function trimDocumentSource(content: string): string {
  if (content.length <= DOCUMENT_SOURCE_LIMIT) return content;
  return `${content.slice(0, DOCUMENT_SOURCE_LIMIT).trimEnd()}\n... document truncated for indexing`;
}

function basenameWithoutExtension(filePath: string): string {
  const fileName = basename(filePath);
  const extension = extname(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function extractDocumentText(content: string, language: string): string {
  const rawLines = content.split(/\r?\n/);
  const cleanedLines = rawLines
    .map((line) => {
      let cleaned = line.trim();
      if (!cleaned) return "";
      if (language === "markdown") {
        cleaned = cleaned
          .replace(/^#{1,6}\s+/, "")
          .replace(/^>\s+/, "")
          .replace(/^[-*+]\s+/, "")
          .replace(/^\d+\.\s+/, "");
      }
      return cleaned.replace(/[`"'()[\]{}:,]/g, " ").replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);

  return cleanedLines.join(" ").trim();
}

function tokenizeDocumentText(text: string): string[] {
  const roughTokens = text
    .split(/\s+/)
    .flatMap((token) => splitIdentifier(token))
    .filter((token) => token.length >= 2);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of roughTokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
  }
  return unique;
}

function buildDocumentSymbol(filePath: string, content: string, language: string): ParsedSymbol {
  const totalLines = Math.max(1, content.split(/\r?\n/).length);
  const docText = extractDocumentText(content, language);
  const baseTokens = splitIdentifier(basenameWithoutExtension(filePath));
  const bodyTokens = tokenizeDocumentText(docText);
  const nameTokens = [...baseTokens, ...bodyTokens.filter((token) => !baseTokens.includes(token))]
    .slice(0, DOCUMENT_NAME_TOKEN_LIMIT);
  const signatureTokens = bodyTokens.slice(0, DOCUMENT_SIGNATURE_TOKEN_LIMIT);
  const documentName = nameTokens.join(" ").trim() || basenameWithoutExtension(filePath);
  const signature = signatureTokens.join(" ").trim() || documentName;

  return {
    name: documentName,
    kind: "variable",
    startLine: 1,
    endLine: totalLines,
    signature,
    fullSource: trimDocumentSource(content),
    bodyHash: hashContent(content),
    isExported: true,
    docComment: null,
  };
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

function isJsLikeLanguage(language: string): boolean {
  return language === "typescript" || language === "tsx" || language === "javascript" || language === "jsx";
}

function parseCommonJsSpecifiers(specSource: string): Array<{ localName: string; importedName: string }> {
  return specSource
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) {
        return [{ localName: aliasMatch[2]!, importedName: aliasMatch[1]! }];
      }
      return /^[A-Za-z_$][\w$]*$/.test(part)
        ? [{ localName: part, importedName: part }]
        : [];
    });
}

function toLocalBindingName(reference: string): string | null {
  const trimmed = reference.trim();
  const identifierMatch = trimmed.match(/([A-Za-z_$][\w$]*)$/);
  return identifierMatch?.[1] ?? null;
}

function parseCommonJsExports(content: string): Set<string> {
  const exported = new Set<string>();
  const exportAliases = new Set(["exports", "module.exports"]);

  const moduleExportsObjectRe = /module\.exports\s*=\s*{([\s\S]*?)}/g;
  for (const match of content.matchAll(moduleExportsObjectRe)) {
    const body = match[1] ?? "";
    for (const part of body.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const aliasMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/);
      if (aliasMatch) {
        const localName = toLocalBindingName(aliasMatch[2]!);
        if (localName) exported.add(localName);
        continue;
      }
      const localName = toLocalBindingName(trimmed);
      if (localName) exported.add(localName);
    }
  }

  const directExportRe = /(?:module\.exports|exports)\.([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g;
  for (const match of content.matchAll(directExportRe)) {
    const localName = toLocalBindingName(match[2] ?? "");
    if (localName) exported.add(localName);
  }

  const exportAliasRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:exports\s*=\s*module\.exports|module\.exports\s*=\s*exports)\s*=\s*[^\n;]+/g;
  for (const match of content.matchAll(exportAliasRe)) {
    const alias = match[1];
    if (alias) exportAliases.add(alias);
  }

  const aliasPattern = [...exportAliases]
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const memberExportRe = new RegExp(`(?:${aliasPattern})\\.([A-Za-z_$][\\w$]*)\\s*=\\s*([^\\n;]+)`, "g");
  for (const match of content.matchAll(memberExportRe)) {
    const localName = toLocalBindingName(match[2] ?? "");
    if (localName) exported.add(localName);
    else if (match[1]) exported.add(match[1]);
  }

  return exported;
}

function parseJsLikeMemberAssignmentSymbols(
  tree: Parser.Tree,
  content: string,
  exportedNames: Set<string>
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const seen = new Set<string>();
  const stack: Parser.SyntaxNode[] = [tree.rootNode];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === "assignment_expression" && isModuleLevelDeclaration(current)) {
      const left = current.childForFieldName("left");
      const right = current.childForFieldName("right");
      const propertyNode = left?.childForFieldName("property");
      const propertyName = propertyNode?.text;
      const rightType = right?.type;
      const kind =
        rightType === "arrow_function" ? "arrow" : rightType === "function_expression" ? "function" : null;

      if (propertyNode && propertyName && kind && exportedNames.has(propertyName)) {
        const key = `${propertyName}:${current.startIndex}:${current.endIndex}`;
        if (!seen.has(key)) {
          seen.add(key);
          const fullSource = current.text;
          symbols.push({
            name: propertyName,
            kind,
            startLine: current.startPosition.row + 1,
            endLine: current.endPosition.row + 1,
            signature: buildSignature(current, content),
            fullSource,
            bodyHash: hashContent(fullSource),
            isExported: true,
            docComment: extractDocComment(current),
          });
        }
      }
    }

    for (const child of current.namedChildren) {
      stack.push(child);
    }
  }

  return symbols;
}

function parseBrowserGlobalExports(content: string): Set<string> {
  const exported = new Set<string>();
  const globalAssignRe = /(?:window|globalThis|self)\.([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g;

  for (const match of content.matchAll(globalAssignRe)) {
    const localName = toLocalBindingName(match[2] ?? "");
    if (localName) {
      exported.add(localName);
    } else if (match[1]) {
      exported.add(match[1]);
    }
  }

  return exported;
}

function parsePythonMainBlock(content: string): ParsedSymbol[] {
  const lines = content.split(/\r?\n/);
  const symbols: ParsedSymbol[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim();
    if (!line || !/^if\s+__name__\s*==\s*["']__main__["']\s*:\s*$/.test(line)) continue;

    let endIndex = index;
    const blockLines = [lines[index] ?? ""];
    for (let next = index + 1; next < lines.length; next++) {
      const candidate = lines[next] ?? "";
      if (candidate.trim().length === 0) {
        blockLines.push(candidate);
        endIndex = next;
        continue;
      }
      if (/^\s+/.test(candidate)) {
        blockLines.push(candidate);
        endIndex = next;
        continue;
      }
      break;
    }

    const fullSource = blockLines.join("\n");
    symbols.push({
      name: "__main__",
      kind: "variable",
      startLine: index + 1,
      endLine: endIndex + 1,
      signature: `if __name__ == "__main__":`,
      fullSource,
      bodyHash: hashContent(fullSource),
      isExported: true,
      docComment: null,
    });
  }

  return symbols;
}

function getOwningVariableName(node: Parser.SyntaxNode): string | null {
  let current: Parser.SyntaxNode | null = node;
  while (current) {
    if (current.type === "variable_declarator") {
      const nameNode = current.childForFieldName("name");
      if (nameNode?.type === "identifier") {
        return nameNode.text;
      }
    }
    current = current.parent;
  }
  return null;
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

function extractGoReceiverType(signature: string): string | null {
  const match = signature.match(/^func\s*\(\s*(?:[A-Za-z_]\w*)?\s*\*?\s*([A-Za-z_]\w*)\s*\)/);
  return match?.[1] ?? null;
}

function extractRustImplType(node: Parser.SyntaxNode): string | null {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "impl_item") {
      const typeNode = current.childForFieldName("type");
      return typeNode?.text ?? null;
    }
    if (
      current.type === "source_file" ||
      current.type === "program" ||
      current.type === "translation_unit"
    ) {
      break;
    }
    current = current.parent;
  }
  return null;
}

function findContainingClass(
  symbol: ParsedSymbol,
  allSymbols: ParsedSymbol[]
): string | null {
  let bestParent: ParsedSymbol | null = null;
  for (const candidate of allSymbols) {
    if (
      (candidate.kind === "class" || candidate.kind === "interface" || candidate.kind === "enum") &&
      candidate.startLine <= symbol.startLine &&
      candidate.endLine >= symbol.endLine &&
      candidate.name !== symbol.name
    ) {
      if (!bestParent || (candidate.endLine - candidate.startLine) < (bestParent.endLine - bestParent.startLine)) {
        bestParent = candidate;
      }
    }
  }
  return bestParent?.name ?? null;
}

export function assignParentNames(
  symbols: ParsedSymbol[],
  language: string,
  nodeMap?: Map<string, Parser.SyntaxNode>
): ParsedSymbol[] {
  if (language === "go") {
    for (const symbol of symbols) {
      if (symbol.kind !== "method" && symbol.kind !== "function") continue;
      const receiverType = extractGoReceiverType(symbol.signature);
      if (receiverType) {
        symbol.parentName = receiverType;
      }
    }
    return symbols;
  }

  if (language === "rust") {
    if (nodeMap) {
      for (const symbol of symbols) {
        if (symbol.kind !== "method" && symbol.kind !== "function") continue;
        const key = `${symbol.name}:${symbol.startLine}`;
        const node = nodeMap.get(key);
        if (node) {
          const implType = extractRustImplType(node);
          if (implType) symbol.parentName = implType;
        }
      }
    } else {
      for (const symbol of symbols) {
        if (symbol.kind !== "method") continue;
        const parent = findContainingClass(symbol, symbols);
        if (parent) symbol.parentName = parent;
      }
    }
    return symbols;
  }

  for (const symbol of symbols) {
    if (symbol.kind !== "method" && symbol.kind !== "function" && symbol.kind !== "arrow" && symbol.kind !== "variable") continue;
    const parent = findContainingClass(symbol, symbols);
    if (parent) symbol.parentName = parent;
  }

  return symbols;
}

interface RawDecorator {
  name: string;
  fullText: string;
  startLine: number;
  endLine: number;
}

function extractDecoratorArgs(fullText: string): string[] | undefined {
  const parenStart = fullText.indexOf("(");
  if (parenStart < 0) return undefined;
  const inner = fullText.slice(parenStart + 1, fullText.lastIndexOf(")")).trim();
  if (!inner) return undefined;
  return inner.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseDecorators(
  tree: Parser.Tree,
  language: string,
  symbols: ParsedSymbol[]
): void {
  const queries = getQueries(language);
  if (!queries?.decoratorQueries) return;

  const langModule = languageModules[language];
  if (!langModule) return;
  const lang = langModule();

  const rawDecorators: RawDecorator[] = [];

  try {
    const query = new Parser.Query(lang, queries.decoratorQueries);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      const decoratorCapture = match.captures.find((c) => c.name === "decorator");
      const nameCapture = match.captures.find((c) => c.name === "decorator_name");
      if (!decoratorCapture || !nameCapture) continue;

      rawDecorators.push({
        name: nameCapture.node.text,
        fullText: decoratorCapture.node.text,
        startLine: decoratorCapture.node.startPosition.row + 1,
        endLine: decoratorCapture.node.endPosition.row + 1,
      });
    }
  } catch (err) {
    log.debug("query execution failed in parseDecorators", { language, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (rawDecorators.length === 0) return;

  // Sort symbols by start line ascending so we can find the nearest target.
  const sortedSymbols = [...symbols].sort((a, b) => a.startLine - b.startLine);

  // For each raw decorator, assign it to the nearest symbol that starts at or
  // after the decorator's start line, within a 10-line lookahead window.
  //
  // Using startLine >= raw.endLine - 1 handles both patterns:
  //   • TS/Python: decorator ends on line N, symbol starts on N+1 (strict next)
  //   • Java/C#: symbol startLine == first-annotation line, so decorator
  //     endLine may equal symbolStartLine (or be 1 line before the "public" keyword)
  // Group consecutive decorators into chains. Two decorators are in the same chain
  // if they appear on adjacent lines (decB.startLine <= decA.endLine + 1).
  // Each chain will be assigned to a single target symbol.
  const sortedRaw = [...rawDecorators].sort((a, b) => a.startLine - b.startLine);
  const chains: RawDecorator[][] = [];

  for (const raw of sortedRaw) {
    const last = chains[chains.length - 1];
    const lastInChain = last?.[last.length - 1];
    if (lastInChain && raw.startLine <= lastInChain.endLine + 1) {
      last.push(raw);
    } else {
      chains.push([raw]);
    }
  }

  const decoratorsBySymbolStart = new Map<number, ParsedDecorator[]>();

  for (const chain of chains) {
    const chainEnd = chain[chain.length - 1]!.endLine;
    const chainStart = chain[0]!.startLine;

    // Pass 1 — direct follow: find the nearest symbol that starts immediately after
    // the last decorator in the chain (gap of 1). Handles TS/Python/Rust where multiple
    // stacked decorators precede the method on consecutive lines.
    let bestSymbol: ParsedSymbol | null = null;
    let bestGap = Infinity;

    for (const sym of sortedSymbols) {
      if (sym.startLine > chainEnd && sym.startLine <= chainEnd + 1) {
        const gap = sym.startLine - chainEnd;
        if (gap < bestGap) {
          bestGap = gap;
          bestSymbol = sym;
        }
      }
    }

    // Pass 2 — containment fallback: find the smallest-span symbol whose range contains
    // the entire chain. Handles Java/C# where subsequent class annotations are contained
    // within the class node (which starts at the first annotation line) and the class
    // declaration keyword follows all annotations (gap > 1).
    if (!bestSymbol) {
      let bestSpan = Infinity;
      for (const sym of sortedSymbols) {
        if (chainStart >= sym.startLine && chainEnd <= sym.endLine) {
          const span = sym.endLine - sym.startLine;
          if (span < bestSpan) {
            bestSpan = span;
            bestSymbol = sym;
          }
        }
      }
    }

    // Pass 3 — extended lookahead: any symbol within 10 lines after the chain ends.
    if (!bestSymbol) {
      let nearestGap = Infinity;
      for (const sym of sortedSymbols) {
        if (sym.startLine > chainEnd && sym.startLine <= chainEnd + 10) {
          const gap = sym.startLine - chainEnd;
          if (gap < nearestGap) {
            nearestGap = gap;
            bestSymbol = sym;
          }
        }
      }
    }

    if (!bestSymbol) continue;

    const key = bestSymbol.startLine;
    const list = decoratorsBySymbolStart.get(key) ?? [];
    for (const raw of chain) {
      const args = extractDecoratorArgs(raw.fullText);
      list.push({ name: raw.name, fullText: raw.fullText, ...(args ? { args } : {}) });
    }
    decoratorsBySymbolStart.set(key, list);
  }

  for (const symbol of symbols) {
    const list = decoratorsBySymbolStart.get(symbol.startLine);
    if (list && list.length > 0) {
      symbol.decorators = list;
    }
  }
}

function parseSymbols(
  tree: Parser.Tree,
  language: string,
  content: string
): { symbols: ParsedSymbol[]; nodeMap: Map<string, Parser.SyntaxNode> } {
  const queries = getQueries(language);
  if (!queries) return { symbols: [], nodeMap: new Map() };

  const langModule = languageModules[language];
  if (!langModule) return { symbols: [], nodeMap: new Map() };
  const lang = langModule();

  const symbols: ParsedSymbol[] = [];
  const nodeMap = new Map<string, Parser.SyntaxNode>();
  const seen = new Set<number>();
  const pythonAllExports = language === "python" ? parsePythonAllExports(tree) : null;
  const jsLikeExports = isJsLikeLanguage(language)
    ? new Set([
        ...parseCommonJsExports(content),
        ...parseBrowserGlobalExports(content),
      ])
    : null;

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
        } else if (jsLikeExports && isModuleLevelDeclaration(defCapture.node)) {
          const symbolName = nameCapture.node.text;
          const ownerName = getOwningVariableName(defCapture.node);
          if (jsLikeExports.has(symbolName) || (ownerName !== null && jsLikeExports.has(ownerName))) {
            exportedOverride = true;
          }
        }

        const sym = nodeToSymbol(
          defCapture.node,
          nameCapture.node,
          effectiveKind,
          content,
          language,
          exportedOverride
        );
        symbols.push(sym);
        nodeMap.set(`${sym.name}:${sym.startLine}`, defCapture.node);
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

  if (jsLikeExports) {
    symbols.push(...parseJsLikeMemberAssignmentSymbols(tree, content, jsLikeExports));
  }

  return { symbols, nodeMap };
}

function parseImports(
  tree: Parser.Tree,
  language: string,
  content: string
): ParsedImport[] {
  if (language === "typescript" || language === "tsx" || language === "javascript" || language === "jsx") {
    return parseJsLikeModuleImports(tree, content);
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

function parseJsLikeModuleImports(tree: Parser.Tree, content: string): ParsedImport[] {
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

  const destructuredRequireRe = /\b(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*require\((['"])([^'"]+)\2\)/g;
  for (const match of content.matchAll(destructuredRequireRe)) {
    const specifiers = parseCommonJsSpecifiers(match[1] ?? "");
    if (specifiers.length === 0) continue;
    imports.push({
      names: specifiers.map((specifier) => specifier.localName),
      source: match[3] ?? "",
      kind: "named",
      specifiers,
    });
  }

  const requireRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\((['"])([^'"]+)\2\)/g;
  for (const match of content.matchAll(requireRe)) {
    const localName = match[1];
    const source = match[3];
    if (!localName || !source) continue;
    if (imports.some((imp) => imp.source === source && imp.names.includes(localName))) {
      continue;
    }
    imports.push({
      names: [localName],
      source,
      kind: "default",
      specifiers: [{ localName, importedName: "default" }],
    });
  }

  return imports;
}

function isCallbackProp(propName: string): boolean {
  return /^on[A-Z]|^handle|^callback|^ref$/i.test(propName);
}

function parseCalls(
  tree: Parser.Tree,
  language: string,
  symbols: ParsedSymbol[],
  content: string
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

        // Extract receiver name for member-expression calls (obj.method() → obj).
        // The callee node is the property_identifier; its parent is the member_expression.
        let receiverName: string | undefined;
        const memberNode = calleeCapture.node.parent;
        if (memberNode?.type === "member_expression" || memberNode?.type === "field_expression") {
          const objectNode = memberNode.childForFieldName("object");
          if (objectNode) {
            const text = objectNode.text;
            if (text.length <= 40) {
              receiverName = text.includes(".") ? text.split(".").pop()! : text;
            }
          }
        } else if (memberNode?.type === "selector_expression") {
          const operandNode = memberNode.childForFieldName("operand");
          if (operandNode) {
            const text = operandNode.text;
            if (text.length <= 40) {
              receiverName = text.includes(".") ? text.split(".").pop()! : text;
            }
          }
        }

        calls.push({
          callerSymbol: symbol.name,
          calleeName: calleeCapture.node.text,
          line: callLine,
          ...(receiverName ? { receiverName } : {}),
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

          const propNameCapture = match.captures.find((c) => c.name === "prop_name");
          const propValueCapture = match.captures.find((c) => c.name === "prop_value");
          if (propValueCapture) {
            const callLine = propValueCapture.node.startPosition.row + 1;
            if (callLine < symbol.startLine || callLine > symbol.endLine) continue;
            const propName = propNameCapture?.node.text ?? "";
            if (!isCallbackProp(propName)) continue;
            const rawName = propValueCapture.node.text;
            const name = rawName.includes(".") ? rawName.split(".").pop()! : rawName;
            const key = `${symbol.name}:${name}:callback`;
            if (!seen.has(key)) {
              seen.add(key);
              calls.push({
                callerSymbol: symbol.name,
                calleeName: name,
                line: callLine,
                edgeKind: "callback",
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

  calls.push(...parseDynamicDispatchCalls(symbols, content));

  return calls;
}

type DispatchFamily = "event" | "registry";

interface DynamicDispatchTrigger {
  callerSymbol: string;
  family: DispatchFamily;
  receiver: string | null;
  channel: string;
  line: number;
}

const REGISTER_METHOD_FAMILIES: Record<string, DispatchFamily> = {
  on: "event",
  once: "event",
  addListener: "event",
  subscribe: "event",
  register: "registry",
  registerHandler: "registry",
};

const TRIGGER_METHOD_FAMILIES: Record<string, DispatchFamily> = {
  emit: "event",
  publish: "event",
  trigger: "event",
  dispatch: "registry",
  run: "registry",
  execute: "registry",
  invoke: "registry",
};

const RECEIVER_DISPATCH_RE =
  /\b((?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(on|once|addListener|subscribe|register|registerHandler|emit|publish|trigger|dispatch|run|execute|invoke)\(\s*(['"`])([^'"`]+)\3(?:\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))?/g;
const DIRECT_DISPATCH_RE =
  /\b(on|once|addListener|subscribe|register|registerHandler|emit|publish|trigger|dispatch|run|execute|invoke)\(\s*(['"`])([^'"`]+)\2(?:\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))?/g;

function normalizeDispatchReceiver(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "this");
  return parts.at(-1) ?? null;
}

function normalizeDispatchHandler(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "this");
  return parts.at(-1) ?? null;
}

function normalizeDispatchChannel(value: string): string {
  return value.trim().toLowerCase();
}

function lineForMatchOffset(source: string, startLine: number, offset: number): number {
  const relative = source.slice(0, offset).split(/\r?\n/).length - 1;
  return startLine + relative;
}

function dispatchKey(family: DispatchFamily, receiver: string | null, channel: string): string {
  return `${family}:${receiver ?? "*"}:${channel}`;
}

function parseDynamicDispatchCalls(symbols: ParsedSymbol[], _content: string): ParsedCall[] {
  const registrations = new Map<string, Set<string>>();
  const triggers: DynamicDispatchTrigger[] = [];

  const visitMatches = (
    source: string,
    callerSymbol: string,
    startLine: number,
    regex: RegExp,
    receiverIndex: number | null,
    methodIndex: number,
    channelIndex: number,
    handlerIndex: number
  ): void => {
    regex.lastIndex = 0;
    for (const match of source.matchAll(regex)) {
      const method = match[methodIndex];
      if (!method) continue;

      const channel = normalizeDispatchChannel(match[channelIndex] ?? "");
      if (!channel) continue;

      const receiver = receiverIndex === null ? null : normalizeDispatchReceiver(match[receiverIndex] ?? null);
      const handlerName = normalizeDispatchHandler(match[handlerIndex] ?? null);
      const line = lineForMatchOffset(source, startLine, match.index ?? 0);

      const registerFamily = REGISTER_METHOD_FAMILIES[method];
      if (registerFamily && handlerName) {
        const key = dispatchKey(registerFamily, receiver, channel);
        const handlers = registrations.get(key) ?? new Set<string>();
        handlers.add(handlerName);
        registrations.set(key, handlers);
      }

      const triggerFamily = TRIGGER_METHOD_FAMILIES[method];
      if (triggerFamily) {
        triggers.push({
          callerSymbol,
          family: triggerFamily,
          receiver,
          channel,
          line,
        });
      }
    }
  };

  for (const symbol of symbols) {
    visitMatches(symbol.fullSource, symbol.name, symbol.startLine, RECEIVER_DISPATCH_RE, 1, 2, 4, 5);
    visitMatches(symbol.fullSource, symbol.name, symbol.startLine, DIRECT_DISPATCH_RE, null, 1, 3, 4);
  }

  const calls: ParsedCall[] = [];
  for (const trigger of triggers) {
    const handlers = registrations.get(dispatchKey(trigger.family, trigger.receiver, trigger.channel));
    if (!handlers) continue;
    for (const handlerName of handlers) {
      calls.push({
        callerSymbol: trigger.callerSymbol,
        calleeName: handlerName,
        line: trigger.line,
        edgeKind: "dynamic_dispatch",
      });
    }
  }

  return calls;
}

const BENIGN_TSX_ERROR_PARENT_TYPES = new Set([
  "jsx_text",
  "jsx_expression",
  "jsx_attribute",
  "jsx_self_closing_element",
]);

function collectErrorNodes(root: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const errors: Parser.SyntaxNode[] = [];
  const stack: Parser.SyntaxNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "ERROR") {
      errors.push(node);
    }
    for (let i = node.namedChildCount - 1; i >= 0; i -= 1) {
      const child = node.namedChild(i);
      if (child) stack.push(child);
    }
    for (let i = node.childCount - 1; i >= 0; i -= 1) {
      const child = node.child(i);
      if (child && child.type === "ERROR") stack.push(child);
    }
  }

  return errors;
}

function isBenignTsxParseWarning(root: Parser.SyntaxNode, language: string, content: string): boolean {
  if (language !== "tsx" || !root.hasError) {
    return false;
  }

  const lines = content.split("\n");
  const errorNodes = collectErrorNodes(root);
  if (errorNodes.length === 0) {
    return false;
  }

  return errorNodes.every((node) => {
    const line = lines[node.startPosition.row] ?? "";
    const jsxAmpersandLine = /<[^>]+>/.test(line) && line.includes("&");
    const jsxLookingText = /[<>&]/.test(node.text);
    if (jsxAmpersandLine && jsxLookingText) {
      return true;
    }

    let current: Parser.SyntaxNode | null = node.parent;
    while (current) {
      if (BENIGN_TSX_ERROR_PARENT_TYPES.has(current.type)) {
        return true;
      }
      if (!current.type.startsWith("jsx")) {
        return false;
      }
      current = current.parent;
    }
    return false;
  });
}

function parseVariableBindings(
  tree: Parser.Tree,
  language: string,
  symbols: ParsedSymbol[]
): import("./types.js").VariableTypeBinding[] {
  const bindings: import("./types.js").VariableTypeBinding[] = [];

  if (!["typescript", "tsx", "javascript", "jsx"].includes(language)) return bindings;

  const langModule = languageModules[language];
  if (!langModule) return bindings;
  const lang = langModule();

  // Extract: const x = new Foo() → x → Foo
  // Extract: const x: Foo = ... → x → Foo (type annotation)
  const newExprQuery = `
(lexical_declaration
  (variable_declarator
    name: (identifier) @var
    value: (new_expression
      constructor: (identifier) @type))) @binding

(variable_declaration
  (variable_declarator
    name: (identifier) @var
    value: (new_expression
      constructor: (identifier) @type))) @binding

(lexical_declaration
  (variable_declarator
    name: (identifier) @var
    type: (type_annotation
      (type_identifier) @type))) @binding
`;

  try {
    const query = new Parser.Query(lang, newExprQuery);
    const matches = query.matches(tree.rootNode);
    for (const match of matches) {
      const varCapture = match.captures.find((c) => c.name === "var");
      const typeCapture = match.captures.find((c) => c.name === "type");
      if (!varCapture || !typeCapture) continue;

      const line = varCapture.node.startPosition.row + 1;
      const containingSymbol = symbols.find(
        (s) => s.startLine <= line && s.endLine >= line
      );
      const scope = containingSymbol?.name ?? "module";
      bindings.push({
        variableName: varCapture.node.text,
        typeName: typeCapture.node.text,
        scope,
      });
    }
  } catch {
    // query errors are non-fatal
  }

  return bindings;
}

export function parseFile(
  filePath: string,
  content: string,
  language: string
): ParseResult {
  const errors: string[] = [];

  try {
    if (isDocumentLanguage(language)) {
      return {
        symbols: [buildDocumentSymbol(filePath, content, language)],
        imports: [],
        calls: [],
        frameworkCalls: [],
        variableBindings: [],
        errors,
      };
    }

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

    if (tree.rootNode.hasError && !isBenignTsxParseWarning(tree.rootNode, language, content)) {
      errors.push(`Syntax errors detected in ${filePath}`);
    }

    const { symbols: parsedSymbols, nodeMap } = parseSymbols(tree, language, content);
    const symbols = [
      ...parsedSymbols,
      ...(language === "python" ? parsePythonMainBlock(content) : []),
    ];
    assignParentNames(symbols, language, nodeMap);
    parseDecorators(tree, language, symbols);
    const imports = parseImports(tree, language, content);
    const calls = parseCalls(tree, language, symbols, content);
    const frameworkCalls = extractFrameworkCalls(language, symbols);

    if (["typescript", "tsx", "javascript", "jsx"].includes(language)) {
      const fileHasUseServer = /^(['"])use server\1/m.test(content);
      for (const symbol of symbols) {
        if (symbol.kind !== "function" && symbol.kind !== "arrow") continue;
        const bodyStart = symbol.fullSource.replace(/^[^{]*\{[\s\n]*/, "");
        const hasDirective = /^(['"])use server\1/.test(bodyStart);
        if (hasDirective || (fileHasUseServer && symbol.isExported)) {
          calls.push({
            callerSymbol: symbol.name,
            calleeName: symbol.name,
            line: symbol.startLine,
            edgeKind: "server-action",
          });
        }
      }
    }

    const variableBindings = parseVariableBindings(tree, language, symbols);

    return { symbols, imports, calls, frameworkCalls, variableBindings, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      symbols: [],
      imports: [],
      calls: [],
      frameworkCalls: [],
      variableBindings: [],
      errors: [`Failed to parse ${filePath}: ${message}`],
    };
  }
}
