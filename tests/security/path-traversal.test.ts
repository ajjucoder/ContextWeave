import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createSchema } from "../../src/db/schema.js";
import { indexSingleFile, isPathWithinRoot } from "../../src/core/indexer.js";

let db: Database.Database;
const FIXTURE_DIR = resolve(__dirname, "../fixtures");
const TEMP_DIR = resolve(__dirname, "../tmp-path-traversal");

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  mkdirSync(TEMP_DIR, { recursive: true });
  writeFileSync(resolve(TEMP_DIR, "legit.ts"), "export const x = 1;");
});

afterAll(() => {
  db.close();
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("isPathWithinRoot", () => {
  it("accepts paths within the project root", () => {
    expect(isPathWithinRoot("/project/src/file.ts", "/project")).toBe(true);
    expect(isPathWithinRoot("/project/a/b/c.ts", "/project")).toBe(true);
  });

  it("rejects paths outside the project root", () => {
    expect(isPathWithinRoot("/etc/passwd", "/project")).toBe(false);
    expect(isPathWithinRoot("/home/user/.ssh/id_rsa", "/project")).toBe(false);
  });

  it("rejects path traversal via ../ sequences", () => {
    expect(isPathWithinRoot("/project/../etc/passwd", "/project")).toBe(false);
    expect(isPathWithinRoot("/project/src/../../etc/passwd", "/project")).toBe(false);
  });

  it("handles root path exactly equal to project root", () => {
    expect(isPathWithinRoot("/project", "/project")).toBe(true);
  });
});

describe("indexSingleFile path validation", () => {
  it("rejects files outside the project root", () => {
    const result = indexSingleFile(db, "/etc/passwd", TEMP_DIR);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("outside project root");
    expect(result.symbolCount).toBe(0);
  });

  it("rejects path traversal attempts", () => {
    const result = indexSingleFile(db, resolve(TEMP_DIR, "../../etc/passwd"), TEMP_DIR);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("outside project root");
  });

  it("accepts files within the project root", () => {
    const result = indexSingleFile(db, resolve(TEMP_DIR, "legit.ts"), TEMP_DIR);
    expect(result.errors.length).toBe(0);
    expect(result.symbolCount).toBeGreaterThanOrEqual(0);
  });
});
