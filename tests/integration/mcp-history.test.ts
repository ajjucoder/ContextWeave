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
import { indexGitLineage } from "../../src/core/git-lineage.js";
import { registerHistoryTool } from "../../src/mcp/tools/history.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  handler: (args: unknown) => Promise<ToolResult>;
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
  const root = mkdtempSync(join(tmpdir(), "cw-mcp-history-"));
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

describe("cw_history", () => {
  it("returns file history with indexed summaries", async () => {
    const root = createTempRepo();
    const authPath = join(root, "src/auth.ts");

    writeFileSync(authPath, "export function handleLogin() {\n  return 'v1';\n}\n");
    commitAll(root, "feat(auth): add handleLogin");

    writeFileSync(authPath, "export function handleLogin() {\n  return 'v2';\n}\n");
    commitAll(root, "fix(auth): update handleLogin");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    await indexProject(db, root);
    await indexGitLineage(db, root);

    const server = new McpServer({ name: "contextweave-test-history", version: "0.0.0" });
    registerHistoryTool(server, db, root);

    const result = await getTool(server, "cw_history").handler({ file: "src/auth.ts" });
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text) as {
      file: string;
      symbol: string | null;
      commitCount: number;
      commits: Array<{ message: string; summary: string; filesChanged: string[] }>;
    };

    expect(result.isError).not.toBe(true);
    expect(parsed.file).toBe("src/auth.ts");
    expect(parsed.symbol).toBeNull();
    expect(parsed.commitCount).toBe(2);
    expect(parsed.commits[0]?.message).toBe("fix(auth): update handleLogin");
    expect(parsed.commits[0]?.summary).toContain("Changed handleLogin in src/auth.ts");
    expect(parsed.commits[0]?.filesChanged).toEqual(["src/auth.ts"]);

    db.close();
  });

  it("returns symbol-specific history limited to the symbol's changes", async () => {
    const root = createTempRepo();
    const authPath = join(root, "src/auth.ts");

    writeFileSync(
      authPath,
      [
        "export function handleLogin() {",
        "  return 'v1';",
        "}",
        "",
      ].join("\n")
    );
    commitAll(root, "feat(auth): add handleLogin");

    writeFileSync(
      authPath,
      [
        "export function handleLogin() {",
        "  return 'v1';",
        "}",
        "",
        "export function helper() {",
        "  return 'helper';",
        "}",
        "",
      ].join("\n")
    );
    commitAll(root, "feat(auth): add helper");

    writeFileSync(
      authPath,
      [
        "export function handleLogin() {",
        "  return 'v2';",
        "}",
        "",
        "export function helper() {",
        "  return 'helper';",
        "}",
        "",
      ].join("\n")
    );
    commitAll(root, "fix(auth): update handleLogin");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    await indexProject(db, root);
    await indexGitLineage(db, root);

    const server = new McpServer({ name: "contextweave-test-history", version: "0.0.0" });
    registerHistoryTool(server, db, root);

    const result = await getTool(server, "cw_history").handler({
      file: "src/auth.ts",
      symbol: "handleLogin",
    });
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text) as {
      commitCount: number;
      commits: Array<{ message: string }>;
    };

    expect(result.isError).not.toBe(true);
    expect(parsed.commitCount).toBe(2);
    expect(parsed.commits.map((commit) => commit.message)).toEqual([
      "fix(auth): update handleLogin",
      "feat(auth): add handleLogin",
    ]);

    db.close();
  });
});
