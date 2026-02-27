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
});
