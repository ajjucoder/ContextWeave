import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";

describe("parallel indexProject", () => {
  it("indexes multiple files with worker-thread parsing", async () => {
    const dir = join(tmpdir(), `cw-par-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `file${i}.ts`), `export function fn${i}() { return ${i}; }`);
    }

    const db = new Database(":memory:");
    runMigrations(db);

    const result = await indexProject(db, dir);
    expect(result.filesIndexed).toBe(5);
    expect(result.symbolsFound).toBeGreaterThanOrEqual(5);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
