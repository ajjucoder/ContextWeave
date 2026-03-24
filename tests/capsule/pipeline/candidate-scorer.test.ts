import { describe, expect, it, vi } from "vitest";
import type { FileRecord, LightSymbolRecord } from "../../../src/core/types.js";
import { resolvePivots } from "../../../src/capsule/pipeline/pivot-resolver.js";
import { expandGraph } from "../../../src/capsule/pipeline/graph-expander.js";
import {
  scoreCandidates,
  pruneUiNoise,
  ensureBroadFileSpread,
  batchFetchOutgoingEdges,
} from "../../../src/capsule/pipeline/candidate-scorer.js";
import { usePipelineFixture } from "./test-helpers.js";

const fixture = usePipelineFixture();

function makeFile(id: number, path: string): FileRecord {
  return { id, path, hash: "h", lastIndexed: 0, mtime: 0, language: "typescript", symbolCount: 1, error: null };
}

function makeSymbol(id: number, fileId: number, name: string): LightSymbolRecord {
  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 10,
    signature: `function ${name}()`,
    bodyHash: `${id}`,
    isExported: true,
    docComment: null,
    centrality: 0.1,
    lastSeen: Date.now(),
    parentSymbolId: null,
    qualifiedName: null,
  };
}

describe("candidate scorer", () => {
  it("selects and materializes scored nodes from graph expansion", () => {
    const context = fixture.createContext("capsule scoring pipeline", { tokenBudget: 4500 });
    const pivots = resolvePivots(context);
    const graphState = expandGraph(context, pivots);
    const scoring = scoreCandidates(context, pivots, graphState);

    expect(scoring.selected.length).toBeGreaterThan(0);
    expect(scoring.scoredNodes.length).toBeGreaterThan(0);
    expect(scoring.scoredNodes[0]?.rendered.length).toBeGreaterThan(0);
    expect(scoring.clusterBySymbolId.size).toBeGreaterThanOrEqual(0);
  });

  it("reuses prepared outgoing-edge statements for repeated batch sizes", () => {
    const context = fixture.createContext("capsule scoring pipeline", { tokenBudget: 4500 });
    const symbolIds = context.symbols.getAllIds().slice(0, 8);
    const prepareSpy = vi.spyOn(context.db, "prepare");

    batchFetchOutgoingEdges(context, symbolIds);
    batchFetchOutgoingEdges(context, symbolIds);

    expect(prepareSpy).toHaveBeenCalledTimes(1);
  });

  it("pruneUiNoise drops UI-only files when enough runtime files remain", () => {
    const runtime = {
      symbol: makeSymbol(1, 1, "submitForm"),
      file: makeFile(1, "src/api/submit.ts"),
      score: 5,
      distance: 1,
      isPivot: false,
      lexicalScore: 3,
      degree: 0,
    };
    const uiNoise = {
      symbol: makeSymbol(2, 2, "HeroCard"),
      file: makeFile(2, "src/components/HeroCard.tsx"),
      score: 4,
      distance: 1,
      isPivot: false,
      lexicalScore: 0,
      degree: 0,
    };
    const kept = pruneUiNoise([runtime, { ...runtime, symbol: makeSymbol(3, 3, "handleSubmit"), file: makeFile(3, "src/server/handler.ts") }, { ...runtime, symbol: makeSymbol(4, 4, "persistLead"), file: makeFile(4, "src/services/lead.ts") }, uiNoise], {
      intent: "broad",
      queryUiFocused: false,
    });

    expect(kept.some((candidate) => candidate.symbol.name === "HeroCard")).toBe(false);
  });

  it("ensureBroadFileSpread adds an extra relevant file when broad selection is too narrow", () => {
    const selected = [{
      symbol: makeSymbol(10, 10, "generateCapsule"),
      file: makeFile(10, "src/capsule/generator.ts"),
      score: 10,
      distance: 0,
      isPivot: true,
      lexicalScore: 5,
      degree: 0,
    }];
    const ranked = [
      selected[0],
      {
        symbol: makeSymbol(11, 11, "packNodes"),
        file: makeFile(11, "src/capsule/packer.ts"),
        score: 6,
        distance: 1,
        isPivot: false,
        lexicalScore: 3,
        degree: 0,
      },
      {
        symbol: makeSymbol(12, 12, "formatCapsule"),
        file: makeFile(12, "src/capsule/formatter.ts"),
        score: 5,
        distance: 1,
        isPivot: false,
        lexicalScore: 2,
        degree: 0,
      },
    ];

    const spread = ensureBroadFileSpread(selected, {
      intent: "broad",
      tokenBudget: 4500,
      queryUiFocused: false,
      ranked,
      visited: new Map(),
      getFileSymbols: () => [],
      pivotQueryTerms: ["capsule", "pipeline"],
    });

    expect(spread.length).toBeGreaterThan(selected.length);
    expect(new Set(spread.map((candidate) => candidate.file.id)).size).toBeGreaterThan(1);
  });
});
