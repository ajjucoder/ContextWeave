import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "cw-pollution-"));
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("Index pollution auto-exclusion", () => {
  it("excludes .claude directory from indexing", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, ".claude"), { recursive: true });

      writeFileSync(join(root, "src", "main.ts"), `export function main() {}\n`);
      writeFileSync(join(root, ".claude", "settings.ts"), `export const setting = "value";\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.startsWith(".claude/"))).toBe(false);
      expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes .qa-temp-* directories from indexing", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, ".qa-temp-probes"), { recursive: true });
      mkdirSync(join(root, ".qa-temp-manual"), { recursive: true });

      writeFileSync(join(root, "src", "main.ts"), `export function main() {}\n`);
      writeFileSync(join(root, ".qa-temp-probes", "probe.ts"), `export function probe() {}\n`);
      writeFileSync(join(root, ".qa-temp-manual", "check.ts"), `export function check() {}\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.startsWith(".qa-temp-"))).toBe(false);
      expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not exclude normal source paths", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "lib"), { recursive: true });

      writeFileSync(join(root, "src", "core.ts"), `export function core() {}\n`);
      writeFileSync(join(root, "lib", "utils.ts"), `export function utils() {}\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
      expect(paths.some((p) => p.startsWith("lib/"))).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes project roots that happen to live under a .worktrees ancestor", async () => {
    const parent = makeRoot();
    const root = join(parent, ".worktrees", "feature-root");
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "main.ts"), `export function main() {}\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths).toContain("src/main.ts");
    } finally {
      db.close();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("excludes git worktree directories (directories with .git file containing gitdir:)", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "worktrees", "feature"), { recursive: true });

      writeFileSync(join(root, "src", "main.ts"), `export function main() {}\n`);
      writeFileSync(join(root, "worktrees", "feature", "worktree.ts"), `export function worktree() {}\n`);
      writeFileSync(join(root, "worktrees", "feature", ".git"), `gitdir: /path/to/.git/worktrees/feature\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.includes("worktrees/feature/"))).toBe(false);
      expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes .mypy_cache directories from indexing", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, ".mypy_cache"), { recursive: true });

      writeFileSync(join(root, "src", "main.ts"), `export function main() {}\n`);
      writeFileSync(join(root, ".mypy_cache", "stub.ts"), `export const stub = 1;\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.startsWith(".mypy_cache/"))).toBe(false);
      expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes .claude/worktrees subdirectory from indexing", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, ".claude", "worktrees"), { recursive: true });

      writeFileSync(join(root, "src", "main.ts"), `export function main() {}\n`);
      writeFileSync(join(root, ".claude", "worktrees", "agent.ts"), `export const agent = true;\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.startsWith(".claude/"))).toBe(false);
      expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not skip directories with .git directory (not worktree)", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "subproject"), { recursive: true });
      mkdirSync(join(root, "subproject", ".git"), { recursive: true });

      writeFileSync(join(root, "src", "main.ts"), `export function main() {}\n`);
      writeFileSync(join(root, "subproject", "app.ts"), `export function app() {}\n`);

      await indexProject(db, root);

      const files = fileQueries(db).getAll();
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
