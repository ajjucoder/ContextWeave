import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("discoverFiles symlink handling", () => {
  it("does not recurse into symlink loops", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-symlink-loop-"));
    tempRoots.push(root);

    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "export const main = 1;\n");

    mkdirSync(join(root, "nested"), { recursive: true });
    symlinkSync(root, join(root, "nested", "loop-back"), "dir");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);

    const result = await indexProject(db, root);
    const indexedFiles = fileQueries(db).getAll();

    expect(result.errors.some((error) => error.includes("loop-back"))).toBe(false);
    expect(indexedFiles.some((file) => file.path.endsWith("src/main.ts"))).toBe(true);

    db.close();
  });
});
