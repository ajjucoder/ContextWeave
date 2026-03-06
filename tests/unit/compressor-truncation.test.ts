import { describe, it, expect } from "vitest";
import { renderSymbol, estimateTokens } from "../../src/capsule/compressor.js";
import type { SymbolRecord, FileRecord } from "../../src/core/types.js";

function makeSymbol(lines: number): SymbolRecord {
  const body = Array.from({ length: lines }, (_, i) => `  const line${i} = ${i};`);
  const fullSource = `function bigFunc() {\n${body.join("\n")}\n  return true;\n}`;
  return {
    id: 1,
    fileId: 1,
    name: "bigFunc",
    kind: "function",
    startLine: 1,
    endLine: lines + 2,
    signature: "function bigFunc()",
    fullSource,
    isExported: true,
    bodyHash: "hash",
    docComment: null,
    centrality: 0.5,
    lastSeen: Date.now(),
  };
}

const file: FileRecord = {
  id: 1,
  path: "src/test.ts",
  hash: "h",
  lastIndexed: Date.now(),
  mtime: Date.now(),
  language: "typescript",
  symbolCount: 1,
  error: null,
};

describe("L0 size guard", () => {
  it("renders small functions fully", () => {
    const sym = makeSymbol(5);
    const result = renderSymbol(sym, file, 0, [], 300);
    expect(result).toContain("function bigFunc()");
    expect(result).not.toContain("truncated");
  });

  it("truncates large functions with head + tail", () => {
    const sym = makeSymbol(200);
    const result = renderSymbol(sym, file, 0, [], 300);
    expect(result).toContain("function bigFunc()");
    expect(result).toContain("more lines");
    expect(result).toContain('cw_read(symbol: "bigFunc")');
    expect(result).toContain("return true;");
  });

  it("estimateTokens caps at maxL0Tokens", () => {
    const sym = makeSymbol(200);
    const estimate = estimateTokens(sym, 0, 300);
    expect(estimate).toBeLessThanOrEqual(300);
  });

  it("estimateTokens returns full count when under cap", () => {
    const sym = makeSymbol(5);
    const full = estimateTokens(sym, 0, 5000);
    const capped = estimateTokens(sym, 0, 300);
    expect(full).toBe(capped);
  });

  it("L1/L2/L3 rendering is unchanged", () => {
    const sym = makeSymbol(10);
    const l1 = renderSymbol(sym, file, 1);
    expect(l1).toContain("[function]");
    const l3 = renderSymbol(sym, file, 3);
    expect(l3).toContain("@ src/test.ts:1");
  });
});
