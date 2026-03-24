import { describe, expect, it } from "vitest";
import type { FileRecord, ScoredNode, SymbolRecord } from "../../src/core/types.js";
import { renderSymbol } from "../../src/capsule/compressor.js";
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

function makeSymbol(id: number, fileId: number, name: string, lines = 18): SymbolRecord {
  const body = Array.from({ length: lines }, (_, i) => {
    if (i === 0) return `export function ${name}(input: string, extra = "value"): string {`;
    if (i === lines - 1) return "}";
    return `  const step${i} = "${name}-${i}".repeat(${(i % 3) + 1}) + input + extra;`;
  }).join("\n");

  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: lines,
    signature: `function ${name}(input: string, extra?: string): string`,
    bodyHash: `b-${id}`,
    fullSource: body,
    isExported: true,
    docComment: null,
    centrality: 0.05,
    lastSeen: Date.now(),
  };
}

function makeNode(
  symbol: SymbolRecord,
  file: FileRecord,
  score: number,
  distance: number,
  compressionLevel: 0 | 1 | 2 | 3 = 0
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

describe("packNodes", () => {
  it("fills the budget exactly when a candidate consumes the full code budget", () => {
    const file = makeFile(1, "src/capsule/exact-fit.ts");
    const symbol = makeSymbol(11, file.id, "exactFit", 14);
    const node = makeNode(symbol, file, 9.5, 1, 0);
    const exactTokens = countTokens(renderSymbol(symbol, file, 0));

    const result = packNodes([node], exactTokens, 1);

    expect(result.packed).toHaveLength(1);
    expect(result.packed[0]?.compressionLevel).toBe(0);
    expect(result.tokensUsed).toBe(exactTokens);
    expect(result.observationBudget).toBe(0);
  });

  it("skips a single oversized symbol when even L3 cannot fit", () => {
    const file = makeFile(2, "src/capsule/oversized.ts");
    const symbol = makeSymbol(21, file.id, "oversizedCandidate", 22);
    const node = makeNode(symbol, file, 7.2, 1, 0);
    const l3Tokens = countTokens(renderSymbol(symbol, file, 3));

    const result = packNodes([node], l3Tokens - 1, 1);

    expect(result.packed).toHaveLength(0);
    expect(result.tokensUsed).toBe(0);
    expect(result.fileSummaries).toHaveLength(0);
  });

  it("handles an empty candidate list", () => {
    const result = packNodes([], 400, 1);

    expect(result.packed).toHaveLength(0);
    expect(result.tokensUsed).toBe(0);
    expect(result.fileSummaries).toHaveLength(0);
    expect(result.observationBudget).toBe(0);
  });

  it("keeps every candidate at L0 when they all fit", () => {
    const file = makeFile(3, "src/capsule/all-l0.ts");
    const nodes = [
      makeNode(makeSymbol(31, file.id, "firstFit", 8), file, 9.8, 0, 0),
      makeNode(makeSymbol(32, file.id, "secondFit", 7), file, 8.9, 1, 0),
      makeNode(makeSymbol(33, file.id, "thirdFit", 6), file, 8.1, 1, 0),
    ];
    const totalTokens = nodes.reduce((sum, node) => sum + countTokens(renderSymbol(node.symbol, node.file, 0)), 0);

    const result = packNodes(nodes, totalTokens + 20, 1);

    expect(result.packed).toHaveLength(3);
    expect(result.packed.every((node) => node.compressionLevel === 0)).toBe(true);
  });

  it("degrades to L3 when tighter budgets reject higher detail levels", () => {
    const file = makeFile(4, "src/capsule/l3-only.ts");
    const symbol = makeSymbol(41, file.id, "degradeMe", 24);
    const node = makeNode(symbol, file, 8.4, 1, 0);
    const l1Tokens = countTokens(renderSymbol(symbol, file, 1));
    const l2Tokens = countTokens(renderSymbol(symbol, file, 2));
    const l3Tokens = countTokens(renderSymbol(symbol, file, 3));
    const budget = Math.max(l3Tokens, Math.min(l1Tokens, l2Tokens) - 1);

    const result = packNodes([node], budget, 1);

    expect(result.packed).toHaveLength(1);
    expect(result.packed[0]?.compressionLevel).toBe(3);
  });

  it("runs the promotion pass when leftover budget can improve an L3 node", () => {
    const file = makeFile(5, "src/capsule/promote.ts");
    const symbol = makeSymbol(51, file.id, "promoteMe", 60);
    const node = makeNode(symbol, file, 9.1, 1, 3);
    const l0Tokens = countTokens(renderSymbol(symbol, file, 0));
    const l2Tokens = countTokens(renderSymbol(symbol, file, 2));
    const l3Tokens = countTokens(renderSymbol(symbol, file, 3));
    const budget = Math.max(l2Tokens, l3Tokens + 55);

    expect(budget).toBeLessThan(l0Tokens);

    const result = packNodes([node], budget, 1);

    expect(result.packed).toHaveLength(1);
    expect(result.packed[0]?.compressionLevel).toBe(2);
    expect(result.packed[0]?.tokenCount).toBe(l2Tokens);
  });
});
