import type { ScoredNode } from "../core/types.js";
import { countTokens } from "../utils/tokens.js";
import { packNodesStoryMode, type PackResult } from "./packer.js";

export interface SubCapsuleResult {
  packed: ScoredNode[];
  fileSummaries: string[];
  pivotSymbolIds: Set<number>;
  clusterIds: Set<number>;
}

function choosePreferredNode(existing: ScoredNode, incoming: ScoredNode): ScoredNode {
  if (incoming.compressionLevel < existing.compressionLevel) return incoming;
  if (incoming.compressionLevel > existing.compressionLevel) return existing;
  if (incoming.score > existing.score) return incoming;
  if (incoming.score < existing.score) return existing;

  if (incoming.tokenCount < existing.tokenCount) return incoming;
  return existing;
}

export function mergeSubCapsules(
  results: SubCapsuleResult[],
  tokenBudget: number,
  codeRatio = 0.8,
  clusterBySymbolId: ReadonlyMap<number, number> = new Map()
): PackResult {
  const codeBudget = Math.floor(tokenBudget * codeRatio);
  const observationBudget = tokenBudget - codeBudget;

  if (results.length === 0) {
    return {
      packed: [],
      observationBudget,
      tokensUsed: 0,
      fileSummaries: [],
    };
  }

  const dedupedBySymbolId = new Map<number, ScoredNode>();
  const priorityBySymbolId = new Map<number, number>();

  results.forEach((result, resultIndex) => {
    for (const node of result.packed) {
      const existing = dedupedBySymbolId.get(node.symbol.id);
      dedupedBySymbolId.set(node.symbol.id, existing ? choosePreferredNode(existing, node) : node);

      const priorityClass = result.pivotSymbolIds.has(node.symbol.id)
        ? 0
        : node.compressionLevel <= 1
          ? 1
          : 2;
      const priority = resultIndex * 10 + priorityClass;
      const currentPriority = priorityBySymbolId.get(node.symbol.id);
      if (currentPriority === undefined || priority < currentPriority) {
        priorityBySymbolId.set(node.symbol.id, priority);
      }
    }
  });

  const mergedNodes = [...dedupedBySymbolId.values()].sort((a, b) => {
    const aPriority = priorityBySymbolId.get(a.symbol.id) ?? Number.MAX_SAFE_INTEGER;
    const bPriority = priorityBySymbolId.get(b.symbol.id) ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;

    if (a.distance === 0 && b.distance !== 0) return -1;
    if (b.distance === 0 && a.distance !== 0) return 1;

    if (a.score !== b.score) return b.score - a.score;
    return a.compressionLevel - b.compressionLevel;
  });

  const packedResult = packNodesStoryMode(mergedNodes, tokenBudget, codeRatio, clusterBySymbolId);
  let tokensUsed = packedResult.tokensUsed;

  const fileSummaries = [...packedResult.fileSummaries];
  const seenSummaries = new Set(fileSummaries);

  for (const result of results) {
    for (const summary of result.fileSummaries) {
      if (seenSummaries.has(summary)) continue;
      const tokens = countTokens(summary);
      if (tokensUsed + tokens > codeBudget) continue;

      fileSummaries.push(summary);
      seenSummaries.add(summary);
      tokensUsed += tokens;
    }
  }

  return {
    packed: packedResult.packed,
    observationBudget,
    tokensUsed,
    fileSummaries,
  };
}
