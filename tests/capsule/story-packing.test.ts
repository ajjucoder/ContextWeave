import { describe, it, expect } from "vitest";
import type { FileRecord, ScoredNode, SymbolRecord } from "../../src/core/types.js";
import { packNodesStoryMode, enrichL2WithDeps } from "../../src/capsule/packer.js";
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

function makePaddedSource(name: string): string {
  return [
    `export function ${name}(input: string, options: Record<string, unknown> = {}): string {`,
    `  const normalized = input.trim().toLowerCase();`,
    `  if (!normalized || normalized.length === 0) {`,
    `    throw new Error("${name}: input must not be empty");`,
    `  }`,
    `  const config = { ...options, timestamp: Date.now() };`,
    `  const result = processInternal(normalized, config);`,
    `  if (result.errors && result.errors.length > 0) {`,
    `    console.warn("${name}: partial result with errors", result.errors);`,
    `  }`,
    `  return result.value;`,
    `}`,
  ].join("\n");
}

function makeSymbol(id: number, fileId: number, name: string): SymbolRecord {
  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 12,
    signature: `function ${name}(input: string, options?: Record<string, unknown>): string`,
    bodyHash: `b-${id}`,
    fullSource: makePaddedSource(name),
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
    rendered: symbol.fullSource,
    tokenCount: Math.ceil(symbol.fullSource.length / 4),
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
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeLessThanOrEqual(Math.floor(2000 * 0.85));
  });

  it("respects budget constraint with realistic token sizes", () => {
    const fileA = makeFile(10, "src/core/processor.ts");
    const fileB = makeFile(11, "src/core/validator.ts");

    const nodes: ScoredNode[] = [
      makeNode(1001, fileA, 9, 0),
      makeNode(1002, fileA, 8, 1),
      makeNode(1003, fileA, 7, 1),
      makeNode(1004, fileA, 6, 2),
      makeNode(1005, fileB, 8.5, 0),
      makeNode(1006, fileB, 7.5, 1),
      makeNode(1007, fileB, 6.5, 2),
    ];

    const tightBudget = 400;
    const result = packNodesStoryMode(nodes, tightBudget, 0.9);

    expect(result.packed.some((node) => node.compressionLevel !== 0)).toBe(true);
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeLessThanOrEqual(Math.floor(tightBudget * 0.9));
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
    expect(pivot?.tokenCount).toBeGreaterThan(0);
  });

  it("packs multiple pivots at L0 when budget allows", () => {
    const file = makeFile(40, "src/service/runtime.ts");
    const primary = makeNode(4001, file, 10, 0);
    primary.symbol.name = "pipelineOverview";
    primary.symbol.signature = "function pipelineOverview(): void";

    const secondary = makeNode(4002, file, 9.4, 0);
    secondary.symbol.name = "buildSchema";
    secondary.symbol.signature = "function buildSchema(): Schema";

    const tertiary = makeNode(4003, file, 9.1, 0);
    tertiary.symbol.name = "serializeSchema";
    tertiary.symbol.signature = "function serializeSchema(): string";

    const result = packNodesStoryMode([primary, secondary, tertiary], 1600, 0.9);
    const byId = new Map(result.packed.map((node) => [node.symbol.id, node]));

    expect(byId.get(4001)?.compressionLevel).toBe(0);
    expect(byId.get(4002)?.compressionLevel).toBeLessThanOrEqual(1);
    expect(byId.get(4003)?.compressionLevel).toBeLessThanOrEqual(1);
  });

  it("respects preassigned compression levels for broad-query UI entrypoints", () => {
    const file = makeFile(9, "app/sessions/[sessionId]/page.tsx");
    const node = makeNode(901, file, 9.5, 0);
    node.compressionLevel = 1;

    const result = packNodesStoryMode([node], 1200, 0.9);
    expect(result.packed[0]?.compressionLevel).toBe(1);
  });

  it("preserves bridge nodes before redundant helpers under a tight tail budget", () => {
    const controllerFile = makeFile(20, "src/runtime/controller.ts");
    const bridgeFile = makeFile(21, "src/runtime/service.ts");
    const helperFile = makeFile(22, "src/runtime/helpers.ts");
    const summaryFile = makeFile(23, "src/runtime/secondary.ts");

    const nodes: ScoredNode[] = [
      makeNode(2001, controllerFile, 10, 0),
      makeNode(2002, controllerFile, 7.2, 1),
      makeNode(2101, bridgeFile, 6.4, 1),
      makeNode(2201, helperFile, 6.9, 2),
      makeNode(2301, summaryFile, 4.2, 2),
      makeNode(2302, summaryFile, 4.1, 2),
      makeNode(2303, summaryFile, 4.0, 2),
    ];

    const result = packNodesStoryMode(nodes, 200, 0.9);
    const packedIds = new Set(result.packed.map((node) => node.symbol.id));

    expect(packedIds).toContain(2001);
    expect(packedIds).toContain(2101);
    expect(result.packed.length).toBeGreaterThanOrEqual(2);
  });
});

