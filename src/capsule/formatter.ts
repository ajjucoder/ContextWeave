import type { ScoredNode, ObservationRecord, CapsuleMetadata } from "../core/types.js";

const LEVEL_LABEL: Record<number, string> = {
  0: "full",
  1: "skeleton",
  2: "summary",
  3: "reference",
};

export function formatCapsule(
  packedNodes: ScoredNode[],
  observations: ObservationRecord[],
  metadata: CapsuleMetadata,
  fileSummaries: string[] = []
): string {
  const fileCount = new Set(packedNodes.map((n) => n.file.path)).size;
  const pivotPct = Math.round(metadata.quality.pivotCoverage * 100);
  const dependencyPct = Math.round(metadata.quality.dependencyCoverage * 100);
  const noisePct = Math.round(metadata.quality.noiseRatio * 100);
  const coverageConfidencePct = Math.round(metadata.quality.coverageConfidence * 100);
  const confidence = metadata.quality.lowConfidence ? "LOW" : "HIGH";

  const strategyLabel = metadata.strategy
    ? `${metadata.strategy.mode} (${metadata.strategy.subQueryCount} sub-queries)`
    : "single-pass";

  const header = [
    "--- ContextWeave Capsule ---",
    `Query: ${metadata.query}`,
    `Mode: ${metadata.mode} | Strategy: ${strategyLabel}`,
    `Tokens: ${metadata.tokensUsed}/${metadata.tokenBudget}`,
    `Symbols: ${packedNodes.length} across ${fileCount} files`,
    `Quality: ${confidence} confidence (${metadata.quality.uncertainty})`,
    `Coverage confidence: ${coverageConfidencePct}%`,
    `Uncertainty flag: ${metadata.quality.uncertaintyFlag ? "true" : "false"}`,
    `Retrieval: stageA ${metadata.quality.retrieval.stageACandidateCount} -> stageB ${metadata.quality.retrieval.stageBSelectedCount}`,
    `Coverage: pivots ${metadata.quality.pivotsIncluded}/${metadata.quality.pivotCount} (${pivotPct}%), dependencies ${dependencyPct}%, L3 noise ${noisePct}%`,
    "---",
  ].join("\n");

  const byCluster = new Map<string, Map<string, ScoredNode[]>>();
  const clusterFromPath = (filePath: string): string => {
    const normalized = filePath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0] ?? "root";
  };

  for (const node of packedNodes) {
    const clusterKey = clusterFromPath(node.file.path);
    const fileGroup = byCluster.get(clusterKey) ?? new Map<string, ScoredNode[]>();
    const nodes = fileGroup.get(node.file.path) ?? [];
    nodes.push(node);
    fileGroup.set(node.file.path, nodes);
    byCluster.set(clusterKey, fileGroup);
  }

  const codeSections: string[] = [];
  const renderClustered = metadata.strategy?.mode === "multi-pass";

  if (renderClustered) {
    for (const [cluster, fileGroup] of byCluster) {
      codeSections.push(`\n// === [Cluster: ${cluster}] ===`);
      for (const [filePath, nodes] of fileGroup) {
        codeSections.push(`// === ${filePath} ===`);
        for (const node of nodes) {
          codeSections.push(`// [${LEVEL_LABEL[node.compressionLevel]}]`);
          codeSections.push(node.rendered);
        }
      }
    }
  } else {
    for (const [, fileGroup] of byCluster) {
      for (const [filePath, nodes] of fileGroup) {
        codeSections.push(`\n// === ${filePath} ===`);
        for (const node of nodes) {
          codeSections.push(`// [${LEVEL_LABEL[node.compressionLevel]}]`);
          codeSections.push(node.rendered);
        }
      }
    }
  }

  const parts = [header, ...codeSections];

  if (fileSummaries.length > 0) {
    parts.push("\n--- Unpacked Files ---");
    for (const summary of fileSummaries) {
      parts.push(summary);
    }
  }

  if (metadata.quality.reasons.length > 0) {
    parts.push("\n--- Quality Notes ---");
    for (const reason of metadata.quality.reasons) {
      parts.push(`- ${reason}`);
    }
  }

  if (metadata.diagnostics && metadata.quality.lowConfidence) {
    parts.push("\n--- Diagnostics ---");
    parts.push(`Class: ${metadata.diagnostics.queryClass}`);
    parts.push(`Bottleneck: ${metadata.diagnostics.bottleneck}`);
    parts.push(metadata.diagnostics.bottleneckDetail);
    parts.push(`Suggestion: ${metadata.diagnostics.suggestion}`);
  }

  if (observations.length > 0) {
    parts.push("\n--- Observations ---");
    for (const obs of observations) {
      parts.push(`[${obs.scope}] ${obs.note} (confidence: ${obs.confidence})`);
    }
  }

  return parts.join("\n");
}
