import type { CapsuleMode, ModeWeights } from "../core/types.js";

const MODE_WEIGHTS: Record<CapsuleMode, ModeWeights> = {
  debug: {
    distanceWeight: 1.0,
    centralityWeight: 0.3,
    recencyWeight: 1.5,
    memoryWeight: 1.2,
    exportBonus: 0.2,
  },
  refactor: {
    distanceWeight: 0.7,
    centralityWeight: 1.5,
    recencyWeight: 0.5,
    memoryWeight: 0.8,
    exportBonus: 1.0,
  },
  feature: {
    distanceWeight: 1.0,
    centralityWeight: 1.0,
    recencyWeight: 1.0,
    memoryWeight: 1.0,
    exportBonus: 0.5,
  },
  review: {
    distanceWeight: 0.5,
    centralityWeight: 1.2,
    recencyWeight: 0.8,
    memoryWeight: 1.0,
    exportBonus: 0.8,
  },
};

export function getModeWeights(mode: CapsuleMode): ModeWeights {
  return MODE_WEIGHTS[mode];
}