describe("enrichL2WithDeps", () => {
  it("adds deps to L2 nodes when budget allows", () => {
    const file = makeFile(5, "src/service/payment.ts");
    const symbol = makeSymbol(501, file.id, "processPayment");

    const renderedNoEdges = `[function] processPayment (${file.path}:1)\nsig: ${symbol.signature}`;
    const initialTokens = countTokens(renderedNoEdges);

    const node: ScoredNode = {
      symbol,
      file,
      score: 8,
      distance: 1,
      compressionLevel: 2,
      rendered: renderedNoEdges,
      tokenCount: initialTokens,
      outgoingEdges: [
        { targetName: "validateCard", kind: "call" },
        { targetName: "chargeGateway", kind: "call" },
      ],
    };

    const budget = initialTokens * 10;
    const result = enrichL2WithDeps([node], initialTokens, budget);

    expect(result.packed[0]?.rendered).toContain("deps: validateCard, chargeGateway");
    expect(result.tokensUsed).toBeGreaterThan(initialTokens);
  });

  it("leaves L2 nodes unchanged when no outgoing edges", () => {
    const file = makeFile(6, "src/service/order.ts");
    const symbol = makeSymbol(601, file.id, "getOrder");
    const rendered = `[function] getOrder (${file.path}:1)\nsig: ${symbol.signature}`;
    const initialTokens = countTokens(rendered);

    const node: ScoredNode = {
      symbol,
      file,
      score: 6,
      distance: 2,
      compressionLevel: 2,
      rendered,
      tokenCount: initialTokens,
    };

    const result = enrichL2WithDeps([node], initialTokens, initialTokens * 10);
    expect(result.packed[0]?.rendered).toBe(rendered);
    expect(result.tokensUsed).toBe(initialTokens);
  });

  it("skips enrichment when remaining budget is insufficient", () => {
    const file = makeFile(7, "src/service/auth.ts");
    const symbol = makeSymbol(701, file.id, "authenticate");
    const rendered = `[function] authenticate (${file.path}:1)\nsig: ${symbol.signature}`;
    const initialTokens = countTokens(rendered);

    const node: ScoredNode = {
      symbol,
      file,
      score: 7,
      distance: 1,
      compressionLevel: 2,
      rendered,
      tokenCount: initialTokens,
      outgoingEdges: [{ targetName: "verifyToken", kind: "call" }],
    };

    // Budget exactly equal to current tokens — no room for deps
    const result = enrichL2WithDeps([node], initialTokens, initialTokens);
    expect(result.packed[0]?.rendered).toBe(rendered);
    expect(result.tokensUsed).toBe(initialTokens);
  });

  it("does not touch L0 or L3 nodes", () => {
    const file = makeFile(8, "src/core/indexer.ts");
    const symbol = makeSymbol(801, file.id, "indexProject");
    const rendered = symbol.fullSource;
    const tokens = countTokens(rendered);

    const l0Node: ScoredNode = {
      symbol,
      file,
      score: 9,
      distance: 0,
      compressionLevel: 0,
      rendered,
      tokenCount: tokens,
      outgoingEdges: [{ targetName: "parseFile", kind: "call" }],
    };

    const result = enrichL2WithDeps([l0Node], tokens, tokens * 10);
    expect(result.packed[0]?.rendered).toBe(rendered);
    expect(result.tokensUsed).toBe(tokens);
  });
});
