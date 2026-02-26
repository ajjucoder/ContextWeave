import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";

describe("indexProject pruning", () => {
  it("removes files from the DB when they no longer exist on disk", async () => {
    const dir = join(tmpdir(), `cw-prune-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "pruned.ts");
    writeFileSync(filePath, "export const value = 1;");

    const db = new Database(":memory:");
    runMigrations(db);

    await indexProject(db, dir);
    expect(fileQueries(db).count()).toBe(1);

    unlinkSync(filePath);
    await indexProject(db, dir);

    expect(fileQueries(db).count()).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
