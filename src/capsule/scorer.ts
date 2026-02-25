import type { CompressionLevel, CapsuleMode, ModeWeights } from "../core/types.js";
import { getModeWeights } from "./modes.js";

interface ScoreParams {
  distance: number;
  centrality: number;
  lastSeen: number;
  observationCount: number;
  isExported: boolean;
  mode: CapsuleMode;
}

export function scoreNode(params: ScoreParams): number {
  const weights: ModeWeights = getModeWeights(params.mode);
  const ageInDays = (Date.now() - params.lastSeen) / 86400000;
  const recencyFactor = weights.recencyWeight * Math.max(0.1, 1 - ageInDays / 30);
  const memoryFactor = 1 + (weights.memoryWeight * Math.min(params.observationCount, 5)) / 5;
  const exportMultiplier = 1 + (params.isExported ? 1 : 0) * weights.exportBonus;

  return (
    (1 / (params.distance + 1)) *
    (params.centrality * weights.centralityWeight) *
    recencyFactor *
    memoryFactor *
    exportMultiplier
  );
}

export function assignCompressionLevel(score: number, distance: number, maxScore: number): CompressionLevel {
  if (distance === 0) return 0;
  const normalizedScore = maxScore > 0 ? score / maxScore : 0;
  if (normalizedScore >= 0.6) return 1;
  if (normalizedScore >= 0.3) return 2;
  return 3;
}
