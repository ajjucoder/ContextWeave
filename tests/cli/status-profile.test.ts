import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, getDb } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { loadConfig } from "../../src/utils/config.js";

vi.mock("../../src/core/graph.js", () => ({
  runPageRankInBackground: vi.fn(),
}));

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

async function captureStdout<T>(fn: () => T | Promise<T>): Promise<{ result: T; output: string }> {
  let output = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  try {
    const result = await fn();
    return { result, output };
  } finally {
    spy.mockRestore();
  }
}

describe("status/init project profile", () => {
  it("cw status surfaces active roots, excluded roots, and suspicious directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-status-profile-"));
    tempRoots.push(root);

    mkdirSync(join(root, ".contextweave"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "vendor"), { recursive: true });
    mkdirSync(join(root, ".venv"), { recursive: true });
    mkdirSync(join(root, "demo"), { recursive: true });

    writeFileSync(join(root, "src", "main.ts"), "export const main = 1;\n");
    writeFileSync(join(root, "scripts", "job.py"), "def main():\n    return 1\n");
    writeFileSync(join(root, "vendor", "ignored.ts"), "export const vendor = 1;\n");
    writeFileSync(join(root, ".venv", "ignored.py"), "def ignored():\n    return 1\n");
    writeFileSync(join(root, "demo", "sample.ts"), "export const demo = 1;\n");
    writeFileSync(join(root, ".cwignore"), ".venv/\n");
    writeFileSync(
      join(root, ".contextweave", "config.json"),
      JSON.stringify({
        version: 1,
        ignore: ["vendor"],
        tokenBudget: 4000,
        defaultMode: "feature",
        stalenessDepth: 2,
        confidenceDecay: 0.1,
        gcThreshold: 0.1,
      })
    );

    const dbPath = resolve(root, ".contextweave", "contextweave.db");
    const db = getDb(dbPath);
    runMigrations(db);
    await indexProject(db, root, loadConfig(root).ignore);
    closeDb(dbPath);

    const { runStatus } = await import("../../src/cli/commands/status.js");
    const { output } = await captureStdout(() => runStatus(root, false));

    expect(output).toContain("First-pass rate:");
    expect(output).toContain("Correction rate:");
    expect(output).toContain("Project Profile");
    expect(output).toContain("Active roots:");
    expect(output).toContain("scripts");
    expect(output).toContain("src");
    expect(output).toContain("Excluded roots:");
    expect(output).toContain("vendor [config]");
    expect(output).toContain(".venv [.cwignore]");
    expect(output).toContain("Suspicious dirs:");
    expect(output).toContain("vendor (excluded)");
    expect(output).toContain("demo (present)");
    expect(output).toContain("Ignore defaults: Python defaults exclude __pycache__, venv/.venv, and .tox.");
  });

  it("cw init prints mixed-repo ignore defaults and project profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-init-profile-"));
    tempRoots.push(root);

    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "export const main = 1;\n");
    writeFileSync(join(root, "scripts", "job.py"), "def main():\n    return 1\n");

    const { runInit } = await import("../../src/cli/commands/init.js");
    const { output } = await captureStdout(() => runInit(root));

    expect(output).toContain("Project Profile");
    expect(output).toContain("Languages:");
    expect(output).toContain("Active roots:");
    expect(output).toContain("scripts");
    expect(output).toContain("src");
    expect(output).toContain("Ignore defaults: JS/TS defaults exclude node_modules, dist, build, .next, and coverage.");
    expect(output).toContain("Ignore defaults: Python defaults exclude __pycache__, venv/.venv, and .tox.");
    expect(output).toContain("Ignore defaults: Mixed repos merge config.ignore, config.exclude, config.excludePatterns, .gitignore, and .cwignore.");
  });
});
