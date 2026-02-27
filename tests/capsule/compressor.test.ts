import { describe, expect, it } from "vitest";
import type { SymbolRecord } from "../../src/core/types.js";
import { estimateTokens } from "../../src/capsule/compressor.js";
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

describe("estimateTokens", () => {
  it("uses tokenizer counts for level 0 source payloads", () => {
    expect(estimateTokens(sampleSymbol, 0)).toBe(countTokens(sampleSymbol.fullSource));
  });
});
