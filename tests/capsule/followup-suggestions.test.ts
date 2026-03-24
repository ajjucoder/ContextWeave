import { describe, it, expect } from "vitest";
import { buildStructuredOutput } from "../../src/capsule/formatter.js";
import type { ScoredNode, ObservationRecord, CapsuleMetadata, FileRecord, SymbolRecord } from "../../src/core/types.js";

function makeFile(path: string): FileRecord {
  return {
    id: 1,
    path,
    hash: "abc",
    lastIndexed: 0,
    mtime: 0,
    language: "typescript",
    symbolCount: 1,
    error: null,
  };
}

function makeSymbol(name: string, id = 1): SymbolRecord {
  return {
    id,
    fileId: 1,
    name,
    kind: "function",
    startLine: 1,
    endLine: 10,
    signature: `function ${name}()`,
    bodyHash: "hash",
    fullSource: `function ${name}() {}`,
    isExported: true,
    centrality: 1,
    pageRank: 0,
    lastModified: 0,
  };
}

function makeMetadata(query: string): CapsuleMetadata {
  return {
    query,
    mode: "feature",
    tokenBudget: 4000,
    tokensUsed: 1000,
    symbolCount: 5,
    fileCount: 2,
    filesIncluded: ["src/a.ts"],
    compressionBreakdown: { 0: 2, 1: 2, 2: 1, 3: 0 },
    observationCount: 0,
    quality: {
      pivotCount: 2,
      pivotsIncluded: 2,
      pivotCoverage: 1.0,
      dependencyCoverage: 1.0,
      coverageConfidence: 0.8,
      noiseRatio: 0.1,
      uncertaintyFlag: false,
      lowConfidence: false,
      uncertainty: "low",
      reasons: [],
      retrieval: { stageACandidateCount: 10, stageBSelectedCount: 5 },
    },
    diagnostics: {
      queryClass: "narrow",
      pivotStats: {
        rawCandidates: 10,
        afterRanking: 2,
        afterPacking: 2,
        topPivotScores: [10],
        bottomPivotScores: [10],
      },
      coverageStats: {
        filesRetrieved: 2,
        filesRelevant: 2,
        symbolsRetrieved: 5,
        symbolsPacked: 5,
        tokenBudgetUsed: 0.25,
        l0Count: 2,
        l1Count: 2,
        l2Count: 1,
        l3Count: 0,
      },
      bottleneck: "none",
      bottlenecks: [],
      bottleneckDetail: "none",
      suggestion: "none",
    },
    strategy: {
      intent: "narrow",
      mode: "single-pass",
      subQueryCount: 1,
    },
  };
}

function makeNode(name: string, compressionLevel: 0 | 1 | 2 | 3, score: number, filePath = "src/a.ts"): ScoredNode {
  return {
    symbol: makeSymbol(name, Math.floor(Math.random() * 10000)),
    file: makeFile(filePath),
    score,
    distance: 0,
    compressionLevel,
    rendered: `function ${name}() {}`,
    tokenCount: 10,
  };
}

describe("buildStructuredOutput follow-up suggestions", () => {
  it("includes lowercase confidence tier and recommended supplementary reads from top pivot score", () => {
    const result = buildStructuredOutput(
      [makeNode("validateEmail", 0, 1.0)],
      [],
      makeMetadata("validate email"),
      "text"
    );

    expect(result.confidence).toBe("high");
    expect(result.recommended_supplementary_reads).toBe(2);
  });

  it("includes suggestedReads only for compressed nodes with query-term overlap", () => {
    const query = "validate email user auth";
    const nodes: ScoredNode[] = [
      makeNode("validateEmail", 0, 1.0),
      makeNode("validatePassword", 1, 0.8),
      makeNode("userAuth", 1, 0.7),
      makeNode("parseCSV", 1, 0.9),
      makeNode("formatDate", 2, 0.6),
    ];

    const result = buildStructuredOutput(nodes, [], makeMetadata(query), "text");

    const suggestedNames = result.suggestedReads.map((r) => r.args.symbol);

    expect(suggestedNames.some((n) => n === "validatePassword" || n === "userAuth")).toBe(true);

    expect(suggestedNames).not.toContain("parseCSV");
    expect(suggestedNames).not.toContain("formatDate");

    expect(suggestedNames).not.toContain("validateEmail");
  });

  it("excludes zero-relevance symbols from suggestedReads", () => {
    const query = "capsule token budget";
    const nodes: ScoredNode[] = [
      makeNode("generateCapsule", 0, 1.0),
      makeNode("unrelatedFunction", 1, 0.5),
      makeNode("anotherUnrelated", 2, 0.3),
      makeNode("tokenBudgetCalc", 1, 0.6),
    ];

    const result = buildStructuredOutput(nodes, [], makeMetadata(query), "text");

    const suggestedNames = result.suggestedReads.map((r) => r.args.symbol);

    expect(suggestedNames).toContain("tokenBudgetCalc");
    expect(suggestedNames).not.toContain("unrelatedFunction");
    expect(suggestedNames).not.toContain("anotherUnrelated");
    expect(suggestedNames).not.toContain("generateCapsule");
  });

  it("caps suggestedReads at 5 entries", () => {
    const query = "user auth login password validate token refresh";
    const nodes: ScoredNode[] = [
      makeNode("userAuth", 0, 1.0),
      makeNode("loginUser", 1, 0.9),
      makeNode("validateToken", 1, 0.8),
      makeNode("refreshToken", 1, 0.7),
      makeNode("authMiddleware", 1, 0.75),
      makeNode("validatePassword", 1, 0.85),
      makeNode("userLogin", 2, 0.6),
      makeNode("tokenExpiry", 1, 0.5),
    ];

    const result = buildStructuredOutput(nodes, [], makeMetadata(query), "text");

    expect(result.suggestedReads.length).toBeLessThanOrEqual(2);
  });

  it("expands suggestedReads cap for medium-confidence pivot tiers", () => {
    const query = "user auth login password validate token refresh";
    const nodes: ScoredNode[] = [
      makeNode("userAuth", 0, 1.0),
      makeNode("loginUser", 1, 0.9),
      makeNode("validateToken", 1, 0.8),
      makeNode("refreshToken", 1, 0.7),
      makeNode("authMiddleware", 1, 0.75),
      makeNode("validatePassword", 1, 0.85),
      makeNode("userLogin", 2, 0.6),
      makeNode("tokenExpiry", 1, 0.5),
    ];
    const metadata = {
      ...makeMetadata(query),
      diagnostics: {
        ...makeMetadata(query).diagnostics!,
        pivotStats: {
          ...makeMetadata(query).diagnostics!.pivotStats,
          topPivotScores: [8],
          bottomPivotScores: [8],
        },
      },
    };

    const result = buildStructuredOutput(nodes, [], metadata, "text");

    expect(result.confidence).toBe("medium");
    expect(result.recommended_supplementary_reads).toBe(5);
    expect(result.suggestedReads.length).toBeLessThanOrEqual(5);
  });

  it("ranks uncovered query terms first over covered ones", () => {
    const query = "handleSubmit form validation";
    const nodes: ScoredNode[] = [
      makeNode("formValidation", 0, 1.0),
      makeNode("handleSubmit", 1, 0.5),
      makeNode("validateForm", 1, 0.9),
    ];

    const result = buildStructuredOutput(nodes, [], makeMetadata(query), "text");

    const suggestedNames = result.suggestedReads.map((r) => r.args.symbol);

    expect(suggestedNames).toContain("handleSubmit");
    expect(suggestedNames).not.toContain("formValidation");
  });
});
