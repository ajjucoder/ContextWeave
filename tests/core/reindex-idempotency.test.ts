import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeFixtureProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-reindex-idempotency-"));
  tempRoots.push(root);

  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "math.ts"),
    [
      "export function double(value: number): number {",
      "  return value * 2;",
      "}",
      "",
      "export const offset = 1;",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(root, "src", "main.ts"),
    [
      "import { double, offset } from './math';",
      "",
      "export function run(input: number): number {",
      "  return double(input) + offset;",
      "}",
      "",
    ].join("\n")
  );

  return root;
}

describe("reindex idempotency", () => {
  it("keeps symbol counts stable and does not duplicate symbol ids when indexing twice", async () => {
    const root = makeFixtureProject();
    const db = new Database(":memory:");
    runMigrations(db);

    try {
      await indexProject(db, root);
      const symbols = symbolQueries(db);
      const firstSymbolCount = symbols.count();

      await indexProject(db, root);
      const secondSymbolIds = symbols.getAllIds();
      const secondSymbolCount = symbols.count();

      expect(firstSymbolCount).toBeGreaterThan(0);
      expect(secondSymbolCount).toBe(firstSymbolCount);
      expect(new Set(secondSymbolIds).size).toBe(secondSymbolIds.length);
    } finally {
      db.close();
    }
  });
});
