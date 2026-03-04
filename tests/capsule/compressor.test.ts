import { describe, expect, it } from "vitest";
import type { FileRecord, SymbolRecord } from "../../src/core/types.js";
import { estimateTokens, renderSymbol } from "../../src/capsule/compressor.js";
import { countTokens } from "../../src/utils/tokens.js";

const sampleSymbol: SymbolRecord = {
  id: 1,
  fileId: 1,
  name: "renderTypedWidget",
  kind: "function",
  startLine: 1,
  endLine: 8,
  signature: "export function renderTypedWidget<T extends { id: string }>(input: T): JSX.Element",
  bodyHash: "hash",
  fullSource: `
export function renderTypedWidget<T extends { id: string }>(input: T): JSX.Element {
  return <Widget data-id={input.id} />
}
`.trim(),
  isExported: true,
  docComment: "Render a widget with strict generic typing.",
  centrality: 0,
  lastSeen: Date.now(),
};

const sampleFile: FileRecord = {
  id: 1,
  path: "src/widgets/render.ts",
  hash: "abc",
  lastIndexed: Date.now(),
  mtime: Date.now(),
  language: "typescript",
  symbolCount: 1,
  error: null,
};

describe("estimateTokens", () => {
  it("uses tokenizer counts for level 0 source payloads", () => {
    expect(estimateTokens(sampleSymbol, 0)).toBe(countTokens(sampleSymbol.fullSource));
  });
});

describe("renderSymbol L2 with outgoing edges", () => {
  it("includes deps line when edges are provided", () => {
    const edges = [
      { targetName: "processInput", kind: "call" },
      { targetName: "validateSchema", kind: "call" },
    ];
    const rendered = renderSymbol(sampleSymbol, sampleFile, 2, edges);
    expect(rendered).toContain("deps: processInput, validateSchema");
  });

  it("omits deps line when no edges provided", () => {
    const rendered = renderSymbol(sampleSymbol, sampleFile, 2);
    expect(rendered).not.toContain("deps:");
  });

  it("caps deps at 5 and appends overflow count", () => {
    const edges = Array.from({ length: 8 }, (_, i) => ({ targetName: `dep${i}`, kind: "call" }));
    const rendered = renderSymbol(sampleSymbol, sampleFile, 2, edges);
    expect(rendered).toContain("+3 more");
    const depsLine = rendered.split("\n").find((l) => l.startsWith("deps:")) ?? "";
    const listedNames = depsLine.replace("deps: ", "").split(", +")[0]?.split(", ") ?? [];
    expect(listedNames).toHaveLength(5);
  });
});
