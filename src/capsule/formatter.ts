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
  const uncertainty = metadata.quality.uncertainty.toUpperCase();

  const strategyLabel = metadata.strategy
    ? `${metadata.strategy.mode} (${metadata.strategy.subQueryCount} sub-queries)`
    : "single-pass";

  const header = [
    "--- ContextWeave Capsule ---",
    `Query: ${metadata.query}`,
    `Mode: ${metadata.mode} | Strategy: ${strategyLabel}`,
    `Tokens: ${metadata.tokensUsed}/${metadata.tokenBudget}`,
    `Symbols: ${packedNodes.length} across ${fileCount} files`,
    `Confidence: ${confidence} | Uncertainty: ${uncertainty}`,
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
    const dirParts = parts.length > 1 ? parts.slice(0, -1) : parts;
    if (dirParts.length >= 2) {
      return `${dirParts[0]}/${dirParts[1]}`;
    }
    return dirParts[0] ?? "root";
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

  const followUpCandidates = packedNodes
    .filter((n) => n.compressionLevel >= 1 && n.compressionLevel <= 2)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5);

  const topDirectory = (() => {
    const firstPath = packedNodes[0]?.file.path?.replaceAll("\\", "/");
    if (!firstPath) return null;
    const parts = firstPath.split("/").filter(Boolean);
    if (parts.length <= 1) return parts[0] ?? null;
    return parts.slice(0, -1).join("/");
  })();

  const highConfObs = observations.filter((o) => o.confidence >= 0.8);
  const lowConfObs = observations.filter((o) => o.confidence < 0.8);

  const parts = [header];

  if (highConfObs.length > 0) {
    parts.push("\n--- Key Context ---");
    for (const obs of highConfObs) {
      parts.push(`[${obs.scope}] ${obs.note}`);
    }
  }

  parts.push(...codeSections);

  if (followUpCandidates.length > 0) {
    parts.push("\n--- Follow-Up Reads ---");
    parts.push("These symbols were compressed. Use cw_read for full source:");
    for (const node of followUpCandidates) {
      const lineCount = (node.symbol?.endLine ?? 0) - (node.symbol?.startLine ?? 0) + 1;
      const name = node.symbol?.name ?? "unknown";
      const scoreStr = (node.score ?? 0).toFixed(2);
      parts.push(`  cw_read(symbol: "${name}")  — ${lineCount} lines, scored ${scoreStr}`);
    }
  }

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

  if (metadata.quality.lowConfidence) {
    parts.push("\n--- Next Actions ---");
    if (followUpCandidates.length > 0) {
      const first = followUpCandidates[0]!;
      const symbolName = first.symbol?.name ?? "unknown";
      parts.push(`- Read the highest-value compressed symbol next: cw_read(symbol: "${symbolName}")`);
    } else {
      parts.push(`- Expand the search surface first: cw_overview(query: "${metadata.query}")`);
      parts.push(`- If you need exact text matches, run: cw_grep(query: "${metadata.query}")`);
    }
    if (topDirectory) {
      parts.push(`- Narrow the capsule to the most relevant directory: cw_capsule(query: "${metadata.query}", path: "${topDirectory}")`);
    }
  }

  if (lowConfObs.length > 0) {
    parts.push("\n--- Observations ---");
    for (const obs of lowConfObs) {
      parts.push(`[${obs.scope}] ${obs.note} (confidence: ${obs.confidence})`);
    }
  }

  return parts.join("\n");
}
