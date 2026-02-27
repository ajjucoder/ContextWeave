import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { computeClusters, getClusterFileIds } from "../../src/core/clusters.js";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();

  const f1 = files.insert({ path: "src/capsule/generator.ts", hash: "a", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
  const f2 = files.insert({ path: "src/capsule/scorer.ts", hash: "b", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
  const f3 = files.insert({ path: "src/capsule/packer.ts", hash: "c", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
  const f4 = files.insert({ path: "src/utils/hash.ts", hash: "d", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });

  const s1 = syms.insert({ fileId: f1, name: "generate", kind: "function", startLine: 1, endLine: 10, signature: "function generate()", bodyHash: "x1", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const s2 = syms.insert({ fileId: f2, name: "score", kind: "function", startLine: 1, endLine: 10, signature: "function score()", bodyHash: "x2", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const s3 = syms.insert({ fileId: f3, name: "pack", kind: "function", startLine: 1, endLine: 10, signature: "function pack()", bodyHash: "x3", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const s4 = syms.insert({ fileId: f4, name: "hash", kind: "function", startLine: 1, endLine: 10, signature: "function hash()", bodyHash: "x4", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });

  edges.insert({ sourceSymbolId: s1, targetSymbolId: s2, kind: "import", createdAt: now });
  edges.insert({ sourceSymbolId: s2, targetSymbolId: s1, kind: "import", createdAt: now });
  edges.insert({ sourceSymbolId: s2, targetSymbolId: s3, kind: "import", createdAt: now });
});

describe("computeClusters", () => {
  it("assigns same cluster to tightly-coupled files", () => {
    computeClusters(db);

    const row1 = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = (SELECT id FROM files WHERE path = 'src/capsule/generator.ts')").get() as { cluster_id: number } | undefined;
    const row2 = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = (SELECT id FROM files WHERE path = 'src/capsule/scorer.ts')").get() as { cluster_id: number } | undefined;
    const row3 = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = (SELECT id FROM files WHERE path = 'src/capsule/packer.ts')").get() as { cluster_id: number } | undefined;

    expect(row1).toBeDefined();
    expect(row2).toBeDefined();
    expect(row3).toBeDefined();
    expect(row1!.cluster_id).toBe(row2!.cluster_id);
    expect(row1!.cluster_id).toBe(row3!.cluster_id);
  });

  it("assigns different cluster to isolated file", () => {
    const row1 = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = (SELECT id FROM files WHERE path = 'src/capsule/generator.ts')").get() as { cluster_id: number } | undefined;
    const row4 = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = (SELECT id FROM files WHERE path = 'src/utils/hash.ts')").get() as { cluster_id: number } | undefined;

    expect(row4).toBeDefined();
    expect(row1!.cluster_id).not.toBe(row4!.cluster_id);
  });

  it("getClusterFileIds returns all files in same cluster", () => {
    const row1 = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = (SELECT id FROM files WHERE path = 'src/capsule/generator.ts')").get() as { cluster_id: number };
    const clusterFileIds = getClusterFileIds(db, row1.cluster_id);
    expect(clusterFileIds.length).toBeGreaterThanOrEqual(3);
  });
});
