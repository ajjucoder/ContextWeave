import type { SymbolRecord, FileRecord, CompressionLevel } from "../core/types.js";
import { countTokens } from "../utils/tokens.js";

interface EdgeSummary {
  targetName: string;
  kind: string;
}

export function renderSymbol(
  symbol: SymbolRecord,
  file: FileRecord,
  level: CompressionLevel,
  edges?: EdgeSummary[]
): string {
  if (level === 0) {
    return `// ${file.path}:${symbol.startLine}-${symbol.endLine}\n${symbol.fullSource}`;
  }

  if (level === 1) {
    const exportPrefix = symbol.isExported ? "export " : "";
    const header = `// ${file.path}:${symbol.startLine} [${symbol.kind}] ${exportPrefix}${symbol.signature}`;
    if (!symbol.docComment) return header;
    return `${header}\n// ${symbol.docComment}`;
  }

  if (level === 2) {
    const depNames = edges ? edges.map((e) => e.targetName).join(", ") : "";
    const lines = [
      `[${symbol.kind}] ${symbol.name} (${file.path}:${symbol.startLine})`,
      `sig: ${symbol.signature}`,
    ];
    if (depNames) lines.push(`deps: ${depNames}`);
    return lines.join("\n");
  }

  return `${symbol.kind} ${symbol.name} @ ${file.path}:${symbol.startLine}`;
}

export function estimateTokens(symbol: SymbolRecord, level: CompressionLevel): number {
  if (level === 0) return countTokens(symbol.fullSource);
  if (level === 1) {
    const doc = symbol.docComment ?? "";
    return countTokens(`${symbol.signature}\n${doc}`);
  }
  if (level === 2) {
    return countTokens(`${symbol.kind} ${symbol.name}\n${symbol.signature}`);
  }
  return countTokens(`${symbol.kind} ${symbol.name}`);
}

export interface FileSummarySymbol {
  name: string;
  kind: string;
}

export function renderFileSummary(filePath: string, symbols: FileSummarySymbol[]): string {
  const MAX_NAMES = 8;
  const names = symbols.slice(0, MAX_NAMES).map((s) => s.name);
  const suffix = symbols.length > MAX_NAMES ? `, +${symbols.length - MAX_NAMES} more` : "";
  return `[file] ${filePath}: ${symbols.length} symbols (${names.join(", ")}${suffix})`;
}
