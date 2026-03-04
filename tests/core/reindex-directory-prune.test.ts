import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexDirectory, indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("indexDirectory pruning", () => {
  it("prunes previously-indexed files in the directory that now match exclusion patterns", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-dir-prune-"));
    tempRoots.push(root);

    mkdirSync(join(root, "src", "generated"), { recursive: true });
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    writeFileSync(join(root, "src", "lib", "main.ts"), "export const main = 1;\n");
    writeFileSync(join(root, "src", "generated", "output.ts"), "export const gen = 1;\n");

    const db = new Database(":memory:");
    runMigrations(db);

    await indexProject(db, root);
    const allBefore = fileQueries(db).getAll().map((f) => f.path);
    expect(allBefore.some((p) => p.includes("generated/output.ts"))).toBe(true);
    expect(allBefore.some((p) => p.includes("lib/main.ts"))).toBe(true);

    await indexDirectory(db, resolve(root, "src"), root, ["generated"]);
    const allAfter = fileQueries(db).getAll().map((f) => f.path);
    expect(allAfter.some((p) => p.includes("generated/output.ts"))).toBe(false);
    expect(allAfter.some((p) => p.includes("lib/main.ts"))).toBe(true);

    db.close();
  });

  it("prunes files excluded by .cwignore on targeted directory reindex", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-dir-prune-cwignore-"));
    tempRoots.push(root);

    mkdirSync(join(root, "src", "auto"), { recursive: true });
    mkdirSync(join(root, "src", "core"), { recursive: true });
    writeFileSync(join(root, "src", "core", "app.ts"), "export const app = 1;\n");
    writeFileSync(join(root, "src", "auto", "gen.ts"), "export const gen = 1;\n");

    const db = new Database(":memory:");
    runMigrations(db);

    await indexProject(db, root);
    expect(fileQueries(db).getAll().some((f) => f.path.includes("auto/gen.ts"))).toBe(true);

    writeFileSync(join(root, ".cwignore"), "src/auto/\n");
    await indexDirectory(db, resolve(root, "src"), root);
    const allAfter = fileQueries(db).getAll();
    expect(allAfter.some((f) => f.path.includes("auto/gen.ts"))).toBe(false);
    expect(allAfter.some((f) => f.path.includes("core/app.ts"))).toBe(true);

    db.close();
  });
});
