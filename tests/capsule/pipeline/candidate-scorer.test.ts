import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { FileRecord, LightSymbolRecord } from "../../../src/core/types.js";
import { createSchema } from "../../../src/db/schema.js";
import { runMigrations } from "../../../src/db/migrations.js";
import { createCapsuleContext } from "../../../src/capsule/pipeline/types.js";
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

function makeSymbol(
  id: number,
  fileId: number,
  name: string,
  visibility: LightSymbolRecord["visibility"] = "public"
): LightSymbolRecord {
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
    visibility,
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

  it("ensureBroadFileSpread prefers public symbols over private cross-file helpers", () => {
    const selected = [{
      symbol: makeSymbol(20, 20, "generateCapsule"),
      file: makeFile(20, "src/capsule/generator.ts"),
      score: 10,
      distance: 0,
      isPivot: true,
      lexicalScore: 5,
      degree: 0,
    }];
    const spread = ensureBroadFileSpread(selected, {
      intent: "broad",
      tokenBudget: 4500,
      queryUiFocused: false,
      ranked: selected,
      visited: new Map(),
      getFileSymbols: () => [
        makeSymbol(21, 21, "privateHelper", "private"),
        makeSymbol(22, 21, "publicApi", "public"),
      ],
      files: [makeFile(21, "src/capsule/service.ts")],
      pivotQueryTerms: ["service"],
    });

    expect(spread.some((candidate) => candidate.symbol.name === "publicApi")).toBe(true);
    expect(spread.some((candidate) => candidate.symbol.name === "privateHelper")).toBe(false);
  });

  it("blends cosine similarity into broad candidate ranking for semantic matches", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    const now = Date.now();
    db.prepare(`
      INSERT INTO files (id, path, basename, hash, last_indexed, mtime, language, symbol_count, error)
      VALUES
        (1, 'src/billing/charge.ts', 'charge.ts', 'h1', ?, ?, 'typescript', 1, NULL),
        (2, 'src/payments/handler.ts', 'handler.ts', 'h2', ?, ?, 'typescript', 1, NULL)
    `).run(now, now, now, now);

    db.prepare(`
      INSERT INTO symbols (id, file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, doc_comment, centrality, last_seen, visibility)
      VALUES
        (11, 1, 'ChargeDeclinedException', 'class', 1, 8, 'class ChargeDeclinedException {}', 's1', 'class ChargeDeclinedException {}', 1, NULL, 0.1, ?, 'public'),
        (12, 2, 'handlePaymentFailure', 'function', 1, 8, 'function handlePaymentFailure() {}', 's2', 'function handlePaymentFailure() {}', 1, NULL, 0.1, ?, 'public')
    `).run(now, now);

    db.prepare(`
      INSERT INTO chunks (id, file_id, chunk_index, start_line, end_line, start_byte, end_byte, text, contextualized_text, scope_chain, import_context, sibling_context, entity_context, token_count, content_hash, created_at)
      VALUES
        (101, 1, 0, 1, 8, 0, 80, 'class ChargeDeclinedException {}', 'class ChargeDeclinedException {}', '["ChargeDeclinedException"]', '[]', '[]', '["ChargeDeclinedException"]', 8, 'c1', ?),
        (102, 2, 0, 1, 8, 0, 80, 'function handlePaymentFailure() {}', 'function handlePaymentFailure() {}', '["handlePaymentFailure"]', '[]', '[]', '["handlePaymentFailure"]', 8, 'c2', ?)
    `).run(now, now);

    const cosineHigh = Buffer.from(new Float32Array([0.95, 0.05]).buffer);
    const cosineLow = Buffer.from(new Float32Array([0.20, 0.80]).buffer);
    db.prepare(`
      INSERT INTO chunk_embeddings (id, file_id, start_line, end_line, text_hash, embedding, model_name)
      VALUES
        (101, 1, 1, 8, 'c1', ?, 'test-model'),
        (102, 2, 1, 8, 'c2', ?, 'test-model')
    `).run(cosineHigh, cosineLow);

    const context = createCapsuleContext(db, {
      query: "payment failure",
      tokenBudget: 800,
      projectRoot: process.cwd(),
      queryEmbedding: new Float32Array([1, 0]),
    });

    const semantic = {
      symbol: makeSymbol(11, 1, "ChargeDeclinedException"),
      file: makeFile(1, "src/billing/charge.ts"),
      score: 0.7,
      distance: 1,
      isPivot: false,
      lexicalScore: 0.2,
      degree: 0,
    };
    const lexical = {
      symbol: makeSymbol(12, 2, "handlePaymentFailure"),
      file: makeFile(2, "src/payments/handler.ts"),
      score: 1.0,
      distance: 1,
      isPivot: false,
      lexicalScore: 1.0,
      degree: 0,
    };

    const scoring = scoreCandidates(
      context,
      {
        intent: "broad",
        allQueryTerms: ["payment", "failure"],
        exactQueryTerms: ["payment", "failure"],
        expandedQueryTerms: ["payment", "failure"],
        pivotQueryTerms: ["payment", "failure"],
        exactQueryTermSet: new Set(["payment", "failure"]),
        idfWeights: new Map(),
        observations: [],
        rawPivotIds: new Set(),
        pivotCandidates: [],
        rankedPivots: new Map(),
        pivotScores: [],
        pivotSymbolIds: new Set(),
        exactPivotIds: new Set(),
        relevantPivotIds: new Set(),
        topLocalityPivotIds: new Set(),
        queryUiFocused: false,
        queryLooksTestFocused: false,
        explicitTypeQuery: false,
        suppressTypeDeclarations: false,
        symbolNotFound: false,
        sameNameDefinitions: [],
        hasSameNameCollision: false,
        useMultiPass: false,
        subQueries: [],
        impliedModuleDirs: new Set(),
        preferRuntimeKinds: false,
        hybridStrategy: { enabled: true, applied: true, candidateCount: 2, exactMatches: 0 },
        classified: {
          intent: "broad",
          normalizedTerms: ["payment", "failure"],
          focusTerms: ["payment", "failure"],
          exactIdentifier: null,
          confidence: 0.8,
        },
        retrievalBudget: 800,
        activeLanes: [],
        candidateFiles: [],
        candidateFileBoostById: new Map(),
        sessionId: null,
        hasExplicitSession: false,
        sessionCtx: null,
        previousSameQueryTokens: null,
        recentFileIds: new Set(),
      },
      {
        visited: new Map(),
        candidates: [semantic, lexical],
        ranked: [lexical, semantic],
        batchDegrees: new Map(),
        observationCountBySymbol: new Map(),
        observationCountByFile: new Map(),
        fileCache: new Map(),
        pivotFileIds: new Set(),
        pivotDirs: new Set(),
        localityPivotDirs: new Set(),
        rankingPivotDirs: new Set(),
        centralityHubThreshold: 0,
        degreeHubThreshold: 0,
      }
    );

    expect(scoring.ranked[0]?.symbol.name).toBe("ChargeDeclinedException");

    db.close();
  });

  it("keeps exact lexical matches ahead of semantic neighbors for narrow queries", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    const now = Date.now();
    db.prepare(`
      INSERT INTO files (id, path, basename, hash, last_indexed, mtime, language, symbol_count, error)
      VALUES
        (1, 'src/billing/charge.ts', 'charge.ts', 'h1', ?, ?, 'typescript', 1, NULL),
        (2, 'src/payments/handler.ts', 'handler.ts', 'h2', ?, ?, 'typescript', 1, NULL)
    `).run(now, now, now, now);

    db.prepare(`
      INSERT INTO symbols (id, file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, doc_comment, centrality, last_seen, visibility)
      VALUES
        (21, 1, 'ChargeDeclinedException', 'class', 1, 8, 'class ChargeDeclinedException {}', 's1', 'class ChargeDeclinedException {}', 1, NULL, 0.1, ?, 'public'),
        (22, 2, 'handlePaymentFailure', 'function', 1, 8, 'function handlePaymentFailure() {}', 's2', 'function handlePaymentFailure() {}', 1, NULL, 0.1, ?, 'public')
    `).run(now, now);

    db.prepare(`
      INSERT INTO chunks (id, file_id, chunk_index, start_line, end_line, start_byte, end_byte, text, contextualized_text, scope_chain, import_context, sibling_context, entity_context, token_count, content_hash, created_at)
      VALUES
        (201, 1, 0, 1, 8, 0, 80, 'class ChargeDeclinedException {}', 'class ChargeDeclinedException {}', '["ChargeDeclinedException"]', '[]', '[]', '["ChargeDeclinedException"]', 8, 'c1', ?),
        (202, 2, 0, 1, 8, 0, 80, 'function handlePaymentFailure() {}', 'function handlePaymentFailure() {}', '["handlePaymentFailure"]', '[]', '[]', '["handlePaymentFailure"]', 8, 'c2', ?)
    `).run(now, now);

    const cosineExact = Buffer.from(new Float32Array([0.85, 0.15]).buffer);
    const cosineSemantic = Buffer.from(new Float32Array([0.95, 0.05]).buffer);
    db.prepare(`
      INSERT INTO chunk_embeddings (id, file_id, start_line, end_line, text_hash, embedding, model_name)
      VALUES
        (201, 1, 1, 8, 'c1', ?, 'test-model'),
        (202, 2, 1, 8, 'c2', ?, 'test-model')
    `).run(cosineExact, cosineSemantic);

    const context = createCapsuleContext(db, {
      query: "ChargeDeclinedException",
      tokenBudget: 800,
      projectRoot: process.cwd(),
      queryEmbedding: new Float32Array([1, 0]),
    });

    const exact = {
      symbol: makeSymbol(21, 1, "ChargeDeclinedException"),
      file: makeFile(1, "src/billing/charge.ts"),
      score: 1.0,
      distance: 0,
      isPivot: true,
      lexicalScore: 1.0,
      degree: 0,
    };
    const semantic = {
      symbol: makeSymbol(22, 2, "handlePaymentFailure"),
      file: makeFile(2, "src/payments/handler.ts"),
      score: 0.7,
      distance: 1,
      isPivot: false,
      lexicalScore: 0.2,
      degree: 0,
    };

    const scoring = scoreCandidates(
      context,
      {
        intent: "narrow",
        allQueryTerms: ["ChargeDeclinedException"],
        exactQueryTerms: ["ChargeDeclinedException"],
        expandedQueryTerms: ["ChargeDeclinedException"],
        pivotQueryTerms: ["ChargeDeclinedException"],
        exactQueryTermSet: new Set(["ChargeDeclinedException"]),
        idfWeights: new Map(),
        observations: [],
        rawPivotIds: new Set([21]),
        pivotCandidates: [],
        rankedPivots: new Map([[21, 1]]),
        pivotScores: [1],
        pivotSymbolIds: new Set([21]),
        exactPivotIds: new Set([21]),
        relevantPivotIds: new Set([21]),
        topLocalityPivotIds: new Set([21]),
        queryUiFocused: false,
        queryLooksTestFocused: false,
        explicitTypeQuery: false,
        suppressTypeDeclarations: false,
        symbolNotFound: false,
        sameNameDefinitions: [],
        hasSameNameCollision: false,
        useMultiPass: false,
        subQueries: [],
        impliedModuleDirs: new Set(),
        preferRuntimeKinds: false,
        hybridStrategy: { enabled: true, applied: true, candidateCount: 2, exactMatches: 1 },
        classified: {
          intent: "narrow",
          normalizedTerms: ["ChargeDeclinedException"],
          focusTerms: ["ChargeDeclinedException"],
          exactIdentifier: "ChargeDeclinedException",
          confidence: 0.95,
        },
        retrievalBudget: 800,
        activeLanes: [],
        candidateFiles: [],
        candidateFileBoostById: new Map(),
        sessionId: null,
        hasExplicitSession: false,
        sessionCtx: null,
        previousSameQueryTokens: null,
        recentFileIds: new Set(),
      },
      {
        visited: new Map([[21, 0], [22, 1]]),
        candidates: [exact, semantic],
        ranked: [exact, semantic],
        batchDegrees: new Map(),
        observationCountBySymbol: new Map(),
        observationCountByFile: new Map(),
        fileCache: new Map(),
        pivotFileIds: new Set([1]),
        pivotDirs: new Set(),
        localityPivotDirs: new Set(),
        rankingPivotDirs: new Set(),
        centralityHubThreshold: 0,
        degreeHubThreshold: 0,
      }
    );

    expect(scoring.ranked[0]?.symbol.name).toBe("ChargeDeclinedException");

    db.close();
  });
});
