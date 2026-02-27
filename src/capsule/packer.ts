import type { ScoredNode, CompressionLevel } from "../core/types.js";
import { renderSymbol, renderFileSummary } from "./compressor.js";
import { countTokens } from "../utils/tokens.js";

interface PackResult {
  packed: ScoredNode[];
  observationBudget: number;
  tokensUsed: number;
  fileSummaries: string[];
}

const COMPRESSION_LEVELS: CompressionLevel[] = [0, 1, 2, 3];

export function packNodes(
  scoredNodes: ScoredNode[],
  tokenBudget: number,
  codeRatio = 0.8,
  l3Cap = 0.3
): PackResult {
  const codeBudget = Math.floor(tokenBudget * codeRatio);
  const observationBudget = tokenBudget - codeBudget;

  const sorted = [...scoredNodes].sort((a, b) => b.score - a.score);
  const packed: ScoredNode[] = [];
  let tokensUsed = 0;
  let l3Count = 0;
  const maxL3 = Math.max(5, Math.ceil(sorted.length * l3Cap));

  for (const node of sorted) {
    const startLevel = node.compressionLevel;
    let placed = false;

    for (const level of COMPRESSION_LEVELS.slice(startLevel) as CompressionLevel[]) {
      if (level === 3 && l3Count >= maxL3) continue;

      const rendered = renderSymbol(node.symbol, node.file, level);
      const tokens = countTokens(rendered);

      if (tokensUsed + tokens <= codeBudget) {
        packed.push({
          ...node,
          compressionLevel: level,
          rendered,
          tokenCount: tokens,
        });
        tokensUsed += tokens;
        if (level === 3) l3Count++;
        placed = true;
        break;
      }
    }

    if (!placed) continue;
  }

  // Promotion pass: upgrade L3→L2→L1→L0 when budget remains
  const remainingBudget = codeBudget - tokensUsed;
  if (remainingBudget > 50) {
    const l3Indices = packed
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => node.compressionLevel === 3)
      .sort((a, b) => b.node.score - a.node.score);

    for (const { node, i } of l3Indices) {
      for (const targetLevel of [2, 1, 0] as CompressionLevel[]) {
        const rendered = renderSymbol(node.symbol, node.file, targetLevel);
        const tokens = countTokens(rendered);
        const delta = tokens - node.tokenCount;

        if (delta > 0 && tokensUsed + delta <= codeBudget) {
          packed[i] = { ...node, compressionLevel: targetLevel, rendered, tokenCount: tokens };
          tokensUsed += delta;
          break;
        }
      }
    }
  }

  const packedIds = new Set(packed.map((n) => n.symbol.id));
  const unpackedByFile = new Map<string, { path: string; symbols: { name: string; kind: string }[] }>();

  for (const node of scoredNodes) {
    if (packedIds.has(node.symbol.id)) continue;
    const entry = unpackedByFile.get(node.file.path) ?? { path: node.file.path, symbols: [] };
    entry.symbols.push({ name: node.symbol.name, kind: node.symbol.kind });
    unpackedByFile.set(node.file.path, entry);
  }

  const fileSummaries: string[] = [];
  const FILE_SUMMARY_MIN_SYMBOLS = 3;

  for (const { path, symbols } of unpackedByFile.values()) {
    if (symbols.length < FILE_SUMMARY_MIN_SYMBOLS) continue;
    const summary = renderFileSummary(path, symbols);
    const summaryTokens = countTokens(summary);
    if (tokensUsed + summaryTokens <= codeBudget) {
      fileSummaries.push(summary);
      tokensUsed += summaryTokens;
    }
  }

  return { packed, observationBudget, tokensUsed, fileSummaries };
}
