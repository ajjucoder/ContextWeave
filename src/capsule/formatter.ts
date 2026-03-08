import type {
  ScoredNode,
  ObservationRecord,
  CapsuleMetadata,
  StructuredCapsuleOutput,
  StructuredCapsuleFile,
  StructuredCapsuleSuggestedRead,
  CapsuleConfidenceLabel,
} from "../core/types.js";
import type { QueryIntent } from "./intent-classifier.js";
import { classifyQueryIntent } from "./intent-classifier.js";

const LEVEL_LABEL: Record<number, string> = {
  0: "full",
  1: "skeleton",
  2: "summary",
  3: "reference",
};

const DOC_SCOPES = new Set(["documentation", "convention"]);
const DOC_QUERY_RE = /\b(docs?|documentation|architecture|convention|workflow|guide|readme|claude)\b/i;
const DEBUG_PATH_RE = /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./i;
const RUNTIME_PATH_RE = /(^|\/)(src|app|lib|server|api|routes?|services?)(\/|$)/i;

function estimateObservationTokens(note: string): number {
  return Math.max(1, Math.ceil(note.split(/\s+/).filter(Boolean).length * 1.3));
}

function selectObservations(
  observations: ObservationRecord[],
  metadata: CapsuleMetadata
): ObservationRecord[] {
  const intent = metadata.strategy?.intent;
  const docFocused = DOC_QUERY_RE.test(metadata.query);

  if (!docFocused && (intent === "symbol-lookup" || intent === "narrow" || intent === "debug")) {
    return observations.filter((observation) => !DOC_SCOPES.has(observation.scope));
  }

  let docBudget = 200;
  const selected: ObservationRecord[] = [];
  for (const observation of observations) {
    if (!DOC_SCOPES.has(observation.scope)) {
      selected.push(observation);
      continue;
    }

    if (!docFocused) {
      continue;
    }

    const estimatedTokens = estimateObservationTokens(observation.note);
    if (estimatedTokens > docBudget) {
      continue;
    }
    docBudget -= estimatedTokens;
    selected.push(observation);
  }
  return selected;
}

function toConfidenceLabel(metadata: CapsuleMetadata): CapsuleConfidenceLabel {
  if (metadata.quality.coverageConfidence >= 0.75 && !metadata.quality.lowConfidence) {
    return "HIGH";
  }
  if (metadata.quality.coverageConfidence >= 0.45) {
    return "MEDIUM";
  }
  return "LOW";
}

function getQueryTerms(metadata: CapsuleMetadata): string[] {
  const classified = classifyQueryIntent(metadata.query);
  return classified.focusTerms.length > 0 ? classified.focusTerms : classified.normalizedTerms;
}

function buildCoverageHaystack(nodes: ScoredNode[]): string {
  return nodes
    .map((node) => `${node.symbol.name} ${node.symbol.signature} ${node.file.path} ${node.rendered}`.toLowerCase())
    .join(" ");
}

function scoreFollowUpCandidate(
  node: ScoredNode,
  matchedTerms: string[],
  intent: QueryIntent,
  topFilePath?: string
): number {
  const unresolvedBoost = matchedTerms.length * 3;
  const compressionBoost = node.compressionLevel === 1 ? 0.5 : 0;
  const proximityBoost = topFilePath && node.file.path === topFilePath ? 1.2 : 0;

  if (intent === "symbol-lookup" || intent === "narrow") {
    return unresolvedBoost + (node.score ?? 0) + compressionBoost + proximityBoost + Math.max(0, 2 - node.distance) * 0.35;
  }
  if (intent === "debug") {
    return unresolvedBoost + (node.score ?? 0) + compressionBoost + (DEBUG_PATH_RE.test(node.file.path) ? 0.7 : 0);
  }
  if (intent === "task") {
    return unresolvedBoost + (node.score ?? 0) + compressionBoost + (RUNTIME_PATH_RE.test(node.file.path) ? 0.5 : 0);
  }
  return unresolvedBoost + (node.score ?? 0) + compressionBoost + (RUNTIME_PATH_RE.test(node.file.path) ? 0.5 : 0);
}

function rankFollowUpCandidates(
  packedNodes: ScoredNode[],
  metadata: CapsuleMetadata
): Array<{ node: ScoredNode; matchedTerms: string[] }> {
  const queryTerms = getQueryTerms(metadata);
  const resolvedTermsHaystack = buildCoverageHaystack(
    packedNodes.filter((node) => node.compressionLevel === 0)
  );
  const unresolvedTerms = queryTerms.filter((term) => !resolvedTermsHaystack.includes(term));
  const intent = metadata.strategy?.intent ?? "narrow";
  const topFilePath = packedNodes[0]?.file.path;

  return packedNodes
    .filter((node) => node.compressionLevel >= 1 && node.compressionLevel <= 2)
    .map((node) => {
      const haystack = buildCoverageHaystack([node]);
      const matchedTerms = unresolvedTerms.filter((term) => haystack.includes(term));
      const rankedScore = scoreFollowUpCandidate(node, matchedTerms, intent, topFilePath);
      return { node, matchedTerms, rankedScore };
    })
    .sort((left, right) => right.rankedScore - left.rankedScore)
    .slice(0, 5)
    .map(({ node, matchedTerms }) => ({ node, matchedTerms }));
}

