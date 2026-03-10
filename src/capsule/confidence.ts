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
}

export type ConfidenceLabel = "LOW" | "MEDIUM" | "HIGH";

export function confidenceToLabel(confidence: number): ConfidenceLabel {
  return confidence < 0.45 ? "LOW" : confidence < 0.75 ? "MEDIUM" : "HIGH";
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
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
  const structurallyGrounded =
    retrievalSurfaceScore >= 0.75 &&
    relevantCoverage >= 0.6 &&
    dependencyCoverage >= 0.7 &&
    noiseRatio <= 0.2;

  let confidence = clamp(
    relevantCoverage * 0.5 +
      dependencyCoverage * 0.2 +
      (1 - noiseRatio) * 0.15 +
      summaryBoost +
      0.182
  );
  if (intent === "broad") {
    confidence = clamp(
      moduleCoverage * 0.35 +
        relevantCoverage * 0.25 +
        (1 - noiseRatio) * 0.15 +
        summaryBoost +
        0.282
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
    if (structurallyGrounded && moduleCoverage >= 0.75) {
      confidence = Math.max(confidence, 0.72);
    }
  } else if (intent === "task") {
    confidence = clamp(
      storyCompleteness * 0.3 +
        moduleCoverage * 0.25 +
        relevantCoverage * 0.2 +
        (1 - noiseRatio) * 0.1 +
        0.362
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
    if (structurallyGrounded && storyCompleteness >= 0.25) {
      confidence = Math.max(confidence, 0.78);
    }
  }

  if (tokenUtilization < 0.30) {
    confidence = Math.min(confidence, 0.40);
  } else if (tokenUtilization < 0.50) {
    confidence = Math.min(confidence, 0.60);
  }
  if (tokenUtilization <= 0.60 || pivotCoverage <= 0.60) {
    confidence = Math.min(confidence, 0.89);
  }

  if (intent === "broad" && pivotsIncluded < 3) {
    confidence = Math.min(confidence, 0.5);
  }

  if (intent !== "narrow" && relevantCoverage < 0.3) {
    confidence = Math.min(confidence, 0.5);
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
