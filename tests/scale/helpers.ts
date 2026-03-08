import { edgeQueries } from "../../src/db/queries/edges.js";

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function insertDeterministicCallEdges(
  db: Parameters<typeof edgeQueries>[0],
  symbolIds: number[],
  edgeCount: number,
  createdAt: number,
  seed: number
): void {
  const edges = edgeQueries(db);
  const random = createSeededRandom(seed);
  for (let index = 0; index < edgeCount; index++) {
    const sourceIdx = Math.floor(random() * symbolIds.length);
    const targetIdx = Math.floor(random() * symbolIds.length);
    if (sourceIdx === targetIdx) continue;
    edges.insert({
      sourceSymbolId: symbolIds[sourceIdx]!,
      targetSymbolId: symbolIds[targetIdx]!,
      kind: "call",
      createdAt,
    });
  }
}
