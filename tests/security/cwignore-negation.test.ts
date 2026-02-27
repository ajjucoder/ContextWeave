import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";

const TEMP_DIR = resolve(__dirname, "../tmp-cwignore-negation");
let db: Database.Database;

beforeAll(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
  mkdirSync(resolve(TEMP_DIR, "src", "generated"), { recursive: true });
  mkdirSync(resolve(TEMP_DIR, "src", "features"), { recursive: true });

  writeFileSync(resolve(TEMP_DIR, "src", "generated", "drop.ts"), "export const drop = true;\n");
  writeFileSync(resolve(TEMP_DIR, "src", "generated", "keep.ts"), "export const keep = true;\n");
  writeFileSync(resolve(TEMP_DIR, "src", "features", "main.ts"), "export const main = true;\n");

  writeFileSync(
    resolve(TEMP_DIR, ".cwignore"),
    [
      "src/generated/",
      "!src/generated/keep.ts",
      "",
    ].join("\n")
  );

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterAll(() => {
  db.close();
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe(".cwignore negation", () => {
  it("re-includes files matched by negated patterns", async () => {
    await indexProject(db, TEMP_DIR);
    const paths = fileQueries(db).getAll().map((file) => file.path);

    expect(paths.some((path) => path.endsWith("src/generated/drop.ts"))).toBe(false);
    expect(paths.some((path) => path.endsWith("src/generated/keep.ts"))).toBe(true);
    expect(paths.some((path) => path.endsWith("src/features/main.ts"))).toBe(true);
  });
});
