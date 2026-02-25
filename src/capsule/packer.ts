import type { ScoredNode, CompressionLevel } from "../core/types.js";
import { renderSymbol } from "./compressor.js";
import { countTokens } from "../utils/tokens.js";

interface PackResult {
  packed: ScoredNode[];
  observationBudget: number;
  tokensUsed: number;
}

const COMPRESSION_LEVELS: CompressionLevel[] = [0, 1, 2, 3];

export function packNodes(
  scoredNodes: ScoredNode[],
  tokenBudget: number,
  codeRatio = 0.8
): PackResult {
  const codeBudget = Math.floor(tokenBudget * codeRatio);
  const observationBudget = tokenBudget - codeBudget;

  const sorted = [...scoredNodes].sort((a, b) => b.score - a.score);
  const packed: ScoredNode[] = [];
  let tokensUsed = 0;

  for (const node of sorted) {
    const startLevel = node.compressionLevel;
    let placed = false;

    for (const level of COMPRESSION_LEVELS.slice(startLevel) as CompressionLevel[]) {
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
        placed = true;
        break;
      }
    }

    if (!placed) continue;
  }

  return { packed, observationBudget, tokensUsed };
}
