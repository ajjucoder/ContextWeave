import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { computeClusters, getClusterFileIds } from "../../src/core/clusters.js";

function setupDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  return {
    db,
    files: fileQueries(db),
    syms: symbolQueries(db),
    edges: edgeQueries(db),
    now: Date.now(),
  };
}

function insertFile(files: ReturnType<typeof fileQueries>, path: string, now: number) {
  return files.insert({ path, hash: path, lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
}

function insertSymbol(syms: ReturnType<typeof symbolQueries>, fileId: number, name: string, now: number) {
  return syms.insert({ fileId, name, kind: "function", startLine: 1, endLine: 10, signature: `function ${name}()`, bodyHash: `${name}-${fileId}`, fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
}

function getClusterId(db: Database.Database, path: string): number | undefined {
  const row = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = (SELECT id FROM files WHERE path = ?)").get(path) as { cluster_id: number } | undefined;
  return row?.cluster_id;
}

describe("computeClusters — multi-edge-kind", () => {
  it("clusters files when >= 2 call edges cross files", () => {
    const { db, files, syms, edges, now } = setupDb();

    const f1 = insertFile(files, "src/a.ts", now);
    const f2 = insertFile(files, "src/b.ts", now);
    const s1 = insertSymbol(syms, f1, "fnA", now);
    const s2 = insertSymbol(syms, f2, "fnB", now);
    const s3 = insertSymbol(syms, f1, "fnA2", now);
    const s4 = insertSymbol(syms, f2, "fnB2", now);

    edges.insert({ sourceSymbolId: s1, targetSymbolId: s2, kind: "call", createdAt: now });
    edges.insert({ sourceSymbolId: s3, targetSymbolId: s4, kind: "call", createdAt: now });

    computeClusters(db);

    const c1 = getClusterId(db, "src/a.ts");
    const c2 = getClusterId(db, "src/b.ts");
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1).toBe(c2);
  });

  it("does not cluster files with only 1 call edge", () => {
    const { db, files, syms, edges, now } = setupDb();

    const f1 = insertFile(files, "src/a.ts", now);
    const f2 = insertFile(files, "src/b.ts", now);
    const s1 = insertSymbol(syms, f1, "fnA", now);
    const s2 = insertSymbol(syms, f2, "fnB", now);

    edges.insert({ sourceSymbolId: s1, targetSymbolId: s2, kind: "call", createdAt: now });

    computeClusters(db);

    const c1 = getClusterId(db, "src/a.ts");
    const c2 = getClusterId(db, "src/b.ts");
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1).not.toBe(c2);
  });

  it("clusters files when >= 3 type_usage edges cross files", () => {
    const { db, files, syms, edges, now } = setupDb();

    const f1 = insertFile(files, "src/a.ts", now);
    const f2 = insertFile(files, "src/b.ts", now);
    const symbols1 = [
      insertSymbol(syms, f1, "TA", now),
      insertSymbol(syms, f1, "TB", now),
      insertSymbol(syms, f1, "TC", now),
    ];
    const symbols2 = [
      insertSymbol(syms, f2, "UA", now),
      insertSymbol(syms, f2, "UB", now),
      insertSymbol(syms, f2, "UC", now),
    ];

    edges.insert({ sourceSymbolId: symbols2[0], targetSymbolId: symbols1[0], kind: "type_usage", createdAt: now });
    edges.insert({ sourceSymbolId: symbols2[1], targetSymbolId: symbols1[1], kind: "type_usage", createdAt: now });
    edges.insert({ sourceSymbolId: symbols2[2], targetSymbolId: symbols1[2], kind: "type_usage", createdAt: now });

    computeClusters(db);

    const c1 = getClusterId(db, "src/a.ts");
    const c2 = getClusterId(db, "src/b.ts");
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1).toBe(c2);
  });

  it("does not cluster files with only 2 type_usage edges", () => {
    const { db, files, syms, edges, now } = setupDb();

    const f1 = insertFile(files, "src/a.ts", now);
    const f2 = insertFile(files, "src/b.ts", now);
    const s1 = insertSymbol(syms, f1, "TA", now);
    const s2 = insertSymbol(syms, f1, "TB", now);
    const s3 = insertSymbol(syms, f2, "UA", now);
    const s4 = insertSymbol(syms, f2, "UB", now);

    edges.insert({ sourceSymbolId: s3, targetSymbolId: s1, kind: "type_usage", createdAt: now });
    edges.insert({ sourceSymbolId: s4, targetSymbolId: s2, kind: "type_usage", createdAt: now });

    computeClusters(db);

    const c1 = getClusterId(db, "src/a.ts");
    const c2 = getClusterId(db, "src/b.ts");
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1).not.toBe(c2);
  });

  it("clusters files with a single inheritance edge (threshold 1)", () => {
    const { db, files, syms, edges, now } = setupDb();

    const f1 = insertFile(files, "src/base.ts", now);
    const f2 = insertFile(files, "src/derived.ts", now);
    const s1 = insertSymbol(syms, f1, "Base", now);
    const s2 = insertSymbol(syms, f2, "Derived", now);

    edges.insert({ sourceSymbolId: s2, targetSymbolId: s1, kind: "inheritance", createdAt: now });

    computeClusters(db);

    const c1 = getClusterId(db, "src/base.ts");
    const c2 = getClusterId(db, "src/derived.ts");
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1).toBe(c2);
  });

  it("clusters files with a single implements edge (threshold 1)", () => {
    const { db, files, syms, edges, now } = setupDb();

    const f1 = insertFile(files, "src/iface.ts", now);
    const f2 = insertFile(files, "src/impl.ts", now);
    const s1 = insertSymbol(syms, f1, "IFace", now);
    const s2 = insertSymbol(syms, f2, "Impl", now);

    edges.insert({ sourceSymbolId: s2, targetSymbolId: s1, kind: "implements", createdAt: now });

    computeClusters(db);

    const c1 = getClusterId(db, "src/iface.ts");
    const c2 = getClusterId(db, "src/impl.ts");
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1).toBe(c2);
  });

  it("transitively clusters via mixed edge kinds (import + call)", () => {
    const { db, files, syms, edges, now } = setupDb();

    const fA = insertFile(files, "src/a.ts", now);
    const fB = insertFile(files, "src/b.ts", now);
    const fC = insertFile(files, "src/c.ts", now);

    const sA = insertSymbol(syms, fA, "A", now);
    const sB = insertSymbol(syms, fB, "B", now);
    const sC1 = insertSymbol(syms, fC, "C1", now);
    const sC2 = insertSymbol(syms, fC, "C2", now);
    const sB2 = insertSymbol(syms, fB, "B2", now);

    edges.insert({ sourceSymbolId: sA, targetSymbolId: sB, kind: "import", createdAt: now });

    edges.insert({ sourceSymbolId: sB, targetSymbolId: sC1, kind: "call", createdAt: now });
    edges.insert({ sourceSymbolId: sB2, targetSymbolId: sC2, kind: "call", createdAt: now });

    computeClusters(db);

    const cA = getClusterId(db, "src/a.ts");
    const cB = getClusterId(db, "src/b.ts");
    const cC = getClusterId(db, "src/c.ts");
    expect(cA).toBeDefined();
    expect(cB).toBeDefined();
    expect(cC).toBeDefined();
    expect(cA).toBe(cB);
    expect(cB).toBe(cC);
  });

  it("import-only backward compatibility: 3 connected files share a cluster, isolated file does not", () => {
    const { db, files, syms, edges, now } = setupDb();

    const f1 = insertFile(files, "src/capsule/gen.ts", now);
    const f2 = insertFile(files, "src/capsule/score.ts", now);
    const f3 = insertFile(files, "src/capsule/pack.ts", now);
    const f4 = insertFile(files, "src/utils/hash.ts", now);

    const s1 = insertSymbol(syms, f1, "generate", now);
    const s2 = insertSymbol(syms, f2, "score", now);
    const s3 = insertSymbol(syms, f3, "pack", now);
    insertSymbol(syms, f4, "hash", now);

    edges.insert({ sourceSymbolId: s1, targetSymbolId: s2, kind: "import", createdAt: now });
    edges.insert({ sourceSymbolId: s2, targetSymbolId: s1, kind: "import", createdAt: now });
    edges.insert({ sourceSymbolId: s2, targetSymbolId: s3, kind: "import", createdAt: now });

    computeClusters(db);

    const c1 = getClusterId(db, "src/capsule/gen.ts");
    const c2 = getClusterId(db, "src/capsule/score.ts");
    const c3 = getClusterId(db, "src/capsule/pack.ts");
    const c4 = getClusterId(db, "src/utils/hash.ts");

    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c3).toBeDefined();
    expect(c4).toBeDefined();
    expect(c1).toBe(c2);
    expect(c1).toBe(c3);
    expect(c1).not.toBe(c4);

    const clusterFiles = getClusterFileIds(db, c1!);
    expect(clusterFiles.length).toBeGreaterThanOrEqual(3);
  });
});
