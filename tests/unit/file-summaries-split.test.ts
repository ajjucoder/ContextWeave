import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { upsertFileSummary, searchFilesByQuery } from "../../src/core/file-summaries.js";

let db: Database.Database;
let fileId: number;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  const now = Date.now();

  const files = fileQueries(db);
  const syms = symbolQueries(db);

  fileId = files.insert({
    path: "src/users/userService.ts",
    hash: "abc",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 2,
    error: null,
  });

  syms.insert({
    fileId,
    name: "getUserById",
    kind: "function",
    startLine: 1,
    endLine: 20,
    signature: "function getUserById(id: string)",
    bodyHash: "b1",
    fullSource: "",
    isExported: true,
    docComment: null,
    centrality: 5,
    lastSeen: now,
  });

  syms.insert({
    fileId,
    name: "createUserProfile",
    kind: "function",
    startLine: 21,
    endLine: 50,
    signature: "function createUserProfile(data: unknown)",
    bodyHash: "b2",
    fullSource: "",
    isExported: true,
    docComment: null,
    centrality: 4,
    lastSeen: now,
  });

  upsertFileSummary(db, fileId);
});

describe("file summaries camelCase splitting", () => {
  it("finds file by sub-token 'user'", () => {
    const results = searchFilesByQuery(db, "user", 10);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("src/users/userService.ts");
  });

  it("finds file by sub-token 'profile'", () => {
    const results = searchFilesByQuery(db, "profile", 10);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("src/users/userService.ts");
  });

  it("summary text contains original names and split tokens", () => {
    const row = db
      .prepare("SELECT summary_text FROM file_summaries WHERE file_id = ?")
      .get(fileId) as { summary_text: string } | undefined;
    expect(row).toBeDefined();
    const text = row!.summary_text;
    expect(text).toContain("getuserbyid");
    expect(text).toContain("user");
    expect(text).toContain("profile");
    expect(text).toContain("createuserprofile");
  });
});
