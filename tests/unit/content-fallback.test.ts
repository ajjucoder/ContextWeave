import { describe, it, expect, beforeAll, afterAll } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { contentFallbackSearch, shouldSkipContentFallback } from "../../src/capsule/content-fallback.js";

describe("content fallback search", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new DatabaseConstructor(":memory:");
    runMigrations(db);

    db.prepare("INSERT INTO files (path, basename, hash, last_indexed, mtime, language) VALUES (?, ?, ?, ?, ?, ?)").run(
      "src/service.ts", "service.ts", "h1", Date.now(), Date.now(), "typescript"
    );
    const fileId = (db.prepare("SELECT id FROM files WHERE path = 'src/service.ts'").get() as any).id;

    const now = Date.now();
    db.prepare("INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, full_source, is_exported, body_hash, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      fileId, "handleRequest", "function", 1, 20, "handleRequest(req: Request)",
      "function handleRequest(req) {\n  // retry with exponential backoff\n  for (let attempt = 0; attempt < 3; attempt++) {\n    try { return await fetch(req); } catch (e) { await sleep(attempt * 1000); }\n  }\n}",
      1, "hash1", now
    );

    db.prepare("INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, full_source, is_exported, body_hash, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      fileId, "notifyUser", "function", 25, 35, "notifyUser(userId: string)",
      "function notifyUser(userId) {\n  const email = getEmail(userId);\n  sendEmail(email, 'notification');\n}",
      1, "hash2", now
    );
  });

  afterAll(() => db.close());

  it("finds symbols by body content when name doesn't match", () => {
    const results = contentFallbackSearch(db, ["retry", "backoff"]);
    expect(results.length).toBeGreaterThan(0);
    const names = results.map((r) => {
      const sym = db.prepare("SELECT name FROM symbols WHERE id = ?").get(r.symbolId) as any;
      return sym.name;
    });
    expect(names).toContain("handleRequest");
  });

  it("finds symbols containing email-related content", () => {
    const results = contentFallbackSearch(db, ["email", "notification"]);
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty for non-matching terms", () => {
    const results = contentFallbackSearch(db, ["xyznonexistent"]);
    expect(results).toEqual([]);
  });

  it("returns empty for empty terms", () => {
    const results = contentFallbackSearch(db, []);
    expect(results).toEqual([]);
  });

  it("skips fallback for narrow exact-match capsules with one or two pivots", () => {
    expect(shouldSkipContentFallback({ pivotCount: 1, hasExactNameMatch: true })).toBe(true);
    expect(shouldSkipContentFallback({ pivotCount: 2, hasExactNameMatch: true })).toBe(true);
  });

  it("does not skip fallback when there is no exact symbol match or the pivot set is larger", () => {
    expect(shouldSkipContentFallback({ pivotCount: 2, hasExactNameMatch: false })).toBe(false);
    expect(shouldSkipContentFallback({ pivotCount: 3, hasExactNameMatch: true })).toBe(false);
  });

  it("respects maxFiles limit", () => {
    const results = contentFallbackSearch(db, ["function"], 1);
    const uniqueFiles = new Set(results.map((r) => r.fileId));
    expect(uniqueFiles.size).toBeLessThanOrEqual(1);
  });
});
