import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { registerDiffTool } from "../../src/mcp/tools/diff.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  handler: (args: unknown) => Promise<ToolResult>;
};

type DiffResponse = {
  branch: string | null;
  base: string;
  stagedOnly: boolean;
  scope: string;
  fileCount: number;
  files: Array<{
    path: string;
    status: string;
    staged: boolean;
    unstaged: boolean;
    indexed: boolean;
    language: string | null;
    added: number | null;
    deleted: number | null;
    symbols: string[];
  }>;
};

const tempDirs: string[] = [];
let commitCounter = 0;

function getTool(server: McpServer, name: string): RegisteredTool {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-mcp-diff-"));
  tempDirs.push(root);
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.name", "ContextWeave Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
}

function commitAll(root: string, message: string): void {
  commitCounter += 1;
  const isoDate = `2024-01-01T00:00:${String(commitCounter).padStart(2, "0")}Z`;
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

afterEach(() => {
  commitCounter = 0;
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("cw_diff", () => {
  it("returns current changed files with indexed symbols and untracked files", async () => {
    const root = createTempRepo();
    const authPath = join(root, "src/auth.ts");

    writeFileSync(authPath, "export function handleLogin() {\n  return 'v1';\n}\n");
    commitAll(root, "feat(auth): add handleLogin");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    await indexProject(db, root);

    writeFileSync(authPath, "export function handleLogin() {\n  return 'v2';\n}\n");
    writeFileSync(join(root, "src/new-file.ts"), "export const fresh = true;\n");

    const server = new McpServer({ name: "contextweave-test-diff", version: "0.0.0" });
    registerDiffTool(server, db, root);

    const result = await getTool(server, "cw_diff").handler({});
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as DiffResponse;

    expect(result.isError).not.toBe(true);
    expect(parsed.stagedOnly).toBe(false);
    expect(parsed.fileCount).toBe(2);
    expect(parsed.files).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "src/auth.ts",
        status: "modified",
        unstaged: true,
        indexed: true,
        language: "typescript",
        symbols: ["handleLogin"],
      }),
      expect.objectContaining({
        path: "src/new-file.ts",
        status: "untracked",
        indexed: false,
      }),
    ]));
    expect(parsed.files.find((file) => file.path === "src/auth.ts")?.added).toBe(1);
    expect(parsed.files.find((file) => file.path === "src/auth.ts")?.deleted).toBe(1);

    db.close();
  });

  it("can limit output to staged changes only", async () => {
    const root = createTempRepo();
    const authPath = join(root, "src/auth.ts");
    const otherPath = join(root, "src/other.ts");

    writeFileSync(authPath, "export function handleLogin() {\n  return 'v1';\n}\n");
    writeFileSync(otherPath, "export function helper() {\n  return 'ok';\n}\n");
    commitAll(root, "feat(auth): add auth helpers");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    await indexProject(db, root);

    writeFileSync(authPath, "export function handleLogin() {\n  return 'v2';\n}\n");
    execFileSync("git", ["add", "src/auth.ts"], { cwd: root });
    writeFileSync(otherPath, "export function helper() {\n  return 'changed';\n}\n");

    const server = new McpServer({ name: "contextweave-test-diff", version: "0.0.0" });
    registerDiffTool(server, db, root);

    const result = await getTool(server, "cw_diff").handler({ staged_only: true });
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as DiffResponse;

    expect(result.isError).not.toBe(true);
    expect(parsed.stagedOnly).toBe(true);
    expect(parsed.fileCount).toBe(1);
    expect(parsed.files[0]).toEqual(expect.objectContaining({
      path: "src/auth.ts",
      status: "modified",
      staged: true,
      unstaged: false,
      symbols: ["handleLogin"],
    }));

    db.close();
  });
});
