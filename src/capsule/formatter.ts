import { isUiLikePath } from "./signals.js";
import { splitIdentifier } from "../utils/camel-split.js";
import type {
  ScoredNode,
  ObservationRecord,
  CapsuleMetadata,
  StructuredCapsuleOutput,
  StructuredCapsuleFile,
  StructuredCapsuleSuggestedRead,
} from "../core/types.js";

const LEVEL_LABEL: Record<number, string> = {
  0: "full",
  1: "skeleton",
  2: "summary",
  3: "reference",
};

const DOC_SCOPES = new Set(["documentation", "convention"]);
const DOC_QUERY_RE = /\b(docs?|documentation|architecture|convention|workflow|guide|readme|claude)\b/i;
const UI_QUERY_RE = /\b(ui|ux|component|components|view|views|page|pages|modal|form)\b/i;
const ACTION_SIGNAL_RE = /\b(handle|submit|create|send|post|get|load|exchange|verify|persist|callback|refresh|route)\b/i;

function estimateObservationTokens(note: string): number {
  return Math.max(1, Math.ceil(note.split(/\s+/).filter(Boolean).length * 1.3));
}

export function selectObservations(
  observations: ObservationRecord[],
  metadata: CapsuleMetadata
): ObservationRecord[] {
  const intent = metadata.strategy?.intent;
  const docFocused = DOC_QUERY_RE.test(metadata.query);

  if (!docFocused && intent === "narrow") {
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

export function formatCapsule(
  packedNodes: ScoredNode[],
  observations: ObservationRecord[],
  metadata: CapsuleMetadata,
  fileSummaries: string[] = []
): string {
  const visibleNodes = (() => {
    const intent = metadata.strategy?.intent;
    if (
      !(intent === "broad" || intent === "task" || intent === "debug") ||
      UI_QUERY_RE.test(metadata.query)
    ) {
      return packedNodes;
    }

    const nonUiCount = packedNodes.filter((node) => !isUiLikePath(node.file.path)).length;
    if (nonUiCount < 2) {
      return packedNodes;
    }

    const filtered = packedNodes.filter((node) => {
      if (!isUiLikePath(node.file.path)) return true;
      const nameAndSignature = `${node.symbol?.name ?? ""} ${node.symbol?.signature ?? ""}`.toLowerCase();
      return ACTION_SIGNAL_RE.test(nameAndSignature);
    });
    return filtered.length > 0 ? filtered : packedNodes;
  })();

  const visibleObservations = selectObservations(observations, metadata);
  const fileCount = new Set(visibleNodes.map((n) => n.file.path)).size;
  const pivotPct = Math.round(metadata.quality.pivotCoverage * 100);
  const dependencyPct = Math.round(metadata.quality.dependencyCoverage * 100);
  const noisePct = Math.round(metadata.quality.noiseRatio * 100);
  const coverageConfidencePct = Math.round(metadata.quality.coverageConfidence * 100);
  const coverageConf = metadata.quality.coverageConfidence;
  const confidence = coverageConf < 0.45 ? "LOW" : coverageConf < 0.75 ? "MEDIUM" : "HIGH";
  const uncertainty = metadata.quality.uncertainty.toUpperCase();

  const strategyLabel = metadata.strategy
    ? `${metadata.strategy.mode} (${metadata.strategy.subQueryCount} sub-queries)`
    : "single-pass";

  const header = [
    "--- ContextWeave Capsule ---",
    `Query: ${metadata.query}`,
    `Mode: ${metadata.mode} | Strategy: ${strategyLabel}`,
    `Tokens: ${metadata.tokensUsed}/${metadata.tokenBudget}`,
    `Symbols: ${visibleNodes.length} across ${fileCount} files`,
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

  for (const node of visibleNodes) {
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

  // Extract query terms for query-aware follow-up ranking (Phase 4.5)
  const queryTerms = metadata.query
    .replace(/[^a-zA-Z0-9_\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  // Compute which query terms are already covered by FULL symbols (compression level 0)
  const coveredTerms = new Set<string>();
  for (const node of visibleNodes) {
    if (node.compressionLevel === 0 && node.symbol?.name) {
      const nameLower = node.symbol.name.toLowerCase();
      const nameTerms = splitIdentifier(node.symbol.name);
      for (const qt of queryTerms) {
        if (nameLower.includes(qt) || nameTerms.includes(qt)) {
          coveredTerms.add(qt);
        }
      }
    }
  }

  const shownSymbolNames = new Set(
    visibleNodes.filter((n) => n.compressionLevel === 0).map((n) => n.symbol?.name ?? "")
  );
  const topScore = visibleNodes.reduce((max, n) => Math.max(max, n.score ?? 0), 0);
  const followUpCandidates = visibleNodes
    .filter((n) => n.compressionLevel >= 1 && n.compressionLevel <= 2)
    .filter((n) => !shownSymbolNames.has(n.symbol?.name ?? ""))
    .map((n) => {
      const nameLower = (n.symbol?.name ?? "").toLowerCase();
      const nameTerms = splitIdentifier(n.symbol?.name ?? "");
      const uncoveredHits = queryTerms.filter(
        (qt) => !coveredTerms.has(qt) && (nameLower.includes(qt) || nameTerms.includes(qt))
      ).length;
      const hasQueryOverlap =
        uncoveredHits > 0 ||
        queryTerms.some((qt) => nameLower.includes(qt) || nameTerms.includes(qt));
      const meetsScoreThreshold = topScore === 0 || (n.score ?? 0) >= topScore * 0.6;
      return { node: n, uncoveredHits, hasQueryOverlap, meetsScoreThreshold };
    })
    .filter((item) => item.hasQueryOverlap)
    .sort((a, b) => {
      if (b.uncoveredHits !== a.uncoveredHits) return b.uncoveredHits - a.uncoveredHits;
      return (b.node.score ?? 0) - (a.node.score ?? 0);
    })
    .slice(0, 5)
    .map((item) => item.node);

  const topDirectory = (() => {
    const firstPath = visibleNodes[0]?.file.path?.replaceAll("\\", "/");
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

  const overlappingPatterns = (metadata.patterns ?? [])
    .map((pattern) => ({
      pattern,
      overlap: pattern.files.filter((file) => visibleNodes.some((node) => node.file.path === file)).length,
    }))
    .filter(
      ({ overlap }) =>
        overlap > 0 && (metadata.strategy?.intent === "broad" || metadata.strategy?.intent === "task")
    )
    .sort((a, b) => b.overlap - a.overlap || b.pattern.confidence - a.pattern.confidence)
    .slice(0, 3);

  if (overlappingPatterns.length > 0) {
    parts.push("\n--- Detected Patterns ---");
    for (const { pattern, overlap } of overlappingPatterns) {
      parts.push(`- ${pattern.name} (${Math.round(pattern.confidence * 100)}% confidence)`);
      parts.push(`  ${pattern.description}`);
      parts.push(`  ${overlap} of ${pattern.files.length} files in this capsule follow the pattern (${pattern.signature.directoryPattern})`);
    }
  }

  parts.push(...codeSections);

  if (followUpCandidates.length > 0) {
    parts.push("\n--- Follow-Up Reads ---");
    parts.push("These symbols were compressed. Use cw_read for full source:");
    for (const node of followUpCandidates) {
      const lineCount = (node.symbol?.endLine ?? 0) - (node.symbol?.startLine ?? 0) + 1;
      const name = node.symbol?.name ?? "unknown";
      const filePath = node.file?.path ?? "";
      const scoreStr = (node.score ?? 0).toFixed(2);
      if (filePath) {
        parts.push(`  cw_read(file: "${filePath}", symbol: "${name}")  — ${lineCount} lines, scored ${scoreStr}`);
      } else {
        parts.push(`  cw_read(symbol: "${name}")  — ${lineCount} lines, scored ${scoreStr}`);
      }
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
      const filePath = first.file?.path ?? "";
      const readArgs = filePath
        ? `file: "${filePath}", symbol: "${symbolName}"`
        : `symbol: "${symbolName}"`;
      parts.push(`- Read the highest-value compressed symbol next: cw_read(${readArgs})`);
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

  if (metadata.previouslyCovered && metadata.previouslyCovered.length > 0) {
    parts.push(`\n--- Previously Shown (skipped to save tokens) ---`);
    parts.push(metadata.previouslyCovered.join(", "));
  }

  return parts.join("\n");
}

export function buildStructuredOutput(
  packedNodes: ScoredNode[],
  observations: ObservationRecord[],
  metadata: CapsuleMetadata,
  text: string
): StructuredCapsuleOutput {
  const intent = metadata.strategy?.intent ?? "narrow";
  const confidenceScore = metadata.quality.coverageConfidence;
  const confidence = confidenceScore < 0.45 ? "LOW" : confidenceScore < 0.75 ? "MEDIUM" : "HIGH";
  const tokenUtilization = metadata.tokenBudget > 0 ? metadata.tokensUsed / metadata.tokenBudget : 0;

  // Build per-file data
  const fileMap = new Map<string, { relevance: number; symbols: string[]; startLine?: number; endLine?: number }>();
  for (const node of packedNodes) {
    const path = node.file.path;
    const entry = fileMap.get(path) ?? { relevance: 0, symbols: [] };
    entry.relevance = Math.max(entry.relevance, node.score ?? 0);
    if (node.symbol?.name) entry.symbols.push(node.symbol.name);
    if (node.symbol?.startLine !== undefined) {
      if (entry.startLine === undefined || node.symbol.startLine < entry.startLine) {
        entry.startLine = node.symbol.startLine;
      }
    }
    if (node.symbol?.endLine !== undefined) {
      if (entry.endLine === undefined || node.symbol.endLine > entry.endLine) {
        entry.endLine = node.symbol.endLine;
      }
    }
    fileMap.set(path, entry);
  }

  const maxRelevance = Math.max(...[...fileMap.values()].map((e) => e.relevance), 1);
  const files: StructuredCapsuleFile[] = [...fileMap.entries()]
    .sort((a, b) => b[1].relevance - a[1].relevance)
    .map(([path, entry]) => ({
      path,
      relevance: Math.round((entry.relevance / maxRelevance) * 100) / 100,
      reason: `Matched ${entry.symbols.length} symbol(s): ${entry.symbols.slice(0, 3).join(", ")}`,
      symbols: entry.symbols,
      startLine: entry.startLine,
      endLine: entry.endLine,
    }));

  // Build suggested reads using query-relevance scoring (same logic as text follow-ups)
  const structuredQueryTerms = metadata.query
    .replace(/[^a-zA-Z0-9_\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const structuredCoveredTerms = new Set<string>();
  for (const node of packedNodes) {
    if (node.compressionLevel === 0 && node.symbol?.name) {
      const nameLower = node.symbol.name.toLowerCase();
      const nameTerms = splitIdentifier(node.symbol.name);
      for (const qt of structuredQueryTerms) {
        if (nameLower.includes(qt) || nameTerms.includes(qt)) {
          structuredCoveredTerms.add(qt);
        }
      }
    }
  }

  const structuredShownNames = new Set(
    packedNodes.filter((n) => n.compressionLevel === 0).map((n) => n.symbol?.name ?? "")
  );
  const structuredTopScore = packedNodes.reduce((max, n) => Math.max(max, n.score ?? 0), 0);
  const suggestedReads: StructuredCapsuleSuggestedRead[] = packedNodes
    .filter((n) => n.compressionLevel >= 1 && n.symbol?.name && n.file?.path)
    .filter((n) => !structuredShownNames.has(n.symbol?.name ?? ""))
    .map((n) => {
      const nameLower = (n.symbol?.name ?? "").toLowerCase();
      const nameTerms = splitIdentifier(n.symbol?.name ?? "");
      const uncoveredHits = structuredQueryTerms.filter(
        (qt) => !structuredCoveredTerms.has(qt) && (nameLower.includes(qt) || nameTerms.includes(qt))
      ).length;
      const hasQueryOverlap =
        uncoveredHits > 0 ||
        structuredQueryTerms.some((qt) => nameLower.includes(qt) || nameTerms.includes(qt));
      const meetsScoreThreshold = structuredTopScore === 0 || (n.score ?? 0) >= structuredTopScore * 0.6;
      return { node: n, uncoveredHits, hasQueryOverlap, meetsScoreThreshold };
    })
    .filter((item) => item.hasQueryOverlap)
    .sort((a, b) => {
      if (b.uncoveredHits !== a.uncoveredHits) return b.uncoveredHits - a.uncoveredHits;
      return (b.node.score ?? 0) - (a.node.score ?? 0);
    })
    .slice(0, 5)
    .map((item) => ({
      tool: "cw_read" as const,
      args: { file: item.node.file.path, symbol: item.node.symbol!.name },
      reason: `Compressed at level ${item.node.compressionLevel}, score ${(item.node.score ?? 0).toFixed(2)}`,
    }));

  const visibleObs = observations.filter((o) => o.confidence >= 0.5);

  return {
    query: metadata.query,
    intent,
    confidence,
    uncertainty: metadata.quality.uncertainty,
    tokenBudget: metadata.tokenBudget,
    tokensUsed: metadata.tokensUsed,
    tokenUtilization: Math.round(tokenUtilization * 100) / 100,
    files,
    suggestedReads,
    observations: visibleObs.map((o) => `[${o.scope}] ${o.note}`),
    text,
  };
}
