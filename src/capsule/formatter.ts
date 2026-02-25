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
  metadata: CapsuleMetadata
): string {
  const fileCount = new Set(packedNodes.map((n) => n.file.path)).size;
  const pivotPct = Math.round(metadata.quality.pivotCoverage * 100);
  const dependencyPct = Math.round(metadata.quality.dependencyCoverage * 100);
  const noisePct = Math.round(metadata.quality.noiseRatio * 100);
  const coverageConfidencePct = Math.round(metadata.quality.coverageConfidence * 100);
  const confidence = metadata.quality.lowConfidence ? "LOW" : "HIGH";

  const header = [
    "--- ContextWeave Capsule ---",
    `Query: ${metadata.query}`,
    `Mode: ${metadata.mode}`,
    `Tokens: ${metadata.tokensUsed}/${metadata.tokenBudget}`,
    `Symbols: ${packedNodes.length} across ${fileCount} files`,
    `Quality: ${confidence} confidence (${metadata.quality.uncertainty})`,
    `Coverage confidence: ${coverageConfidencePct}%`,
    `Uncertainty flag: ${metadata.quality.uncertaintyFlag ? "true" : "false"}`,
    `Retrieval: stageA ${metadata.quality.retrieval.stageACandidateCount} -> stageB ${metadata.quality.retrieval.stageBSelectedCount}`,
    `Coverage: pivots ${metadata.quality.pivotsIncluded}/${metadata.quality.pivotCount} (${pivotPct}%), dependencies ${dependencyPct}%, L3 noise ${noisePct}%`,
    "---",
  ].join("\n");

  const byFile = new Map<string, ScoredNode[]>();
  for (const node of packedNodes) {
    const existing = byFile.get(node.file.path) ?? [];
    existing.push(node);
    byFile.set(node.file.path, existing);
  }

  const codeSections: string[] = [];
  for (const [filePath, nodes] of byFile) {
    codeSections.push(`\n// === ${filePath} ===`);
    for (const node of nodes) {
      codeSections.push(`// [${LEVEL_LABEL[node.compressionLevel]}]`);
      codeSections.push(node.rendered);
    }
  }

  const parts = [header, ...codeSections];

  if (metadata.quality.reasons.length > 0) {
    parts.push("\n--- Quality Notes ---");
    for (const reason of metadata.quality.reasons) {
      parts.push(`- ${reason}`);
    }
  }

  if (observations.length > 0) {
    parts.push("\n--- Observations ---");
    for (const obs of observations) {
      parts.push(`[${obs.scope}] ${obs.note} (confidence: ${obs.confidence})`);
    }
  }

  return parts.join("\n");
}
