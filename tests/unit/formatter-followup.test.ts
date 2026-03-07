import { describe, it, expect } from "vitest";
import { formatCapsule } from "../../src/capsule/formatter.js";
import type { ScoredNode, ObservationRecord, CapsuleMetadata } from "../../src/core/types.js";

function makeNode(overrides: Partial<ScoredNode> & { compressionLevel: 0 | 1 | 2 | 3 }): ScoredNode {
  return {
    symbol: {
      id: 1,
      fileId: 1,
      name: "mySymbol",
      kind: "function",
      startLine: 1,
      endLine: 10,
      signature: "function mySymbol()",
      bodyHash: "abc",
      fullSource: "function mySymbol() {}",
      isExported: true,
      docComment: null,
      centrality: 0.5,
      lastSeen: 0,
    },
    file: {
      id: 1,
      path: "src/core/myFile.ts",
      hash: "abc",
      lastIndexed: 0,
      mtime: 0,
      language: "typescript",
      symbolCount: 5,
      error: null,
    },
    score: 1.0,
    distance: 0,
    compressionLevel: overrides.compressionLevel,
    rendered: `// rendered for ${overrides.symbol?.name ?? "mySymbol"}`,
    tokenCount: 50,
    ...overrides,
  };
}

function makeObs(overrides: Partial<ObservationRecord>): ObservationRecord {
  return {
    id: 1,
    sessionId: "sess-1",
    agentId: "agent-1",
    symbolId: null,
    fileId: null,
    scope: "architecture",
    note: "Test observation",
    confidence: 0.7,
    createdAt: 0,
    updatedAt: 0,
    stale: false,
    staleReason: null,
    archived: false,
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<CapsuleMetadata> = {}): CapsuleMetadata {
  return {
    query: "test query",
    mode: "feature",
    tokenBudget: 4000,
    tokensUsed: 500,
    symbolCount: 1,
    fileCount: 1,
    compressionBreakdown: { 0: 0, 1: 0, 2: 0, 3: 0 },
    observationCount: 0,
    quality: {
      pivotCount: 1,
      pivotsIncluded: 1,
      pivotCoverage: 1.0,
      dependencyCoverage: 1.0,
      coverageConfidence: 0.9,
      noiseRatio: 0.0,
      uncertaintyFlag: false,
      lowConfidence: false,
      uncertainty: "very_low",
      reasons: [],
      retrieval: {
        stageACandidateCount: 5,
        stageBSelectedCount: 1,
      },
    },
    generatedAt: 0,
    ...overrides,
  };
}

describe("formatCapsule — follow-up hints", () => {
  it("includes Follow-Up Reads section when L1/L2 nodes are present", () => {
    const nodes = [
      makeNode({ compressionLevel: 1, score: 0.9, symbol: { id: 1, fileId: 1, name: "skeletonFn", kind: "function", startLine: 5, endLine: 20, signature: "", bodyHash: "", fullSource: "", isExported: true, docComment: null, centrality: 0.5, lastSeen: 0 } }),
      makeNode({ compressionLevel: 2, score: 0.7, symbol: { id: 2, fileId: 1, name: "summaryFn", kind: "function", startLine: 1, endLine: 8, signature: "", bodyHash: "", fullSource: "", isExported: true, docComment: null, centrality: 0.5, lastSeen: 0 } }),
    ];

    const result = formatCapsule(nodes, [], makeMetadata());
    expect(result).toContain("Follow-Up Reads");
    expect(result).toContain('cw_read(symbol: "skeletonFn")');
    expect(result).toContain('cw_read(symbol: "summaryFn")');
    expect(result).toContain("These symbols were compressed. Use cw_read for full source:");
  });

  it("omits Follow-Up Reads section when only L0 nodes are present", () => {
    const nodes = [
      makeNode({ compressionLevel: 0, score: 1.0 }),
    ];

    const result = formatCapsule(nodes, [], makeMetadata());
    expect(result).not.toContain("Follow-Up Reads");
  });

  it("limits follow-up hints to 5 entries max", () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      makeNode({
        compressionLevel: 1,
        score: 1.0 - i * 0.1,
        symbol: {
          id: i + 1,
          fileId: 1,
          name: `fn${i}`,
          kind: "function",
          startLine: 1,
          endLine: 5,
          signature: "",
          bodyHash: "",
          fullSource: "",
          isExported: true,
          docComment: null,
          centrality: 0.5,
          lastSeen: 0,
        },
      })
    );

    const result = formatCapsule(nodes, [], makeMetadata());
    const matches = result.match(/cw_read\(symbol:/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it("includes line count and score in follow-up hints", () => {
    const nodes = [
      makeNode({
        compressionLevel: 1,
        score: 0.85,
        symbol: {
          id: 1,
          fileId: 1,
          name: "targetFn",
          kind: "function",
          startLine: 10,
          endLine: 29,
          signature: "",
          bodyHash: "",
          fullSource: "",
          isExported: true,
          docComment: null,
          centrality: 0.5,
          lastSeen: 0,
        },
      }),
    ];

    const result = formatCapsule(nodes, [], makeMetadata());
    expect(result).toContain("20 lines");
    expect(result).toContain("0.85");
  });

  it("adds concrete next actions when uncertainty is medium or worse", () => {
    const nodes = [
      makeNode({
        compressionLevel: 1,
        score: 0.85,
        symbol: {
          id: 1,
          fileId: 1,
          name: "targetFn",
          kind: "function",
          startLine: 10,
          endLine: 29,
          signature: "",
          bodyHash: "",
          fullSource: "",
          isExported: true,
          docComment: null,
          centrality: 0.5,
          lastSeen: 0,
        },
      }),
    ];

    const result = formatCapsule(nodes, [], makeMetadata({
      quality: {
        ...makeMetadata().quality,
        uncertaintyFlag: true,
        lowConfidence: true,
        uncertainty: "medium",
        reasons: ["overall coverage confidence below 60%"],
      },
    }));

    expect(result).toContain("--- Next Actions ---");
    expect(result).toContain('cw_read(symbol: "targetFn")');
    expect(result).toContain('cw_capsule(query: "test query", path: "src/core")');
  });
});

describe("formatCapsule — observation placement", () => {
  it("places high-confidence observations (>= 0.8) after header in Key Context section", () => {
    const obs = makeObs({ confidence: 0.9, note: "High conf note", scope: "auth" });
    const result = formatCapsule([], [obs], makeMetadata());

    expect(result).toContain("Key Context");
    expect(result).toContain("[auth] High conf note");
    const keyContextIdx = result.indexOf("Key Context");
    const obsNotIdx = result.indexOf("[auth] High conf note");
    const observationsIdx = result.indexOf("--- Observations ---");
    expect(obsNotIdx).toBeGreaterThan(keyContextIdx);
    expect(observationsIdx).toBe(-1);
  });

  it("places low-confidence observations (< 0.8) in Observations section at bottom", () => {
    const obs = makeObs({ confidence: 0.5, note: "Low conf note", scope: "perf" });
    const result = formatCapsule([], [obs], makeMetadata());

    expect(result).toContain("--- Observations ---");
    expect(result).toContain("[perf] Low conf note (confidence: 0.5)");
    expect(result).not.toContain("Key Context");
  });

  it("separates high and low confidence observations correctly", () => {
    const highObs = makeObs({ id: 1, confidence: 0.9, note: "High", scope: "arch" });
    const lowObs = makeObs({ id: 2, confidence: 0.4, note: "Low", scope: "perf" });
    const result = formatCapsule([], [highObs, lowObs], makeMetadata());

    expect(result).toContain("Key Context");
    expect(result).toContain("[arch] High");
    expect(result).toContain("--- Observations ---");
    expect(result).toContain("[perf] Low (confidence: 0.4)");

    const keyContextIdx = result.indexOf("Key Context");
    const observationsIdx = result.indexOf("--- Observations ---");
    expect(keyContextIdx).toBeLessThan(observationsIdx);
  });

  it("high confidence obs does not show confidence value in Key Context", () => {
    const obs = makeObs({ confidence: 0.95, note: "Arch decision", scope: "design" });
    const result = formatCapsule([], [obs], makeMetadata());

    const keyContextSection = result.slice(
      result.indexOf("--- Key Context ---"),
      result.indexOf("--- Key Context ---") + 200
    );
    expect(keyContextSection).toContain("[design] Arch decision");
    expect(keyContextSection).not.toContain("confidence: 0.95");
  });
});
