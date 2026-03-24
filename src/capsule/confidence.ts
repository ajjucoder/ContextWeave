import type { CapsuleUncertainty } from "../core/types.js";
import type { QueryIntent } from "./intent-classifier.js";

export interface ConfidenceParams {
  intent: QueryIntent;
  pivotCount: number;
  pivotsIncluded: number;
  relevantPivotsIncluded: number;
  totalRelevantPivots: number;
  dependencyCoverage: number;
  noiseRatio: number;
  fileSummaryCount: number;
  tokenUtilization: number;
  queryTermCoverage?: number;
  retrievalSurfaceScore?: number;
  moduleCoverageStats?: {
    packedClusters: number;
    relevantClusters: number;
    avgSymbolsPerFile: number;
    maxSymbolsPerFile: number;
  };
  packedSymbolNames?: string[];
  queryTerms?: string[];
  layerCount?: number;
  packedFilePaths?: string[];
}

export type ConfidenceLabel = "LOW" | "MEDIUM" | "HIGH";

export function confidenceToLabel(confidence: number): ConfidenceLabel {
  return confidence < 0.45 ? "LOW" : confidence < 0.75 ? "MEDIUM" : "HIGH";
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function tokenizeForMatch(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function computeCoverageConfidence(params: ConfidenceParams): number {
  const {
    intent,
    pivotCount,
    pivotsIncluded,
    relevantPivotsIncluded,
    totalRelevantPivots,
    dependencyCoverage,
    noiseRatio,
    fileSummaryCount,
    tokenUtilization,
    queryTermCoverage = 1,
    retrievalSurfaceScore = 1,
    moduleCoverageStats,
    packedSymbolNames,
    queryTerms,
  } = params;

  const relevantCoverage =
    totalRelevantPivots === 0
      ? pivotsIncluded > 0
        ? 0.5
        : 0
      : relevantPivotsIncluded / totalRelevantPivots;
  const pivotCoverage = pivotCount === 0 ? 0 : pivotsIncluded / pivotCount;

  const summaryBoost = Math.min(0.15, fileSummaryCount * 0.03);
  const moduleCoverage =
    moduleCoverageStats && moduleCoverageStats.relevantClusters > 0
      ? moduleCoverageStats.packedClusters / moduleCoverageStats.relevantClusters
      : moduleCoverageStats && moduleCoverageStats.packedClusters > 0
        ? 0.5
        : 0;
  const storyCompleteness =
    moduleCoverageStats && moduleCoverageStats.maxSymbolsPerFile > 0
      ? Math.min(
        1,
        moduleCoverageStats.avgSymbolsPerFile / moduleCoverageStats.maxSymbolsPerFile
      )
      : 0;
  const lexicalSurface = Math.min(queryTermCoverage, retrievalSurfaceScore);

  let confidence = clamp(
    relevantCoverage * 0.5 +
      dependencyCoverage * 0.2 +
      (1 - noiseRatio) * 0.15 +
      summaryBoost +
      0.05
  );
  if (intent === "broad") {
    confidence = clamp(
      moduleCoverage * 0.35 +
        relevantCoverage * 0.25 +
        (1 - noiseRatio) * 0.15 +
        summaryBoost +
        0.10
    );
    const structuralHealth = clamp(
      moduleCoverage * 0.45 +
        relevantCoverage * 0.35 +
        (1 - noiseRatio) * 0.2
    );
    const breadthFactor =
      retrievalSurfaceScore >= 0.75
        ? Math.max(lexicalSurface, structuralHealth * 0.52)
        : lexicalSurface;
    confidence = clamp(confidence * (0.35 + 0.65 * breadthFactor));
  } else if (intent === "task") {
    confidence = clamp(
      storyCompleteness * 0.3 +
        moduleCoverage * 0.25 +
        relevantCoverage * 0.2 +
        (1 - noiseRatio) * 0.1 +
        0.15
    );
    const structuralHealth = clamp(
      storyCompleteness * 0.35 +
        moduleCoverage * 0.3 +
        relevantCoverage * 0.2 +
        (1 - noiseRatio) * 0.15
    );
    const breadthFactor =
      retrievalSurfaceScore >= 0.7
        ? Math.max(lexicalSurface, structuralHealth * 0.5)
        : lexicalSurface;
    confidence = clamp(confidence * (0.45 + 0.55 * breadthFactor));
  }

  if (tokenUtilization < 0.15) {
    confidence = Math.min(confidence, 0.25);
  } else if (tokenUtilization < 0.25) {
    confidence = Math.min(confidence, 0.35);
  } else if (tokenUtilization < 0.35) {
    confidence = Math.min(confidence, 0.45);
  } else if (tokenUtilization < 0.50) {
    confidence = Math.min(confidence, 0.55);
  } else if (tokenUtilization < 0.60) {
    confidence = Math.min(confidence, 0.65);
  } else if (tokenUtilization < 0.70) {
    confidence = Math.min(confidence, 0.72);
  }

  if (noiseRatio > 0.60) {
    confidence = Math.min(confidence, 0.35);
  } else if (noiseRatio > 0.45) {
    confidence = Math.min(confidence, 0.50);
  } else if (noiseRatio > 0.30) {
    confidence = Math.min(confidence, 0.65);
  }

  if (pivotCoverage < 0.30) {
    confidence = Math.min(confidence, 0.45);
  } else if (pivotCoverage < 0.50) {
    confidence = Math.min(confidence, 0.60);
  } else if (pivotCoverage < 0.70) {
    confidence = Math.min(confidence, 0.80);
  }

  if (intent === "broad" && pivotsIncluded < 3) {
    confidence = Math.min(confidence, 0.5);
  }

  if (relevantCoverage < 0.3) {
    confidence = Math.min(confidence, 0.5);
  }

  if (moduleCoverageStats && moduleCoverageStats.relevantClusters > 0) {
    const scatterRatio = moduleCoverageStats.packedClusters / moduleCoverageStats.relevantClusters;
    if (scatterRatio > 3) {
      confidence *= 0.85;
    }
  }

  if (intent !== "broad" && totalRelevantPivots > 0 && relevantPivotsIncluded < totalRelevantPivots * 0.5) {
    confidence = Math.min(confidence, 0.55);
  }

  const layerCount = params.layerCount ?? 0;
  if ((intent === "broad" || intent === "task") && layerCount > 0) {
    if (layerCount === 1) {
      confidence = Math.min(confidence, 0.40);
    } else if (layerCount === 2) {
      confidence = Math.min(confidence, 0.60);
    }
  }

  if (params.packedFilePaths && queryTerms && queryTerms.length === 1) {
    const dirs = new Set(
      params.packedFilePaths.map((p) => p.replace(/\\/g, "/").split("/").slice(0, 2).join("/"))
    );
    if (dirs.size >= 3) {
      confidence -= 0.2;
    }
  }

  if (packedSymbolNames && queryTerms && queryTerms.length > 0) {
    const packedTokenSet = new Set(
      packedSymbolNames.flatMap((n) => tokenizeForMatch(n))
    );
    const expandedQueryTokens = new Set(
      queryTerms.flatMap((t) => tokenizeForMatch(t))
    );
    const termHits = [...expandedQueryTokens].filter((t) => packedTokenSet.has(t)).length;
    const termCoverage = termHits / expandedQueryTokens.size;
    if (termCoverage < 0.3 && intent !== "broad") {
      confidence = Math.min(confidence, 0.50);
    }
  }

  const focusedExactLookup =
    intent !== "broad" &&
    (queryTerms?.length ?? 0) === 1 &&
    pivotCoverage >= 0.99 &&
    relevantCoverage >= 0.99 &&
    dependencyCoverage >= 0.99 &&
    noiseRatio <= 0.35 &&
    tokenUtilization >= 0.18 &&
    tokenUtilization < 0.30;
  if (focusedExactLookup) {
    confidence = Math.max(confidence, 0.18);
  }

  return clamp(confidence);
}

const UNCERTAINTY_LEVELS: CapsuleUncertainty[] = ["very_low", "low", "medium", "high", "critical"];

export function buildUncertainty(
  lowConfidence: boolean,
  reasonCount: number,
  coverageConfidence: number,
  tokenUtilization?: number
): CapsuleUncertainty {
  let level: CapsuleUncertainty;

  if (!lowConfidence && coverageConfidence >= 0.7) {
    level = "very_low";
  } else if (!lowConfidence) {
    level = "low";
  } else if (reasonCount >= 4 || coverageConfidence < 0.2) {
    level = "critical";
  } else if (reasonCount >= 3 || coverageConfidence < 0.35) {
    level = "high";
  } else if (reasonCount >= 2 && coverageConfidence < 0.45) {
    level = "high";
  } else {
    level = "medium";
  }

  if (tokenUtilization !== undefined && tokenUtilization >= 0.95) {
    const idx = UNCERTAINTY_LEVELS.indexOf(level);
    if (idx < UNCERTAINTY_LEVELS.length - 1) {
      level = UNCERTAINTY_LEVELS[idx + 1]!;
    }
  }

  return level;
}
