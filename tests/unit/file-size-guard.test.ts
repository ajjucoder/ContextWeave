import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createSchema } from "../../src/db/schema.js";
import { indexProject, indexSingleFile } from "../../src/core/indexer.js";

let db: Database.Database;
const TEMP_DIR = resolve(__dirname, "../tmp-file-size-test");

beforeAll(() => {
  mkdirSync(TEMP_DIR, { recursive: true });

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterAll(() => {
  db.close();
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("file size guard", () => {
  it("rejects files larger than 5MB", () => {
    const largePath = resolve(TEMP_DIR, "huge.ts");
    const content = "export const x = " + "'a'.repeat(100);\n".repeat(500000);
    writeFileSync(largePath, content);

    const result = indexSingleFile(db, largePath, TEMP_DIR);

    if (content.length > 5 * 1024 * 1024) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("byte limit");
    }
  });

  it("accepts files within the size limit", () => {
    const normalPath = resolve(TEMP_DIR, "normal.ts");
    writeFileSync(normalPath, "export const hello = 'world';");

    const result = indexSingleFile(db, normalPath, TEMP_DIR);
    expect(result.errors.length).toBe(0);
  });

  it("reports oversized files when indexing through the parallel project path", async () => {
    const largePath = resolve(TEMP_DIR, "huge-project-file.ts");
    const content = "export const x = " + "'a'.repeat(100);\n".repeat(500000);
    writeFileSync(largePath, content);

    const result = await indexProject(db, TEMP_DIR);
    expect(result.errors.some((err) => err.includes("byte limit") && err.includes("huge-project-file.ts"))).toBe(true);
  });
});
