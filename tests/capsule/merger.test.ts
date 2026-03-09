import { describe, it, expect } from "vitest";
import type { FileRecord, ScoredNode, SymbolRecord } from "../../src/core/types.js";
import { mergeSubCapsules, type SubCapsuleResult } from "../../src/capsule/merger.js";

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

function makeNode(id: number, file: FileRecord, score: number, level: 0 | 1 | 2 | 3): ScoredNode {
  const symbol = makeSymbol(id, file.id, `fn${id}`);
  return {
    symbol,
    file,
    score,
    distance: level === 0 ? 0 : 1,
    compressionLevel: level,
    rendered: `rendered-${id}-${level}`,
    tokenCount: 25,
  };
}

describe("mergeSubCapsules", () => {
  it("deduplicates symbols and keeps richer compression level", () => {
    const fileA = makeFile(1, "src/capsule/generator.ts");
    const fileB = makeFile(2, "src/capsule/packer.ts");

    const results: SubCapsuleResult[] = [
      {
        packed: [makeNode(1001, fileA, 9, 1), makeNode(1002, fileA, 8.5, 2)],
        fileSummaries: ["[file] src/capsule/generator.ts: 4 symbols"],
        pivotSymbolIds: new Set([1001]),
        clusterIds: new Set([11]),
      },
      {
        packed: [makeNode(1001, fileA, 9.5, 3), makeNode(2001, fileB, 8.7, 1)],
        fileSummaries: ["[file] src/capsule/packer.ts: 5 symbols"],
        pivotSymbolIds: new Set([2001]),
        clusterIds: new Set([12]),
      },
    ];

    const merged = mergeSubCapsules(results, 1800, 0.85);
    const ids = merged.packed.map((n) => n.symbol.id);

    expect(ids.filter((id) => id === 1001)).toHaveLength(1);

    const deduped1001 = merged.packed.find((n) => n.symbol.id === 1001);
    expect(deduped1001).toBeDefined();
    expect(deduped1001!.compressionLevel).toBeLessThanOrEqual(1);

    expect(merged.packed.length).toBeGreaterThanOrEqual(2);
    expect(merged.tokensUsed).toBeLessThanOrEqual(Math.floor(1800 * 0.85));
  });

  it("returns stable empty result for no sub-capsules", () => {
    const merged = mergeSubCapsules([], 1000, 0.8);
    expect(merged.packed).toEqual([]);
    expect(merged.fileSummaries).toEqual([]);
    expect(merged.observationBudget).toBe(200);
    expect(merged.tokensUsed).toBe(0);
  });
});
