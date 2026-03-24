import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { sessionQueries } from "../../src/db/queries/sessions.js";
import { validateRow } from "../../src/db/queries/row-validator.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterEach(() => {
  db.close();
});

describe("validateRow", () => {
  it("returns a typed row when all validators pass", () => {
    const row = validateRow(
      { id: 1, name: "UserService", archived: 0 },
      {
        id: (value): value is number => typeof value === "number",
        name: (value): value is string => typeof value === "string",
        archived: (value): value is number => value === 0 || value === 1,
      }
    );

    expect(row).toEqual({ id: 1, name: "UserService", archived: 0 });
  });

  it("returns undefined when a validator fails", () => {
    const row = validateRow(
      { id: "1", name: "UserService" },
      {
        id: (value): value is number => typeof value === "number",
        name: (value): value is string => typeof value === "string",
      }
    );

    expect(row).toBeUndefined();
  });
});

describe("row validation integration", () => {
  it("filters malformed symbol rows from hot-path lookups", () => {
    const files = fileQueries(db);
    const fileId = files.insert({
      path: "/test.ts",
      hash: "h1",
      lastIndexed: Date.now(),
      mtime: 0,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });

    const symbols = symbolQueries(db);
    const symbolId = symbols.insert({
      fileId,
      name: "testFn",
      kind: "function",
      startLine: 1,
      endLine: 3,
      signature: "function testFn()",
      bodyHash: "bh1",
      fullSource: "function testFn() {}",
      isExported: true,
      docComment: null,
      centrality: 0.5,
      lastSeen: Date.now(),
    });

    db.prepare("UPDATE symbols SET centrality = ? WHERE id = ?").run("invalid", symbolId);

    expect(symbols.getById(symbolId)).toBeUndefined();
    expect(symbols.getByName("testFn")).toEqual([]);
    expect(symbols.searchFTS("testFn", 5)).toEqual([]);
  });

  it("filters malformed observation rows from hot-path observation queries", () => {
    const sessionId = "session-1";
    sessionQueries(db).ensureSession(sessionId, "/project");

    const createdId = observationQueries(db).insert({
      sessionId,
      agentId: "claude-code",
      symbolId: null,
      fileId: null,
      scope: "architecture",
      note: "Important note",
      confidence: 0.8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
      staleReason: null,
      archived: false,
    });

    db.prepare("UPDATE observations SET stale = ? WHERE id = ?").run("invalid", createdId);

    expect(observationQueries(db).getById(createdId)).toBeUndefined();
    expect(observationQueries(db).getActive()).toEqual([]);
  });
});
