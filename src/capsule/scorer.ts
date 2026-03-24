import type { CompressionLevel, CapsuleMode, ModeWeights } from "../core/types.js";
import { getScoringModeWeights } from "./modes.js";

interface ScoreParams {
  distance: number;
  centrality: number;
  lastSeen: number;
  observationCount: number;
  isExported: boolean;
  isPivot?: boolean;
  lexicalBoost?: number;
  localityBoost?: number;
  hubPenalty?: number;
  visibilityMultiplier?: number;
  mode: CapsuleMode;
}

function computeHubPenalty(centrality: number, isPivot: boolean): number {
  const hubThreshold = 0.08;
  const hubRange = 0.22;
  const hubIntensity = Math.max(0, Math.min(1, (centrality - hubThreshold) / hubRange));
  const minPenalty = isPivot ? 0.7 : 0.4;
  return 1 - hubIntensity * (1 - minPenalty);
}

export function scoreNode(params: ScoreParams): number {
  const weights: ModeWeights = getScoringModeWeights(params.mode);
  const distanceFactor = Math.pow(1 / (params.distance + 1), weights.distanceWeight);
  const centralitySignal =
    1 + Math.log1p(Math.max(0, params.centrality) * 100000) * weights.centralityWeight;
  const ageInDays = (Date.now() - params.lastSeen) / 86400000;
  const recencySignal = Math.max(0.1, 1 - ageInDays / 30);
  const recencyFactor = 1 + weights.recencyWeight * recencySignal;
  const memoryFactor = 1 + (weights.memoryWeight * Math.min(params.observationCount, 5)) / 5;
  const exportMultiplier = 1 + (params.isExported ? 1 : 0) * weights.exportBonus;
  const lexicalBoost = params.lexicalBoost ?? 1;
  const localityBoost = params.localityBoost ?? 1;
  const hubPenalty = params.hubPenalty ?? computeHubPenalty(params.centrality, params.isPivot ?? false);
  const visibilityMultiplier = params.visibilityMultiplier ?? 1;

  return (
    distanceFactor *
    centralitySignal *
    recencyFactor *
    memoryFactor *
    exportMultiplier *
    lexicalBoost *
    localityBoost *
    hubPenalty *
    visibilityMultiplier
  );
}

export function assignCompressionLevel(score: number, distance: number, maxScore: number): CompressionLevel {
  if (distance === 0) return 0;
  const normalizedScore = maxScore > 0 ? score / maxScore : 0;
  if (normalizedScore >= 0.6) return 1;
  if (normalizedScore >= 0.3) return 2;
  return 3;
}
