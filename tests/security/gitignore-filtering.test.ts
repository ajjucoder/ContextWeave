import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createSchema } from "../../src/db/schema.js";
import { indexProject, indexSingleFile, isPathWithinRoot } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";

let db: Database.Database;
const TEMP_DIR = resolve(__dirname, "../tmp-gitignore-test");

beforeAll(async () => {
  mkdirSync(resolve(TEMP_DIR, "src"), { recursive: true });
  mkdirSync(resolve(TEMP_DIR, "secrets"), { recursive: true });

  writeFileSync(resolve(TEMP_DIR, "src/app.ts"), "export const app = true;");
  writeFileSync(resolve(TEMP_DIR, ".env"), "SECRET_KEY=abc123");
  writeFileSync(resolve(TEMP_DIR, ".env.local"), "LOCAL_SECRET=xyz");
  writeFileSync(resolve(TEMP_DIR, ".env.production"), "PROD_KEY=secret");
  writeFileSync(resolve(TEMP_DIR, "secrets/api.ts"), "export const key = 'hidden';");

  writeFileSync(
    resolve(TEMP_DIR, ".gitignore"),
    "secrets/\n*.log\nbuild/\n"
  );

  mkdirSync(resolve(TEMP_DIR, "vendor"), { recursive: true });
  writeFileSync(resolve(TEMP_DIR, "vendor/lib.ts"), "export const vendor = true;");
  mkdirSync(resolve(TEMP_DIR, "templates"), { recursive: true });
  writeFileSync(resolve(TEMP_DIR, "templates/base.ts"), "export const tmpl = true;");

  writeFileSync(
    resolve(TEMP_DIR, ".cwignore"),
    "vendor/\ntemplates/\n"
  );

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterAll(() => {
  db.close();
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("gitignore and .env filtering", () => {
  it("excludes .env files from indexing", async () => {
    await indexProject(db, TEMP_DIR);
    const files = fileQueries(db);
    const allFiles = files.getAll();
    const paths = allFiles.map((f) => f.path);

    expect(paths.some((p) => p.includes(".env"))).toBe(false);
    expect(paths.some((p) => p.includes("app.ts"))).toBe(true);
  });

  it("excludes gitignored directories from indexing", async () => {
    const files = fileQueries(db);
    const allFiles = files.getAll();
    const paths = allFiles.map((f) => f.path);

    expect(paths.some((p) => p.includes("secrets/"))).toBe(false);
  });

  it("rejects .env files via indexSingleFile", () => {
    const result = indexSingleFile(db, resolve(TEMP_DIR, ".env"), TEMP_DIR);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("security exclusion");
  });
});

describe(".cwignore filtering", () => {
  it("excludes .cwignore patterns from indexing", async () => {
    const files = fileQueries(db);
    const allFiles = files.getAll();
    const paths = allFiles.map((f) => f.path);

    expect(paths.some((p) => p.includes("vendor/"))).toBe(false);
    expect(paths.some((p) => p.includes("templates/"))).toBe(false);
    expect(paths.some((p) => p.includes("app.ts"))).toBe(true);
  });
});
