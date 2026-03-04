import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { generateCapsule } from "../../src/capsule/generator.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-pathfilter-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  return root;
}

describe("capsule path/glob filtering", () => {
  it("glob filter restricts files to matching pattern", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "main.ts"),
      `export function mainFunc() { return 1; }`
    );
    writeFileSync(
      join(root, "lib", "helper.py"),
      `def helper_func():\n    return 2\n`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    // Without filter: both files should be candidates
    const result = generateCapsule(db, {
      query: "main helper function",
      tokenBudget: 2000,
      projectRoot: root,
      glob: "**/*.ts",
    });

    // Only .ts files should appear in the capsule content
    expect(result.content).not.toContain("helper_func");
    expect(result.content).toContain("mainFunc");

    db.close();
  });

  it("path filter restricts to files within given directory", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "main.ts"),
      `export function srcFunc() { return 1; }`
    );
    writeFileSync(
      join(root, "lib", "util.ts"),
      `export function libFunc() { return 2; }`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    // With path filter, lib/util.ts should be excluded even when both names are queried
    const result = generateCapsule(db, {
      query: "srcFunc libFunc",
      tokenBudget: 2000,
      projectRoot: root,
      path: "src",
    });

    // lib/util.ts should not appear as a file path in the rendered content
    expect(result.content).not.toContain("lib/util.ts");
    // src/main.ts should be included
    expect(result.metadata.fileCount).toBeGreaterThan(0);

    db.close();
  });
});
