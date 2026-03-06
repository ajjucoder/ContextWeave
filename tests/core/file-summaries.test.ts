import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { computeFileSummary, upsertFileSummary, searchFilesByQuery } from "../../src/core/file-summaries.js";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  const now = Date.now();

  const files = fileQueries(db);
  const syms = symbolQueries(db);

  const fileId1 = files.insert({ path: "src/capsule/generator.ts", hash: "a", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 3, error: null });
  syms.insert({ fileId: fileId1, name: "generateCapsule", kind: "function", startLine: 1, endLine: 100, signature: "function generateCapsule(db, params)", bodyHash: "x1", fullSource: "", isExported: true, docComment: null, centrality: 5, lastSeen: now });
  syms.insert({ fileId: fileId1, name: "buildCapsulePipeline", kind: "function", startLine: 101, endLine: 200, signature: "function buildCapsulePipeline()", bodyHash: "x2", fullSource: "", isExported: false, docComment: null, centrality: 3, lastSeen: now });

  const fileId2 = files.insert({ path: "src/core/graph.ts", hash: "b", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 2, error: null });
  syms.insert({ fileId: fileId2, name: "weightedBfsTraversal", kind: "function", startLine: 1, endLine: 50, signature: "function weightedBfsTraversal()", bodyHash: "y1", fullSource: "", isExported: true, docComment: null, centrality: 8, lastSeen: now });

  upsertFileSummary(db, fileId1);
  upsertFileSummary(db, fileId2);
});

