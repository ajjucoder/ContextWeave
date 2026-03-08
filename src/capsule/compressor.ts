import type { SymbolRecord, FileRecord, CompressionLevel } from "../core/types.js";
import { countTokens } from "../utils/tokens.js";

export interface EdgeSummary {
  targetName: string;
  kind: string;
}

export function renderSymbol(
  symbol: SymbolRecord,
  file: FileRecord,
  level: CompressionLevel,
  edges?: EdgeSummary[],
  maxL0Tokens?: number
): string {
  if (level === 0) {
    const header = `// ${file.path}:${symbol.startLine}-${symbol.endLine}`;
    const full = `${header}\n${symbol.fullSource}`;
    const cap = maxL0Tokens ?? 600;
    if (countTokens(full) <= cap) return full;

    const lines = symbol.fullSource.split("\n");
    const sigLine = lines[0] ?? "";
    const tailLines = lines.slice(-3);
    const headLines: string[] = [sigLine];
    const truncMsg = `// ... truncated — use cw_read(symbol: "${file.path}:${symbol.name}") for full source`;
    let tokens = countTokens([header, sigLine, truncMsg, ...tailLines].join("\n"));

    for (let i = 1; i < lines.length - 3; i++) {
      const next = lines[i]!;
      const nextTokens = countTokens(next);
      if (tokens + nextTokens > cap * 0.7) break;
      headLines.push(next);
      tokens += nextTokens;
    }

    const omitted = lines.length - headLines.length - tailLines.length;
    if (omitted <= 0) return full;

    return [header, ...headLines, `// ... ${omitted} more lines — use cw_read(symbol: "${file.path}:${symbol.name}") for full source`, ...tailLines].join("\n");
  }

  if (level === 1) {
    const exportPrefix = symbol.isExported ? "export " : "";
    const header = `// ${file.path}:${symbol.startLine} [${symbol.kind}] ${exportPrefix}${symbol.signature}`;
    if (!symbol.docComment) return header;
    return `${header}\n// ${symbol.docComment}`;
  }

  if (level === 2) {
    const MAX_DEPS = 5;
    const depSlice = edges ? edges.slice(0, MAX_DEPS) : [];
    const depSuffix = edges && edges.length > MAX_DEPS ? `, +${edges.length - MAX_DEPS} more` : "";
    const depNames = depSlice.map((e) => e.targetName).join(", ") + depSuffix;
    const lines = [
      `[${symbol.kind}] ${symbol.name} (${file.path}:${symbol.startLine})`,
      `sig: ${symbol.signature}`,
    ];
    if (depNames) lines.push(`deps: ${depNames}`);
    return lines.join("\n");
  }

  return `${symbol.kind} ${symbol.name} @ ${file.path}:${symbol.startLine}`;
}

export function estimateTokens(symbol: SymbolRecord, level: CompressionLevel, maxL0Tokens?: number): number {
  if (level === 0) {
    const full = countTokens(symbol.fullSource);
    const cap = maxL0Tokens ?? 600;
    return Math.min(full, cap);
  }
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
