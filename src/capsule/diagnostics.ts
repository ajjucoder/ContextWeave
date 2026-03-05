import type { CompressionLevel } from "../core/types.js";

export interface DiagnosticMetadataSnapshot {
  query: string;
  tokenBudget: number;
  tokensUsed: number;
  symbolCount: number;
  fileCount: number;
  compressionBreakdown: Record<CompressionLevel, number>;
  quality: {
    pivotCount: number;
    pivotsIncluded: number;
    pivotCoverage: number;
    dependencyCoverage: number;
    retrieval: {
      stageACandidateCount: number;
      stageBSelectedCount: number;
    };
  };
}

export interface CapsuleDiagnostic {
  queryClass: "narrow" | "broad" | "task";
  pivotStats: {
    rawCandidates: number;
    afterRanking: number;
    afterPacking: number;
    topPivotScores: number[];
    bottomPivotScores: number[];
  };
  coverageStats: {
    filesRetrieved: number;
    filesRelevant: number;
    symbolsRetrieved: number;
    symbolsPacked: number;
    tokenBudgetUsed: number;
    l0Count: number;
    l1Count: number;
    l2Count: number;
    l3Count: number;
  };
  bottleneck: "pivot_flood" | "bfs_noise" | "packing_scatter" | "budget_exhaustion" | "none";
  bottlenecks: Array<"pivot_flood" | "bfs_noise" | "packing_scatter" | "budget_exhaustion">;
  bottleneckDetail: string;
  suggestion: string;
}

import { TASK_VERBS } from "./intent-classifier.js";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function classifyQuery(
  query: string,
  pivotCount: number
): "narrow" | "broad" | "task" {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (words.some((word) => TASK_VERBS.has(word))) {
    return "task";
  }

  if (words.length <= 3 && pivotCount <= 30) {
    return "narrow";
  }

  return "broad";
}

export function diagnose(
  metadata: DiagnosticMetadataSnapshot,
  pivotScores: number[],
  preClassifiedIntent?: "narrow" | "broad" | "task"
): CapsuleDiagnostic {
  const queryClass = preClassifiedIntent ?? classifyQuery(metadata.query, metadata.quality.pivotCount);

  const sortedScores = [...pivotScores].sort((a, b) => b - a);
  const topPivotScores = sortedScores.slice(0, 5);
  const bottomPivotScores =
    sortedScores.length <= 5 ? sortedScores : sortedScores.slice(-5);

  const l0Count = metadata.compressionBreakdown[0] ?? 0;
  const l1Count = metadata.compressionBreakdown[1] ?? 0;
  const l2Count = metadata.compressionBreakdown[2] ?? 0;
  const l3Count = metadata.compressionBreakdown[3] ?? 0;

  const tokenBudgetUsed = metadata.tokenBudget > 0
    ? clamp(metadata.tokensUsed / metadata.tokenBudget, 0, 1)
    : 0;
  const symbolsPerFile = metadata.fileCount > 0
    ? metadata.symbolCount / metadata.fileCount
    : 0;
  const packRetention = metadata.quality.retrieval.stageBSelectedCount > 0
    ? metadata.symbolCount / metadata.quality.retrieval.stageBSelectedCount
    : 0;

  type BottleneckKind = "pivot_flood" | "bfs_noise" | "packing_scatter" | "budget_exhaustion";
  const detectedBottlenecks: BottleneckKind[] = [];
  const details: string[] = [];
  const suggestions: string[] = [];

  if (metadata.quality.retrieval.stageACandidateCount > 200) {
    detectedBottlenecks.push("pivot_flood");
    details.push(`Stage A produced ${metadata.quality.retrieval.stageACandidateCount} candidates, overwhelming ranking quality.`);
    suggestions.push("Narrow the initial pivot query terms or apply stronger intent-aware filtering before ranking.");
  }
  if (tokenBudgetUsed > 0.9 && metadata.quality.pivotCoverage < 0.5) {
    detectedBottlenecks.push("budget_exhaustion");
    details.push(`Token usage reached ${Math.round(tokenBudgetUsed * 100)}% with only ${Math.round(metadata.quality.pivotCoverage * 100)}% pivot coverage.`);
    suggestions.push("Increase effective retrieval budget or improve compression to preserve higher-value pivots.");
  }
  if (
    metadata.quality.retrieval.stageBSelectedCount >= 50 &&
    packRetention < 0.35 &&
    metadata.quality.dependencyCoverage < 0.35
  ) {
    detectedBottlenecks.push("bfs_noise");
    details.push(`Stage B selected ${metadata.quality.retrieval.stageBSelectedCount} symbols but only ${metadata.symbolCount} were packed.`);
    suggestions.push("Constrain BFS expansion with stronger lexical or module locality guards.");
  }
  if (metadata.fileCount >= 10 && symbolsPerFile < 3) {
    detectedBottlenecks.push("packing_scatter");
    details.push(`Packed symbols are spread across ${metadata.fileCount} files at ${symbolsPerFile.toFixed(2)} symbols/file.`);
    suggestions.push("Use story-complete packing to favor denser, coherent file groups before tail references.");
  }

  const bottleneck: CapsuleDiagnostic["bottleneck"] = detectedBottlenecks[0] ?? "none";
  const bottleneckDetail = details.length > 0 ? details.join(" ") : "No obvious bottleneck detected in the current pipeline stages.";
  const suggestion = suggestions.length > 0 ? suggestions.join(" ") : "No immediate action needed. Keep monitoring this query class over time.";

  return {
    queryClass,
    pivotStats: {
      rawCandidates: metadata.quality.retrieval.stageACandidateCount,
      afterRanking: metadata.quality.pivotCount,
      afterPacking: metadata.quality.pivotsIncluded,
      topPivotScores,
      bottomPivotScores,
    },
    coverageStats: {
      filesRetrieved: metadata.fileCount,
      filesRelevant: metadata.quality.pivotsIncluded > 0 ? metadata.fileCount : 0,
      symbolsRetrieved: metadata.quality.retrieval.stageBSelectedCount,
      symbolsPacked: metadata.symbolCount,
      tokenBudgetUsed,
      l0Count,
      l1Count,
      l2Count,
      l3Count,
    },
    bottleneck,
    bottlenecks: detectedBottlenecks,
    bottleneckDetail,
    suggestion,
  };
}
