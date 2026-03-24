import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import {
  buildGitCommitSummary,
  indexGitLineage,
  isTemporalGitQuery,
  parseGitLineageLog,
  searchGitCommits,
} from "../../src/core/git-lineage.js";

const tempDirs: string[] = [];
let commitCounter = 0;

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-git-lineage-"));
  tempDirs.push(root);
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.name", "ContextWeave Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  return root;
}

function commitAll(root: string, message: string): void {
  commitCounter += 1;
  const isoDate = `2024-01-01T00:00:0${commitCounter}Z`;
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", message], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_DATE: isoDate,
    },
  });
}

function seedFileAndSymbols(db: Database.Database, filePath: string, names: string[]): void {
  const now = Date.now();
  const fileId = fileQueries(db).insert({
    path: filePath,
    hash: `${filePath}-hash`,
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: names.length,
    error: null,
  });

  for (const name of names) {
    symbolQueries(db).insert({
      fileId,
      name,
      kind: "function",
      startLine: 1,
      endLine: 5,
      signature: `function ${name}()`,
      bodyHash: `${name}-hash`,
      fullSource: `function ${name}() {}`,
      isExported: true,
      docComment: null,
      centrality: 1,
      lastSeen: now,
      parentSymbolId: null,
      qualifiedName: null,
      visibility: "public",
    });
  }
}

afterEach(() => {
  commitCounter = 0;
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("git lineage", () => {
  it("parses git log --oneline --name-status output into commits and file changes", () => {
    const parsed = parseGitLineageLog(`
abc1234 feat(core): add lineage parser
M\tsrc/core/git-lineage.ts
A\ttests/core/git-lineage.test.ts

def5678 fix(indexer): handle deleted files
D\tsrc/old.ts
R100\tsrc/legacy.ts\tsrc/current.ts
`);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      hash: "abc1234",
      message: "feat(core): add lineage parser",
    });
    expect(parsed[0]?.files).toEqual([
      { changeType: "M", filePath: "src/core/git-lineage.ts", previousPath: null },
      { changeType: "A", filePath: "tests/core/git-lineage.test.ts", previousPath: null },
    ]);
    expect(parsed[1]?.files).toEqual([
      { changeType: "D", filePath: "src/old.ts", previousPath: null },
      { changeType: "R", filePath: "src/current.ts", previousPath: "src/legacy.ts" },
    ]);
  });

  it("builds template summaries from commit type, functions, files, and message", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    seedFileAndSymbols(db, "src/core/git-lineage.ts", ["parseGitLineageLog", "buildGitCommitSummary"]);
    seedFileAndSymbols(db, "tests/core/git-lineage.test.ts", ["storesGitHistory"]);

    const summary = buildGitCommitSummary(db, {
      hash: "abc1234",
      author: null,
      timestamp: null,
      message: "feat(core): add lineage parser",
      files: [
        { changeType: "M", filePath: "src/core/git-lineage.ts", previousPath: null },
        { changeType: "A", filePath: "tests/core/git-lineage.test.ts", previousPath: null },
      ],
    });

    expect(summary).toBe(
      "[feat] Changed buildGitCommitSummary, parseGitLineageLog, storesGitHistory in src/core/git-lineage.ts, tests/core/git-lineage.test.ts — feat(core): add lineage parser"
    );

    db.close();
  });

  it("indexes git commits into sqlite tables with generated summaries", async () => {
    const root = createTempRepo();
    mkdirSync(join(root, "src"), { recursive: true });

    writeFileSync(join(root, "src/app.ts"), "export function firstVersion() { return 1; }\n");
    commitAll(root, "feat(core): add app module");

    writeFileSync(
      join(root, "src/app.ts"),
      "export function firstVersion() { return 2; }\nexport function helper() { return 'ok'; }\n"
    );
    commitAll(root, "fix(core): update app module");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    seedFileAndSymbols(db, "src/app.ts", ["firstVersion", "helper"]);

    const result = await indexGitLineage(db, root);

    expect(result.commitCount).toBe(2);
    expect(result.fileChangeCount).toBe(2);

    const commits = db.prepare(`
      SELECT hash, message, summary, files_changed
      FROM git_commits
      ORDER BY timestamp DESC, hash DESC
    `).all() as Array<{ hash: string; message: string; summary: string; files_changed: string }>;

    expect(commits).toHaveLength(2);
    expect(commits[0]?.message).toBe("fix(core): update app module");
    expect(commits[0]?.summary).toBe(
      "[fix] Changed firstVersion, helper in src/app.ts — fix(core): update app module"
    );
    expect(JSON.parse(commits[0]?.files_changed ?? "[]")).toEqual(["src/app.ts"]);

    const changedFiles = db.prepare(`
      SELECT commit_hash, file_path, change_type
      FROM git_commit_files
      ORDER BY commit_hash, file_path
    `).all() as Array<{ commit_hash: string; file_path: string; change_type: string }>;

    expect(changedFiles).toHaveLength(2);
    expect(changedFiles.every((row) => row.file_path === "src/app.ts")).toBe(true);
    expect(changedFiles.every((row) => row.change_type === "A" || row.change_type === "M")).toBe(true);

    db.close();
  });

  it("detects temporal git-history queries", () => {
    expect(isTemporalGitQuery("why was auth changed")).toBe(true);
    expect(isTemporalGitQuery("who introduced login retries")).toBe(true);
    expect(isTemporalGitQuery("auth middleware flow")).toBe(false);
  });

  it("returns top git commits for temporal queries", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    seedFileAndSymbols(db, "src/auth.ts", ["handleLogin"]);
    seedFileAndSymbols(db, "src/payments.ts", ["chargeCard"]);

    db.prepare(`
      INSERT INTO git_commits (hash, author, timestamp, message, summary, files_changed)
      VALUES
        ('aaa1111', 'Ada', 1704067200000, 'fix(auth): revert oauth breakage', '[fix] Changed handleLogin in src/auth.ts — fix(auth): revert oauth breakage', '["src/auth.ts"]'),
        ('bbb2222', 'Bea', 1704153600000, 'feat(auth): introduce session rotation', '[feat] Changed handleLogin in src/auth.ts — feat(auth): introduce session rotation', '["src/auth.ts"]'),
        ('ccc3333', 'Cy', 1704240000000, 'fix(payments): retry charge failures', '[fix] Changed chargeCard in src/payments.ts — fix(payments): retry charge failures', '["src/payments.ts"]'),
        ('ddd4444', 'Dee', 1704326400000, 'chore(core): update docs', '[chore] Changed docs in docs/auth.md — chore(core): update docs', '["docs/auth.md"]')
    `).run();

    const results = searchGitCommits(db, "why was auth changed", 3);

    expect(results).toHaveLength(3);
    expect(results[0]?.hash).toBe("bbb2222");
    expect(results[1]?.hash).toBe("aaa1111");
    expect(results[0]?.fileId).not.toBeNull();
    expect(results[0]?.summary).toContain("src/auth.ts");
    expect(results.every((result) => result.score > 0)).toBe(true);

    db.close();
  });
});
