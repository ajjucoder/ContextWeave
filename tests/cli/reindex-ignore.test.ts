import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";

vi.mock("../../src/core/graph.js", () => ({
  runPageRankInBackground: vi.fn(),
}));

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("CLI reindex passes config.ignore to targeted reindex", () => {
  it("targeted directory reindex excludes files matching config.ignore patterns", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-reindex-ignore-"));
    tempRoots.push(root);

    mkdirSync(join(root, ".contextweave"), { recursive: true });
    mkdirSync(join(root, "src", "generated-code"), { recursive: true });
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    writeFileSync(join(root, "src", "lib", "main.ts"), "export const main = 1;\n");
    writeFileSync(join(root, "src", "generated-code", "output.ts"), "export const gen = 1;\n");

    writeFileSync(
      join(root, ".contextweave", "config.json"),
      JSON.stringify({
        version: 1,
        ignore: ["generated-code"],
        tokenBudget: 4000,
        defaultMode: "feature",
        stalenessDepth: 2,
        confidenceDecay: 0.1,
        gcThreshold: 0.1,
      })
    );

    const { runReindex } = await import("../../src/cli/commands/reindex.js");
    await runReindex(root, "src");

    const dbPath = resolve(root, ".contextweave", "contextweave.db");
    const db = new Database(dbPath);
    const files = fileQueries(db).getAll();

    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.includes("main.ts"))).toBe(true);
    expect(paths.some((p) => p.includes("generated-code"))).toBe(false);

    db.close();
  });
});
