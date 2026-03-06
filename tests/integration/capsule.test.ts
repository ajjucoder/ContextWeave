import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

let db: Database.Database;
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  await indexProject(db, FIXTURE_DIR);
  updateCentralityScores(db);
});

afterAll(() => {
  db.close();
});

describe("generateCapsule", () => {
  it("generates a capsule for a valid query", () => {
    const result = generateCapsule(db, {
      query: "UserService",
      tokenBudget: 4000,
      mode: "feature",
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content).toContain("ContextWeave Capsule");
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeLessThanOrEqual(4000);
  });

  it("renders relative paths in capsule output", () => {
    const result = generateCapsule(db, {
      query: "UserService",
      tokenBudget: 2000,
      mode: "feature",
    });

    expect(result.content).toContain("sample.ts");
    expect(result.content).not.toContain(FIXTURE_DIR);
    expect(result.content).not.toMatch(/\/\/\s+(?:[A-Za-z]:[\\/]|\/)/);
    expect(result.content).not.toMatch(/\/\/\s+===\s+(?:[A-Za-z]:[\\/]|\/)/);
    expect(result.content).not.toMatch(/\((?:[A-Za-z]:[\\/]|\/)[^):]+:\d+\)/);
  });

  it("respects token budget", () => {
    const smallResult = generateCapsule(db, {
      query: "User",
      tokenBudget: 500,
    });

    const largeResult = generateCapsule(db, {
      query: "User",
      tokenBudget: 4000,
    });

    expect(smallResult.metadata.tokensUsed).toBeLessThanOrEqual(500);
    expect(largeResult.metadata.tokensUsed).toBeLessThanOrEqual(4000);
  });

  it("uses full code budget when observations are minimal", () => {
    const result = generateCapsule(db, {
      query: "User",
      tokenBudget: 500,
    });

    expect(result.metadata.observationCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(350);
  });

  it("includes metadata with correct fields", () => {
    const result = generateCapsule(db, {
      query: "validateEmail",
    });

    expect(result.metadata.query).toBe("validateEmail");
    expect(result.metadata.mode).toBe("feature");
    expect(result.metadata.tokenBudget).toBeDefined();
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.fileCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.pivotCoverage).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.pivotCoverage).toBeLessThanOrEqual(1);
    expect(result.metadata.quality.dependencyCoverage).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.dependencyCoverage).toBeLessThanOrEqual(1);
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.coverageConfidence).toBeLessThanOrEqual(1);
    expect(typeof result.metadata.quality.uncertaintyFlag).toBe("boolean");
    expect(typeof result.metadata.quality.lowConfidence).toBe("boolean");
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.retrieval.stageBSelectedCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.metadata.quality.reasons)).toBe(true);
    expect(Array.isArray(result.metadata.filesIncluded)).toBe(true);
    expect(result.metadata.filesIncluded.length).toBe(result.metadata.fileCount);
    expect(result.metadata.diagnostics).toBeDefined();
    expect(result.metadata.generatedAt).toBeGreaterThan(0);
  });

  it("runs stage A retrieval before stage B filtering", () => {
    const result = generateCapsule(db, {
      query: "validateEmail",
      tokenBudget: 2000,
    });

    // Stage A now tracks raw pivot candidates while stage B tracks selected graph nodes.
    // Stage B can exceed Stage A due dependency expansion around pivots.
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeGreaterThan(0);
    expect(result.metadata.quality.retrieval.stageBSelectedCount).toBeGreaterThan(0);
  });

  it("includes uncertainty flag and coverage confidence in formatted output", () => {
    const result = generateCapsule(db, {
      query: "UserService",
      tokenBudget: 2000,
    });

    expect(result.content).toContain("Confidence:");
    expect(result.content).toContain("Uncertainty:");
    expect(result.content).toContain("Coverage confidence:");
    expect(result.content).toContain("Uncertainty flag:");
    expect(result.content).toContain("Retrieval: stageA");
  });

  it("supports different modes", () => {
    const debugResult = generateCapsule(db, {
      query: "User",
      mode: "debug",
    });

    const reviewResult = generateCapsule(db, {
      query: "User",
      mode: "review",
    });

    expect(debugResult.content.length).toBeGreaterThan(0);
    expect(reviewResult.content.length).toBeGreaterThan(0);
  });

  it("handles queries with no matches gracefully", () => {
    const result = generateCapsule(db, {
      query: "nonexistentSymbolXYZ123",
      tokenBudget: 2000,
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.metadata.symbolCount).toBe(0);
    expect(result.content).toContain("--- Diagnostics ---");
  });

  it("suppresses type declaration files when runtime hook files satisfy a broad runtime query", () => {
    const localDb = new Database(":memory:");
    localDb.pragma("foreign_keys = ON");
    createSchema(localDb);
    const now = Date.now();
    const files = fileQueries(localDb);
    const syms = symbolQueries(localDb);

    const runtimeFileId = files.insert({
      path: "lib/hooks.js",
      hash: "hook-runtime",
      lastIndexed: now,
      mtime: now,
      language: "javascript",
      symbolCount: 2,
      error: null,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "onSendHookRunner",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function onSendHookRunner(functions, request, reply, payload, cb)",
      bodyHash: "hook-runtime-1",
      fullSource:
        "function onSendHookRunner(functions, request, reply, payload, cb) { return cb(null, request, reply, payload); }",
      isExported: true,
      docComment: null,
      centrality: 8,
      lastSeen: now,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "preValidationHookRunner",
      kind: "function",
      startLine: 41,
      endLine: 80,
      signature: "function preValidationHookRunner(functions, request, reply, cb)",
      bodyHash: "hook-runtime-2",
      fullSource:
        "function preValidationHookRunner(functions, request, reply, cb) { return cb(null, request, reply); }",
      isExported: false,
      docComment: null,
      centrality: 6,
      lastSeen: now,
    });

    const routeFileId = files.insert({
      path: "lib/route.js",
      hash: "hook-route",
      lastIndexed: now,
      mtime: now,
      language: "javascript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: routeFileId,
      name: "validateRouteBody",
      kind: "function",
      startLine: 1,
      endLine: 30,
      signature: "function validateRouteBody(request, schema) validation lifecycle route",
      bodyHash: "hook-route-1",
      fullSource:
        "function validateRouteBody(request, schema) { return request && schema; }",
      isExported: true,
      docComment: null,
      centrality: 7,
      lastSeen: now,
    });

    const typeFileId = files.insert({
      path: "types/hooks.d.ts",
      hash: "hook-types",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: typeFileId,
      name: "onSendHookHandler",
      kind: "interface",
      startLine: 1,
      endLine: 20,
      signature: "interface onSendHookHandler<Request, Reply, Context>",
      bodyHash: "hook-types-1",
      fullSource: "interface onSendHookHandler<Request, Reply, Context> {}",
      isExported: true,
      docComment: null,
      centrality: 5,
      lastSeen: now,
    });

    updateCentralityScores(localDb);

    const result = generateCapsule(localDb, {
      query: "fastify hook validation lifecycle",
      tokenBudget: 4000,
      mode: "feature",
    });

    expect(result.metadata.filesIncluded).toContain("lib/hooks.js");
    expect(result.metadata.filesIncluded).toContain("lib/route.js");
    expect(result.metadata.filesIncluded).not.toContain("types/hooks.d.ts");
    expect(result.content).toContain("onSendHookRunner");
    expect(result.content).not.toContain("types/hooks.d.ts");
    localDb.close();
  });

  it("keeps capsule pipeline implementation files ahead of db helper files for broad architecture queries", () => {
    const localDb = new Database(":memory:");
    localDb.pragma("foreign_keys = ON");
    createSchema(localDb);
    const now = Date.now();
    const files = fileQueries(localDb);
    const syms = symbolQueries(localDb);

    const generatorFileId = files.insert({
      path: "src/capsule/generator.ts",
      hash: "capsule-generator",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: generatorFileId,
      name: "generateCapsule",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function generateCapsule(query, tokenBudget) capsule generation pipeline",
      bodyHash: "capsule-generator-1",
      fullSource:
        "function generateCapsule(query, tokenBudget) { return buildCapsulePipeline(query, tokenBudget); }",
      isExported: true,
      docComment: null,
      centrality: 8,
      lastSeen: now,
    });

    const scorerFileId = files.insert({
      path: "src/capsule/pivot-scorer.ts",
      hash: "capsule-scorer",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: scorerFileId,
      name: "scorePivotRelevance",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function scorePivotRelevance(candidate, queryTerms) scoring rank scorer",
      bodyHash: "capsule-scorer-1",
      fullSource:
        "function scorePivotRelevance(candidate, queryTerms) { return candidate.score + queryTerms.length; }",
      isExported: true,
      docComment: null,
      centrality: 7,
      lastSeen: now,
    });

    const compressorFileId = files.insert({
      path: "src/capsule/compressor.ts",
      hash: "capsule-compressor",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: compressorFileId,
      name: "renderSymbol",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function renderSymbol(node) compression compressor formatter",
      bodyHash: "capsule-compressor-1",
      fullSource:
        "function renderSymbol(node) { return formatCompressedSymbol(node); }",
      isExported: true,
      docComment: null,
      centrality: 7,
      lastSeen: now,
    });

    const dbFileId = files.insert({
      path: "src/db/queries/capsule-log.ts",
      hash: "capsule-db",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: dbFileId,
      name: "capsuleLogQueries",
      kind: "function",
      startLine: 1,
      endLine: 30,
      signature: "function capsuleLogQueries(db) capsule log query history",
      bodyHash: "capsule-db-1",
      fullSource:
        "function capsuleLogQueries(db) { return db.prepare('select * from capsule_log'); }",
      isExported: true,
      docComment: null,
      centrality: 5,
      lastSeen: now,
    });

    updateCentralityScores(localDb);

    const result = generateCapsule(localDb, {
      query: "capsule generation pipeline scoring compression",
      tokenBudget: 4000,
      mode: "feature",
    });

    expect(result.metadata.filesIncluded).toContain("src/capsule/generator.ts");
    expect(result.metadata.filesIncluded).toContain("src/capsule/pivot-scorer.ts");
    expect(result.metadata.filesIncluded).toContain("src/capsule/compressor.ts");
    expect(result.content).toContain("scorePivotRelevance");
    expect(result.content).toContain("renderSymbol");
    localDb.close();
  });
});
