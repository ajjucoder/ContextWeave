import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { SessionContext } from "../../src/capsule/session-context.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { sessionQueries } from "../../src/db/queries/sessions.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

describe("SessionContext", () => {
  it("records symbols and retrieves recent file IDs", () => {
    const files = fileQueries(db);
    const syms = symbolQueries(db);
    const now = Date.now();

    const fileId = files.insert({ path: "src/core/graph.ts", hash: "a", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
    const symId = syms.insert({ fileId, name: "bfsTraversal", kind: "function", startLine: 1, endLine: 10, signature: "function bfsTraversal()", bodyHash: "x", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });

    sessionQueries(db).ensureSession("test-session-1", "/tmp/test");
    const ctx = new SessionContext(db, "test-session-1");
    ctx.record([{ symbolId: symId, fileId }], "bfs traversal");

    const recentFiles = ctx.getRecentFileIds();
    expect(recentFiles).toContain(fileId);
  });

  it("retrieves recent queries", () => {
    sessionQueries(db).ensureSession("test-session-2", "/tmp/test");
    const ctx = new SessionContext(db, "test-session-2");
    ctx.record([], "first query");
    ctx.record([], "second query");

    const queries = ctx.getRecentQueries();
    expect(queries).toContain("first query");
    expect(queries).toContain("second query");
  });

  it("getRecentSymbolIds returns recorded symbol IDs", () => {
    const files = fileQueries(db);
    const syms = symbolQueries(db);
    const now = Date.now();

    const fileId = files.insert({ path: "src/core/test.ts", hash: "b", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
    const symId = syms.insert({ fileId, name: "testFn", kind: "function", startLine: 1, endLine: 5, signature: "function testFn()", bodyHash: "y", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });

    sessionQueries(db).ensureSession("test-session-3", "/tmp/test");
    const ctx = new SessionContext(db, "test-session-3");
    ctx.record([{ symbolId: symId, fileId }], "test fn");

    const recentSymbols = ctx.getRecentSymbolIds();
    expect(recentSymbols).toContain(symId);
  });

  it("isolates sessions — session A context not visible to session B", () => {
    const files = fileQueries(db);
    const syms = symbolQueries(db);
    const now = Date.now();

    const fileId = files.insert({ path: "src/isolated.ts", hash: "c", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
    const symId = syms.insert({ fileId, name: "isolatedFn", kind: "function", startLine: 1, endLine: 5, signature: "function isolatedFn()", bodyHash: "z", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });

    sessionQueries(db).ensureSession("session-a", "/tmp/test");
    const ctxA = new SessionContext(db, "session-a");
    ctxA.record([{ symbolId: symId, fileId }], "isolated fn");

    sessionQueries(db).ensureSession("session-b", "/tmp/test");
    const ctxB = new SessionContext(db, "session-b");
    expect(ctxB.getRecentSymbolIds()).not.toContain(symId);
    expect(ctxB.getRecentFileIds()).not.toContain(fileId);
  });
});
