import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { edgeQueries } from "../../src/db/queries/edges.js";

describe("query statement caching", () => {
  it("symbolQueries returns same object for same db", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const a = symbolQueries(db);
    const b = symbolQueries(db);
    expect(a).toBe(b);
    db.close();
  });

  it("fileQueries returns same object for same db", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const a = fileQueries(db);
    const b = fileQueries(db);
    expect(a).toBe(b);
    db.close();
  });

  it("edgeQueries returns same object for same db", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const a = edgeQueries(db);
    const b = edgeQueries(db);
    expect(a).toBe(b);
    db.close();
  });

  it("symbolQueries returns different objects for different db instances", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    runMigrations(db1);
    runMigrations(db2);
    const a = symbolQueries(db1);
    const b = symbolQueries(db2);
    expect(a).not.toBe(b);
    db1.close();
    db2.close();
  });

  it("getConnectedSymbols reuses the prepared statement per database", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const now = Date.now();
    const sourceFileId = files.insert({
      path: "src/source.ts",
      hash: "source",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    const targetFileId = files.insert({
      path: "src/target.ts",
      hash: "target",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    const sourceId = symbols.insert({
      fileId: sourceFileId,
      name: "sourceFn",
      kind: "function",
      startLine: 1,
      endLine: 2,
      signature: "function sourceFn()",
      bodyHash: "source-body",
      fullSource: "function sourceFn() {}",
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
      parentSymbolId: null,
      qualifiedName: null,
    });
    const targetId = symbols.insert({
      fileId: targetFileId,
      name: "targetFn",
      kind: "function",
      startLine: 1,
      endLine: 2,
      signature: "function targetFn()",
      bodyHash: "target-body",
      fullSource: "function targetFn() {}",
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
      parentSymbolId: null,
      qualifiedName: null,
    });
    edges.insert({ sourceSymbolId: sourceId, targetSymbolId: targetId, kind: "call", createdAt: now });

    const edgeModule = await import("../../src/db/queries/edges.js") as Record<string, unknown>;
    expect(typeof edgeModule.getConnectedSymbols).toBe("function");

    const getConnectedSymbols = edgeModule.getConnectedSymbols as (
      db: Database.Database,
      symbolId: number
    ) => Array<{ symbolId: number; fileId: number }>;
    const prepareSpy = vi.spyOn(db, "prepare");

    expect(getConnectedSymbols(db, sourceId)).toEqual([{ symbolId: targetId, fileId: targetFileId }]);
    expect(getConnectedSymbols(db, sourceId)).toEqual([{ symbolId: targetId, fileId: targetFileId }]);
    expect(prepareSpy).toHaveBeenCalledTimes(1);

    db.close();
  });
});
