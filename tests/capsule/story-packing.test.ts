import { describe, it, expect } from "vitest";
import type { FileRecord, ScoredNode, SymbolRecord } from "../../src/core/types.js";
import { packNodesStoryMode } from "../../src/capsule/packer.js";

function makeFile(id: number, path: string): FileRecord {
  return {
    id,
    path,
    hash: `h-${id}`,
    lastIndexed: Date.now(),
    mtime: Date.now(),
    language: "typescript",
    symbolCount: 0,
    error: null,
  };
}

function makeSymbol(id: number, fileId: number, name: string): SymbolRecord {
  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 8,
    signature: `function ${name}()` ,
    bodyHash: `b-${id}`,
    fullSource: `export function ${name}() {\n  return \"${name}\";\n}`,
    isExported: true,
    docComment: null,
    centrality: 0.02,
    lastSeen: Date.now(),
  };
}

function makeNode(id: number, file: FileRecord, score: number, distance: number): ScoredNode {
  const symbol = makeSymbol(id, file.id, `fn${id}`);
  return {
    symbol,
    file,
    score,
    distance,
    compressionLevel: 2,
    rendered: "",
    tokenCount: 0,
  };
}

describe("packNodesStoryMode", () => {
  it("packs coherent groups before tail references", () => {
    const fileA = makeFile(1, "src/capsule/generator.ts");
    const fileB = makeFile(2, "src/capsule/packer.ts");
    const fileC = makeFile(3, "src/capsule/formatter.ts");

    const nodes: ScoredNode[] = [
      makeNode(101, fileA, 9.2, 0),
      makeNode(102, fileA, 7.8, 1),
      makeNode(103, fileA, 6.9, 1),
      makeNode(201, fileB, 8.7, 0),
      makeNode(202, fileB, 7.1, 1),
      makeNode(203, fileB, 6.8, 2),
      makeNode(301, fileC, 4.5, 1),
    ];

    const clusterMap = new Map<number, number>([
      [101, 11], [102, 11], [103, 11],
      [201, 12], [202, 12], [203, 12],
      [301, 13],
    ]);

    const result = packNodesStoryMode(nodes, 2000, 0.85, clusterMap);

    const byFile = new Map<string, number>();
    for (const node of result.packed) {
      byFile.set(node.file.path, (byFile.get(node.file.path) ?? 0) + 1);
    }

    expect(byFile.get("src/capsule/generator.ts") ?? 0).toBeGreaterThanOrEqual(2);
    expect(byFile.get("src/capsule/packer.ts") ?? 0).toBeGreaterThanOrEqual(2);
    expect(result.tokensUsed).toBeLessThanOrEqual(Math.floor(2000 * 0.85));
  });

  it("includes L0 detail for pivots when budget allows", () => {
    const file = makeFile(4, "src/service/auth.ts");
    const nodes: ScoredNode[] = [
      makeNode(401, file, 10, 0),
      makeNode(402, file, 7, 1),
      makeNode(403, file, 6, 2),
    ];

    const result = packNodesStoryMode(nodes, 1500, 0.9);
    const pivot = result.packed.find((n) => n.symbol.id === 401);

    expect(pivot).toBeDefined();
    expect(pivot?.compressionLevel).toBe(0);
  });
});
