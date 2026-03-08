import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexSingleFile } from "../../src/core/indexer.js";

describe("incremental indexing", () => {
  it("skips file read when mtime is unchanged", async () => {
    const dir = join(tmpdir(), `cw-inc-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "test.ts");
    writeFileSync(filePath, "export function foo() { return 1; }");

    const db = new Database(":memory:");
    runMigrations(db);

    const first = await indexSingleFile(db, filePath, dir);
    expect(first.symbolCount).toBeGreaterThan(0);

    // If indexSingleFile still reads content here, this will fail with EACCES.
    chmodSync(filePath, 0o000);
    try {
      const second = await indexSingleFile(db, filePath, dir);
      expect(second.diff).toBeNull();
      expect(second.errors).toHaveLength(0);
    } finally {
      chmodSync(filePath, 0o644);
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