describe("file summaries", () => {
  it("upserts summary for a file with symbols", () => {
    const row = db.prepare("SELECT * FROM file_summaries WHERE file_id = (SELECT id FROM files WHERE path = 'src/capsule/generator.ts')").get() as { summary_text: string; symbol_count: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.symbol_count).toBe(2);
    expect(row!.summary_text).toContain("generatecapsule");
  });

  it("searchFilesByQuery finds relevant files", () => {
    const results = searchFilesByQuery(db, "capsule generator pipeline", 10);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("src/capsule/generator.ts");
  });

  it("searchFilesByQuery finds graph file by symbol name", () => {
    const results = searchFilesByQuery(db, "weighted bfs traversal", 10);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("src/core/graph.ts");
  });

  it("indexes document-like files through summary text even when symbol coverage is minimal", () => {
    const now = Date.now();
    const files = fileQueries(db);
    const syms = symbolQueries(db);

    const fileId = files.insert({
      path: "docs/partner-policy.md",
      hash: "doc-a",
      lastIndexed: now,
      mtime: now,
      language: "markdown",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId,
      name: "partner policy district approval auto enrollment",
      kind: "variable",
      startLine: 1,
      endLine: 3,
      signature: "# Partner Policy District approval is required before auto-enrollment.",
      bodyHash: "doc-x1",
      fullSource: "# Partner Policy\n\nDistrict approval is required before auto-enrollment.",
      isExported: true,
      docComment: null,
      centrality: 1,
      lastSeen: now,
    });

    upsertFileSummary(db, fileId);

    const results = searchFilesByQuery(db, "district approval partner rules", 10);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("docs/partner-policy.md");
  });

  it("prefers runtime files over test files for broad non-test queries", () => {
    const localDb = new Database(":memory:");
    localDb.pragma("foreign_keys = ON");
    createSchema(localDb);
    const now = Date.now();
    const files = fileQueries(localDb);
    const syms = symbolQueries(localDb);

    const runtimeFileId = files.insert({
      path: "server/runtime-application.js",
      hash: "runtime-a",
      lastIndexed: now,
      mtime: now,
      language: "javascript",
      symbolCount: 2,
      error: null,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "createApplication",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function createApplication() router middleware request response pipeline handling",
      bodyHash: "runtime-x1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 9,
      lastSeen: now,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "routerHandle",
      kind: "function",
      startLine: 41,
      endLine: 80,
      signature: "function routerHandle(router, done) middleware routing request response pipeline",
      bodyHash: "runtime-x2",
      fullSource: "",
      isExported: false,
      docComment: null,
      centrality: 7,
      lastSeen: now,
    });

    const testFileId = files.insert({
      path: "test/middleware.basic.js",
      hash: "test-a",
      lastIndexed: now,
      mtime: now,
      language: "javascript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: testFileId,
      name: "middlewareLifecycleSpec",
      kind: "function",
      startLine: 1,
      endLine: 30,
      signature: "function middlewareLifecycleSpec() request response pipeline routing assertions",
      bodyHash: "test-x1",
      fullSource: "",
      isExported: false,
      docComment: null,
      centrality: 2,
      lastSeen: now,
    });

    upsertFileSummary(localDb, runtimeFileId);
    upsertFileSummary(localDb, testFileId);

    const results = searchFilesByQuery(localDb, "router middleware pipeline", 20);
    const runtimeIndex = results.findIndex((row) => row.path === "server/runtime-application.js");
    const testIndex = results.findIndex((row) => row.path === "test/middleware.basic.js");

    expect(runtimeIndex).toBeGreaterThanOrEqual(0);
    if (testIndex >= 0) {
      expect(runtimeIndex).toBeLessThan(testIndex);
    }
    localDb.close();
  });

  it("downranks repo automation files for runtime routing queries but keeps them for config queries", () => {
    const localDb = new Database(":memory:");
    localDb.pragma("foreign_keys = ON");
    createSchema(localDb);
    const now = Date.now();
    const files = fileQueries(localDb);
    const syms = symbolQueries(localDb);

    const runtimeFileId = files.insert({
      path: "lib/application.js",
      hash: "runtime-b",
      lastIndexed: now,
      mtime: now,
      language: "javascript",
      symbolCount: 2,
      error: null,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "routerHandle",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function routerHandle(req, res, next) request lifecycle middleware dispatch",
      bodyHash: "runtime-y1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 9,
      lastSeen: now,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "lazyrouter",
      kind: "function",
      startLine: 41,
      endLine: 80,
      signature: "function lazyrouter() route registration stack",
      bodyHash: "runtime-y2",
      fullSource: "",
      isExported: false,
      docComment: null,
      centrality: 7,
      lastSeen: now,
    });

    const configFileId = files.insert({
      path: ".github/workflows/ci.yml",
      hash: "config-a",
      lastIndexed: now,
      mtime: now,
      language: "yaml",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: configFileId,
      name: "workflow dispatch request pipeline",
      kind: "variable",
      startLine: 1,
      endLine: 10,
      signature: "workflow_dispatch request lifecycle ci pipeline",
      bodyHash: "config-y1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 1,
      lastSeen: now,
    });

    upsertFileSummary(localDb, runtimeFileId);
    upsertFileSummary(localDb, configFileId);

    const runtimeResults = searchFilesByQuery(localDb, "request lifecycle middleware dispatch", 10);
    const runtimePaths = runtimeResults.map((row) => row.path);
    expect(runtimePaths.indexOf("lib/application.js")).toBeGreaterThanOrEqual(0);
    expect(runtimePaths.indexOf(".github/workflows/ci.yml")).toBeGreaterThanOrEqual(0);
    expect(runtimePaths.indexOf("lib/application.js")).toBeLessThan(runtimePaths.indexOf(".github/workflows/ci.yml"));

    const configResults = searchFilesByQuery(localDb, "github workflow dispatch", 10);
    expect(configResults[0]?.path).toBe(".github/workflows/ci.yml");
    localDb.close();
  });

  it("downranks type declaration files for runtime validation flow queries but keeps them for type queries", () => {
    const localDb = new Database(":memory:");
    localDb.pragma("foreign_keys = ON");
    createSchema(localDb);
    const now = Date.now();
    const files = fileQueries(localDb);
    const syms = symbolQueries(localDb);

    const runtimeFileId = files.insert({
      path: "lib/schema-controller.js",
      hash: "runtime-c",
      lastIndexed: now,
      mtime: now,
      language: "javascript",
      symbolCount: 2,
      error: null,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "buildSchemaController",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function buildSchemaController(setValidatorCompiler, setupValidator) request validation flow",
      bodyHash: "runtime-z1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 8,
      lastSeen: now,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "setValidatorCompiler",
      kind: "function",
      startLine: 41,
      endLine: 80,
      signature: "function setValidatorCompiler(compiler) schema compiler setup",
      bodyHash: "runtime-z2",
      fullSource: "",
      isExported: false,
      docComment: null,
      centrality: 7,
      lastSeen: now,
    });

    const typeFileId = files.insert({
      path: "types/request.d.ts",
      hash: "types-c",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: typeFileId,
      name: "FastifyRequest",
      kind: "interface",
      startLine: 1,
      endLine: 40,
      signature: "interface FastifyRequest<RouteGeneric, SchemaCompiler> request validation types",
      bodyHash: "types-z1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 4,
      lastSeen: now,
    });

    upsertFileSummary(localDb, runtimeFileId);
    upsertFileSummary(localDb, typeFileId);

    const runtimeResults = searchFilesByQuery(localDb, "schema compiler request validation flow", 10);
    const runtimeIndex = runtimeResults.findIndex((row) => row.path === "lib/schema-controller.js");
    const typeIndex = runtimeResults.findIndex((row) => row.path === "types/request.d.ts");

    expect(runtimeIndex).toBeGreaterThanOrEqual(0);
    if (typeIndex >= 0) {
      expect(runtimeIndex).toBeLessThan(typeIndex);
    }

    const typeResults = searchFilesByQuery(localDb, "request interface schema compiler types", 10);
    expect(typeResults[0]?.path).toBe("types/request.d.ts");
    localDb.close();
  });

  it("keeps runtime hook files ahead of hook type declarations for lifecycle queries", () => {
    const localDb = new Database(":memory:");
    localDb.pragma("foreign_keys = ON");
    createSchema(localDb);
    const now = Date.now();
    const files = fileQueries(localDb);
    const syms = symbolQueries(localDb);

    const runtimeFileId = files.insert({
      path: "lib/hooks.js",
      hash: "runtime-hook",
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
      signature: "function onSendHookRunner(functions, request, reply, payload, cb) validation lifecycle pipeline",
      bodyHash: "runtime-hook-1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 9,
      lastSeen: now,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "preValidationHookRunner",
      kind: "function",
      startLine: 41,
      endLine: 80,
      signature: "function preValidationHookRunner(functions, request, reply, cb) hook lifecycle validation",
      bodyHash: "runtime-hook-2",
      fullSource: "",
      isExported: false,
      docComment: null,
      centrality: 7,
      lastSeen: now,
    });

    const typeFileId = files.insert({
      path: "types/hooks.d.ts",
      hash: "type-hook",
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
      bodyHash: "type-hook-1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 4,
      lastSeen: now,
    });

    upsertFileSummary(localDb, runtimeFileId);
    upsertFileSummary(localDb, typeFileId);

    const results = searchFilesByQuery(localDb, "fastify hook validation lifecycle", 10);
    expect(results[0]?.path).toBe("lib/hooks.js");
    expect(results.findIndex((row) => row.path === "types/hooks.d.ts")).toBeGreaterThan(
      results.findIndex((row) => row.path === "lib/hooks.js")
    );
    localDb.close();
  });

  it("normalizes absolute workspace paths before scoring runtime hook queries", () => {
    const localDb = new Database(":memory:");
    localDb.pragma("foreign_keys = ON");
    createSchema(localDb);
    const now = Date.now();
    const files = fileQueries(localDb);
    const syms = symbolQueries(localDb);

    const runtimeFileId = files.insert({
      path: "/Users/tester/workspaces/contextweave/.qa-temp/fastify/lib/hooks.js",
      hash: "abs-runtime-hook",
      lastIndexed: now,
      mtime: now,
      language: "javascript",
      symbolCount: 1,
      error: null,
    });
    syms.insert({
      fileId: runtimeFileId,
      name: "onSendHookRunner",
      kind: "function",
      startLine: 1,
      endLine: 40,
      signature: "function onSendHookRunner(functions, request, reply, payload, cb) validation lifecycle",
      bodyHash: "abs-runtime-hook-1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 9,
      lastSeen: now,
    });

    const typeFileId = files.insert({
      path: "/Users/tester/workspaces/contextweave/.qa-temp/fastify/types/hooks.d.ts",
      hash: "abs-type-hook",
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
      bodyHash: "abs-type-hook-1",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 4,
      lastSeen: now,
    });

    upsertFileSummary(localDb, runtimeFileId);
    upsertFileSummary(localDb, typeFileId);

    const results = searchFilesByQuery(localDb, "fastify hook validation lifecycle", 10);
    expect(results[0]?.path).toBe("/Users/tester/workspaces/contextweave/.qa-temp/fastify/lib/hooks.js");
    localDb.close();
  });
});
