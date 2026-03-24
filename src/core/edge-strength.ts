/**
 * Canonical edge-strength weights used for persistence and traversal.
 */
import type { EdgeKind } from "./types.js";

const EDGE_STRENGTHS: Partial<Record<EdgeKind, number>> = {
  call: 1.0,
  import: 0.8,
  reference: 0.6,
  type_usage: 0.4,
};

export function getEdgeStrength(kind: EdgeKind): number {
  return EDGE_STRENGTHS[kind] ?? 1.0;
}
