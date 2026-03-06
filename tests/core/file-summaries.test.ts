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
    const now = Date.now();
    const files = fileQueries(db);
    const syms = symbolQueries(db);

    const runtimeFileId = files.insert({
      path: "lib/application.js",
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
      signature: "function createApplication() router middleware request handling",
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
      signature: "function routerHandle(router, done)",
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

    upsertFileSummary(db, runtimeFileId);
    upsertFileSummary(db, testFileId);

    const results = searchFilesByQuery(db, "middleware routing request response pipeline", 10);
    const runtimeIndex = results.findIndex((row) => row.path === "lib/application.js");
    const testIndex = results.findIndex((row) => row.path === "test/middleware.basic.js");

    expect(runtimeIndex).toBeGreaterThanOrEqual(0);
    expect(testIndex).toBeGreaterThanOrEqual(0);
    expect(runtimeIndex).toBeLessThan(testIndex);
  });
});
