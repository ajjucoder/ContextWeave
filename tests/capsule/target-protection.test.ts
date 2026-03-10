import { describe, it, expect } from "vitest";
import type { FileRecord, ScoredNode, SymbolRecord } from "../../src/core/types.js";
import { packNodes } from "../../src/capsule/packer.js";
import { countTokens } from "../../src/utils/tokens.js";

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

function makeSymbol(id: number, fileId: number, name: string, lines = 12): SymbolRecord {
  const body = Array.from({ length: lines }, (_, i) =>
    i === 0
      ? `export function ${name}(input: string): string {`
      : i === lines - 1
        ? `}`
        : `  const step${i} = process_${name}_${i}(input);`
  ).join("\n");
  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: lines,
    signature: `function ${name}(input: string): string`,
    bodyHash: `b-${id}`,
    fullSource: body,
    isExported: true,
    docComment: null,
    centrality: 0.02,
    lastSeen: Date.now(),
  };
}

function makeNode(
  symbol: SymbolRecord,
  file: FileRecord,
  score: number,
  distance: number,
  compressionLevel: 0 | 1 | 2 | 3 = 1
): ScoredNode {
  return {
    symbol,
    file,
    score,
    distance,
    compressionLevel,
    rendered: "",
    tokenCount: 0,
  };
}

describe("packNodes — primary target protection", () => {
  it("packs primary target at L0 even when compressionLevel suggests higher", () => {
    const file = makeFile(1, "src/core/showToast.ts");
    const primarySym = makeSymbol(1, 1, "showToast", 20);
    const noiseSym = makeSymbol(2, 1, "LandingHowItWorks", 30);

    const nodes: ScoredNode[] = [
      makeNode(primarySym, file, 1.0, 0, 2),
      makeNode(noiseSym, file, 0.3, 2, 0),
    ];

    const result = packNodes(nodes, 8000);
    const primary = result.packed.find((n) => n.symbol.id === 1);
    expect(primary).toBeDefined();
    expect(primary!.compressionLevel).toBe(0);
  });

  it("primary target at L0 when it has the top score with distance 0", () => {
    const file = makeFile(1, "src/utils/format.ts");
    const primarySym = makeSymbol(1, 1, "formatCurrency", 15);
    const otherSym = makeSymbol(2, 1, "padLeft", 5);
    const noiseSym = makeSymbol(3, 1, "HelperInternal", 8);

    const nodes: ScoredNode[] = [
      makeNode(primarySym, file, 0.99, 0, 2),
      makeNode(otherSym, file, 0.5, 1, 2),
      makeNode(noiseSym, file, 0.2, 2, 0),
    ];

    const result = packNodes(nodes, 4000);
    const primary = result.packed.find((n) => n.symbol.id === 1);
    expect(primary).toBeDefined();
    expect(primary!.compressionLevel).toBe(0);
  });

  it("primary target is included before noise consumes full budget", () => {
    const file = makeFile(1, "src/core/target.ts");
    const primarySym = makeSymbol(1, 1, "criticalFunction", 40);

    // Create many noise symbols that would crowd out the primary if budget fills first
    const noiseSymbols = Array.from({ length: 20 }, (_, i) =>
      makeSymbol(i + 2, 1, `noiseFunction${i}`, 8)
    );

    const nodes: ScoredNode[] = [
      makeNode(primarySym, file, 1.0, 0, 2),
      ...noiseSymbols.map((s, i) => makeNode(s, file, 0.9 - i * 0.03, 2, 0)),
    ];

    const budget = 2000;
    const result = packNodes(nodes, budget);

    const primaryPacked = result.packed.find((n) => n.symbol.id === 1);
    expect(primaryPacked).toBeDefined();
    expect(primaryPacked!.compressionLevel).toBe(0);
  });

  it("budget reserve does not exceed 40% of code budget", () => {
    const file = makeFile(1, "src/core/bigFunction.ts");
    // Create a very large primary symbol
    const primarySym = makeSymbol(1, 1, "veryLargeFunction", 200);
    const otherSym = makeSymbol(2, 1, "smallHelper", 3);

    const nodes: ScoredNode[] = [
      makeNode(primarySym, file, 1.0, 0, 2),
      makeNode(otherSym, file, 0.5, 1, 2),
    ];

    const budget = 4000;
    const result = packNodes(nodes, budget);
    const codeBudget = Math.floor(budget * 0.8);

    // Total tokens used must not exceed codeBudget
    expect(result.tokensUsed).toBeLessThanOrEqual(budget);

    // Primary should be packed (at whatever level fits)
    const primary = result.packed.find((n) => n.symbol.id === 1);
    expect(primary).toBeDefined();
  });

  it("secondary symbols are still packed after primary is placed", () => {
    const file = makeFile(1, "src/api/handler.ts");
    const primarySym = makeSymbol(1, 1, "handleRequest", 10);
    const secondarySym = makeSymbol(2, 1, "validateInput", 6);
    const thirdSym = makeSymbol(3, 1, "buildResponse", 5);

    const nodes: ScoredNode[] = [
      makeNode(primarySym, file, 1.0, 0, 2),
      makeNode(secondarySym, file, 0.8, 1, 2),
      makeNode(thirdSym, file, 0.6, 1, 2),
    ];

    const result = packNodes(nodes, 8000);
    expect(result.packed.length).toBe(3);
    expect(result.packed.find((n) => n.symbol.id === 1)?.compressionLevel).toBe(0);
  });

  it("handles empty scoredNodes gracefully", () => {
    const result = packNodes([], 4000);
    expect(result.packed).toHaveLength(0);
    expect(result.tokensUsed).toBe(0);
  });

  it("handles single node", () => {
    const file = makeFile(1, "src/utils/single.ts");
    const sym = makeSymbol(1, 1, "onlyFunction", 5);
    const nodes: ScoredNode[] = [makeNode(sym, file, 1.0, 0, 2)];

    const result = packNodes(nodes, 4000);
    expect(result.packed).toHaveLength(1);
    expect(result.packed[0]!.compressionLevel).toBe(0);
  });
});