function buildFollowUpReason(node: ScoredNode, matchedTerms: string[], intent: QueryIntent): string {
  const coverageReason = matchedTerms.length > 0
    ? `covers unresolved query terms: ${matchedTerms.join(", ")}`
    : `expands compressed context for ${node.symbol.name}`;

  if (intent === "symbol-lookup" || intent === "narrow") {
    return `${coverageReason}; nearest focused symbol in ${node.file.path}`;
  }
  if (intent === "debug") {
    return `${coverageReason}; likely failure surface or regression check`;
  }
  if (intent === "task") {
    return `${coverageReason}; likely implementation surface`;
  }
  return `${coverageReason}; broad runtime coverage`;
}

function buildSuggestedReads(
  packedNodes: ScoredNode[],
  metadata: CapsuleMetadata
): StructuredCapsuleSuggestedRead[] {
  const intent = metadata.strategy?.intent ?? "narrow";

  return rankFollowUpCandidates(packedNodes, metadata).map(({ node, matchedTerms }) => ({
    tool: "cw_read",
    args: {
      file: node.file.path,
      symbol: node.symbol.name,
    },
    reason: buildFollowUpReason(node, matchedTerms, intent),
  }));
}

function buildStructuredFiles(packedNodes: ScoredNode[], metadata: CapsuleMetadata): StructuredCapsuleFile[] {
  if (packedNodes.length === 0) return [];

  const queryTerms = getQueryTerms(metadata);
  const maxScore = Math.max(...packedNodes.map((node) => node.score ?? 0), 1);
  const byFile = new Map<string, ScoredNode[]>();

  for (const node of packedNodes) {
    const existing = byFile.get(node.file.path) ?? [];
    existing.push(node);
    byFile.set(node.file.path, existing);
  }

  return [...byFile.entries()]
    .map(([filePath, nodes]) => {
      const sorted = [...nodes].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
      const topNode = sorted[0]!;
      const haystack = buildCoverageHaystack(nodes);
      const matchedTerms = queryTerms.filter((term) => haystack.includes(term)).slice(0, 3);
      const reason = matchedTerms.length > 0
        ? `matches ${matchedTerms.join(", ")} via ${topNode.symbol.name}`
        : `contains top-ranked symbol ${topNode.symbol.name}`;

      return {
        path: filePath,
        relevance: Math.max(0, Math.min(1, (topNode.score ?? 0) / maxScore)),
        reason,
        symbols: sorted
          .map((node) => node.symbol.name)
          .filter((name, index, all) => all.indexOf(name) === index)
          .slice(0, 5),
        startLine: topNode.symbol.startLine,
        endLine: topNode.symbol.endLine,
      };
    })
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, 8);
}

export function formatCapsule(
  packedNodes: ScoredNode[],
  observations: ObservationRecord[],
  metadata: CapsuleMetadata,
  fileSummaries: string[] = []
): string {
  const visibleObservations = selectObservations(observations, metadata);
  const fileCount = new Set(packedNodes.map((n) => n.file.path)).size;
  const pivotPct = Math.round(metadata.quality.pivotCoverage * 100);
  const dependencyPct = Math.round(metadata.quality.dependencyCoverage * 100);
  const noisePct = Math.round(metadata.quality.noiseRatio * 100);
  const coverageConfidencePct = Math.round(metadata.quality.coverageConfidence * 100);
  const confidence = toConfidenceLabel(metadata);
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

  const followUpCandidates = rankFollowUpCandidates(packedNodes, metadata);

  const topDirectory = (() => {
    const firstPath = packedNodes[0]?.file.path?.replaceAll("\\", "/");
    if (!firstPath) return null;
    const parts = firstPath.split("/").filter(Boolean);
    if (parts.length <= 1) return parts[0] ?? null;
    return parts.slice(0, -1).join("/");
  })();

  const highConfObs = visibleObservations.filter((o) => o.confidence >= 0.8);
  const lowConfObs = visibleObservations.filter((o) => o.confidence < 0.8);

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
    for (const { node, matchedTerms } of followUpCandidates) {
      const lineCount = (node.symbol.endLine ?? 0) - (node.symbol.startLine ?? 0) + 1;
      const scoreStr = (node.score ?? 0).toFixed(2);
      const detail = matchedTerms.length > 0 ? `, covers ${matchedTerms.join(", ")}` : "";
      parts.push(`  cw_read(symbol: "${node.file.path}:${node.symbol.name}")  — ${lineCount} lines, scored ${scoreStr}${detail}`);
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
      const first = followUpCandidates[0]!.node;
      parts.push(`- Read the highest-value compressed symbol next: cw_read(symbol: "${first.file.path}:${first.symbol.name}")`);
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

export function buildStructuredCapsuleOutput(
  packedNodes: ScoredNode[],
  observations: ObservationRecord[],
  metadata: CapsuleMetadata,
  fileSummaries: string[] = []
): StructuredCapsuleOutput {
  const visibleObservations = selectObservations(observations, metadata);
  const text = formatCapsule(packedNodes, observations, metadata, fileSummaries);

  return {
    query: metadata.query,
    intent: metadata.strategy?.intent ?? "narrow",
    confidence: toConfidenceLabel(metadata),
    uncertainty: metadata.quality.uncertainty.toUpperCase(),
    tokenBudget: metadata.tokenBudget,
    tokensUsed: metadata.tokensUsed,
    tokenUtilization: metadata.tokenBudget > 0 ? metadata.tokensUsed / metadata.tokenBudget : 0,
    files: buildStructuredFiles(packedNodes, metadata),
    suggestedReads: buildSuggestedReads(packedNodes, metadata),
    observations: visibleObservations.map((observation) => `[${observation.scope}] ${observation.note}`),
    text,
  };
}
