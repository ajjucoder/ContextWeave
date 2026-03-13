import { describe, expect, it } from "vitest";
import type {
  CapsuleMetadata,
  FileRecord,
  ObservationRecord,
  ScoredNode,
  SymbolRecord,
} from "../../src/core/types.js";
import { formatCapsule } from "../../src/capsule/formatter.js";

function createFile(id: number, path: string): FileRecord {
  return {
    id,
    path,
    hash: `h-${id}`,
    lastIndexed: Date.now(),
    mtime: Date.now(),
    language: "typescript",
    symbolCount: 1,
    error: null,
  };
}

function createSymbol(id: number, fileId: number, name: string): SymbolRecord {
  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 2,
    signature: `function ${name}()`,
    bodyHash: `b-${id}`,
    fullSource: `export function ${name}() { return ${id}; }`,
    isExported: true,
    docComment: null,
    centrality: 0.1,
    lastSeen: Date.now(),
  };
}

function createMetadata(): CapsuleMetadata {
  return {
    query: "find bugs in the capsule pipeline",
    mode: "review",
    tokenBudget: 3000,
    tokensUsed: 1200,
    symbolCount: 2,
    fileCount: 2,
    compressionBreakdown: { 0: 1, 1: 1, 2: 0, 3: 0 },
    observationCount: 0,
    quality: {
      pivotCount: 3,
      pivotsIncluded: 2,
      pivotCoverage: 0.66,
      dependencyCoverage: 0.5,
      coverageConfidence: 0.71,
      noiseRatio: 0.1,
      uncertaintyFlag: false,
      lowConfidence: false,
      uncertainty: "low",
      reasons: [],
      retrieval: {
        stageACandidateCount: 8,
        stageBSelectedCount: 5,
      },
    },
    strategy: {
      intent: "task",
      mode: "multi-pass",
      subQueryCount: 3,
    },
    generatedAt: Date.now(),
  };
}

describe("formatCapsule multi-pass rendering", () => {
  it("renders cluster headers when strategy is multi-pass", () => {
    const fileA = createFile(1, "src/capsule/generator.ts");
    const fileB = createFile(2, "src/capsule/packer.ts");
    const nodes: ScoredNode[] = [
      {
        symbol: createSymbol(11, fileA.id, "generateCapsule"),
        file: fileA,
        score: 1.2,
        distance: 0,
        compressionLevel: 0,
        rendered: "code-a",
        tokenCount: 100,
      },
      {
        symbol: createSymbol(22, fileB.id, "packNodesStoryMode"),
        file: fileB,
        score: 1.1,
        distance: 1,
        compressionLevel: 1,
        rendered: "code-b",
        tokenCount: 100,
      },
    ];
    const metadata = createMetadata();
    const observations: ObservationRecord[] = [];

    const output = formatCapsule(nodes, observations, metadata, []);
    expect(output).toContain("Strategy: multi-pass (3 sub-queries)");
    expect(output).toContain("[Cluster:");
    expect(output).toContain("Confidence:");
    expect(output).toContain("Uncertainty:");
  });
});

describe("formatCapsule confidence tier labels", () => {
  function makeMetadataWithConfidence(coverageConfidence: number): CapsuleMetadata {
    return {
      ...createMetadata(),
      quality: {
        ...createMetadata().quality,
        coverageConfidence,
      },
    };
  }

  it("shows LOW for coverage confidence below 0.45", () => {
    const file = createFile(1, "src/a.ts");
    const nodes: ScoredNode[] = [
      { symbol: createSymbol(1, 1, "fn"), file, score: 0.5, distance: 0, compressionLevel: 0, rendered: "fn", tokenCount: 10 },
    ];
    const output = formatCapsule(nodes, [], makeMetadataWithConfidence(0.3), []);
    expect(output).toContain("Confidence: LOW");
  });

  it("shows MEDIUM for coverage confidence in [0.45, 0.75)", () => {
    const file = createFile(1, "src/a.ts");
    const nodes: ScoredNode[] = [
      { symbol: createSymbol(1, 1, "fn"), file, score: 0.5, distance: 0, compressionLevel: 0, rendered: "fn", tokenCount: 10 },
    ];
    const output = formatCapsule(nodes, [], makeMetadataWithConfidence(0.6), []);
    expect(output).toContain("Confidence: MEDIUM");
  });

  it("shows HIGH for coverage confidence >= 0.75", () => {
    const file = createFile(1, "src/a.ts");
    const nodes: ScoredNode[] = [
      { symbol: createSymbol(1, 1, "fn"), file, score: 0.5, distance: 0, compressionLevel: 0, rendered: "fn", tokenCount: 10 },
    ];
    const output = formatCapsule(nodes, [], makeMetadataWithConfidence(0.8), []);
    expect(output).toContain("Confidence: HIGH");
  });
});

describe("formatCapsule previously-covered footer", () => {
  it("renders a single footer line for omitted symbols instead of inline markers", () => {
    const file = createFile(1, "src/a.ts");
    const nodes: ScoredNode[] = [
      { symbol: createSymbol(1, 1, "fn"), file, score: 0.5, distance: 0, compressionLevel: 0, rendered: "fn", tokenCount: 10 },
    ];
    const metadata: CapsuleMetadata = {
      ...createMetadata(),
      previouslyCovered: ["oldFn", "anotherFn"],
    };
    const output = formatCapsule(nodes, [], metadata, []);
    expect(output).toContain("2 symbols from prior capsules omitted");
    expect(output).not.toContain("[previously shown]");
  });

  it("omits the footer line when previouslyCovered is empty", () => {
    const file = createFile(1, "src/a.ts");
    const nodes: ScoredNode[] = [
      { symbol: createSymbol(1, 1, "fn"), file, score: 0.5, distance: 0, compressionLevel: 0, rendered: "fn", tokenCount: 10 },
    ];
    const metadata: CapsuleMetadata = {
      ...createMetadata(),
      previouslyCovered: [],
    };
    const output = formatCapsule(nodes, [], metadata, []);
    expect(output).not.toContain("symbols from prior capsules omitted");
  });
});
