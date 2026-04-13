import { describe, expect, it } from "vitest";
import type { FileRecord, LightSymbolRecord } from "../../../src/core/types.js";
import { ensureCandidateFileAnchors, type RankedCandidate } from "../../../src/capsule/pipeline/file-anchors.js";

function makeFile(id: number, path: string): FileRecord {
  return { id, path, hash: "h", lastIndexed: 0, mtime: 0, language: "javascript", symbolCount: 1, error: null };
}

function makeSymbol(
  id: number,
  fileId: number,
  name: string,
  signature: string,
  visibility: LightSymbolRecord["visibility"] = "public"
): LightSymbolRecord {
  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 20,
    signature,
    bodyHash: `${id}`,
    isExported: true,
    docComment: null,
    centrality: 0.1,
    lastSeen: Date.now(),
    parentSymbolId: null,
    qualifiedName: null,
    visibility,
  };
}

function makeCandidate(
  symbol: LightSymbolRecord,
  file: FileRecord,
  score: number,
  lexicalScore: number
): RankedCandidate {
  return {
    symbol,
    file,
    score,
    distance: 1,
    isPivot: false,
    lexicalScore,
    degree: 0,
  };
}

describe("ensureCandidateFileAnchors", () => {
  it("adds the strongest query-matching symbol from a top file even when that file already has a weaker selection", () => {
    const hooksFile = makeFile(1, "lib/hooks.js");
    const selected = [
      makeCandidate(
        makeSymbol(11, 1, "Hooks", "function Hooks() hook lifecycle registry"),
        hooksFile,
        9,
        3.5
      ),
    ];
    const anchorCandidate = makeCandidate(
      makeSymbol(
        12,
        1,
        "onSendHookRunner",
        "function onSendHookRunner(functions, request, reply, payload, cb)"
      ),
      hooksFile,
      7,
      9.4
    );

    const anchored = ensureCandidateFileAnchors(selected, {
      intent: "broad",
      topCandidateFiles: [hooksFile],
      ranked: [selected[0]!, anchorCandidate],
      getFileSymbols: () => [selected[0]!.symbol, anchorCandidate.symbol],
      pivotQueryTerms: ["fastify", "hook", "validation", "lifecycle"],
    });

    expect(anchored.some((candidate) => candidate.symbol.name === "onSendHookRunner")).toBe(true);
  });

  it("anchors an unselected top runtime file with its best lexical symbol", () => {
    const routeFile = makeFile(2, "lib/route.js");
    const schemaFile = makeFile(3, "lib/schema-controller.js");
    const selected = [
      makeCandidate(
        makeSymbol(21, 2, "buildRouteContext", "function buildRouteContext() request validation route"),
        routeFile,
        8,
        4
      ),
    ];
    const schemaAnchor = makeCandidate(
      makeSymbol(
        31,
        3,
        "setValidatorCompiler",
        "function setValidatorCompiler(compiler) schema compiler setup"
      ),
      schemaFile,
      6,
      7.8
    );

    const anchored = ensureCandidateFileAnchors(selected, {
      intent: "broad",
      topCandidateFiles: [routeFile, schemaFile],
      ranked: [selected[0]!, schemaAnchor],
      getFileSymbols: (fileId) =>
        fileId === schemaFile.id
          ? [schemaAnchor.symbol]
          : [selected[0]!.symbol],
      pivotQueryTerms: ["schema", "compiler", "request", "validation", "flow"],
    });

    expect(anchored.some((candidate) => candidate.file.path === "lib/schema-controller.js")).toBe(true);
    expect(anchored.some((candidate) => candidate.symbol.name === "setValidatorCompiler")).toBe(true);
  });

  it("prefers executable functions over variable aliases when anchoring top runtime files", () => {
    const hooksFile = makeFile(4, "lib/hooks.js");
    const variableAlias = makeSymbol(
      41,
      4,
      "preValidationHookRunner",
      "const preValidationHookRunner = hookRunnerGenerator(hookIterator)"
    );
    variableAlias.kind = "variable";
    const runtimeFunction = makeSymbol(
      42,
      4,
      "onSendHookRunner",
      "function onSendHookRunner(functions, request, reply, payload, cb)"
    );

    const anchored = ensureCandidateFileAnchors([], {
      intent: "broad",
      topCandidateFiles: [hooksFile],
      ranked: [
        makeCandidate(variableAlias, hooksFile, 7, 9.5),
        makeCandidate(runtimeFunction, hooksFile, 6, 6.8),
      ],
      getFileSymbols: () => [variableAlias, runtimeFunction],
      pivotQueryTerms: ["fastify", "hook", "validation", "lifecycle"],
    });

    expect(anchored[0]?.symbol.name).toBe("onSendHookRunner");
  });

  it("still adds the executable runtime symbol when a same-file variable alias already has a strong lexical score", () => {
    const hooksFile = makeFile(5, "lib/hooks.js");
    const selectedAlias = makeSymbol(
      51,
      5,
      "preValidationHookRunner",
      "const preValidationHookRunner = hookRunnerGenerator(hookIterator)"
    );
    selectedAlias.kind = "variable";
    const runtimeFunction = makeSymbol(
      52,
      5,
      "onSendHookRunner",
      "function onSendHookRunner(functions, request, reply, payload, cb)"
    );

    const anchored = ensureCandidateFileAnchors(
      [makeCandidate(selectedAlias, hooksFile, 8.5, 8)],
      {
        intent: "broad",
        topCandidateFiles: [hooksFile],
        ranked: [
          makeCandidate(selectedAlias, hooksFile, 8.5, 8),
          makeCandidate(runtimeFunction, hooksFile, 7.5, 9.4),
        ],
        getFileSymbols: () => [selectedAlias, runtimeFunction],
        pivotQueryTerms: ["fastify", "hook", "validation", "lifecycle"],
      }
    );

    expect(anchored.some((candidate) => candidate.symbol.name === "onSendHookRunner")).toBe(true);
  });

  it("falls back to a representative runtime symbol when the file match is path-level only", () => {
    const appFile = makeFile(6, "lib/application.js");
    const initSymbol = makeSymbol(61, 6, "init", "function init()");
    const routeSymbol = makeSymbol(62, 6, "lazyrouter", "function lazyrouter()");

    const anchored = ensureCandidateFileAnchors([], {
      intent: "broad",
      topCandidateFiles: [appFile],
      ranked: [],
      getFileSymbols: () => [routeSymbol, initSymbol],
      pivotQueryTerms: ["route", "registration", "middleware", "dispatch", "chain"],
    });

    expect(anchored).toHaveLength(1);
    expect(anchored[0]?.file.path).toBe("lib/application.js");
  });
});
