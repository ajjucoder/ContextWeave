import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { registerStatusTool } from "../../src/mcp/tools/status.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  handler: (args: unknown) => Promise<ToolResult>;
};

function getTool(server: McpServer, name: string): RegisteredTool {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("cw_status source reporting", () => {
  it("does not flag monorepo package source files as non-source when they live under package-prefixed roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-status-monorepo-"));
    tempRoots.push(root);

    mkdirSync(join(root, "packages", "api", "src"), { recursive: true });
    writeFileSync(
      join(root, "packages", "api", "package.json"),
      JSON.stringify({ name: "api", dependencies: { express: "^4.0.0" } })
    );
    writeFileSync(
      join(root, "packages", "api", "src", "index.ts"),
      "export function createServer() { return 'ok'; }\n"
    );

    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    await indexProject(db, root);

    const server = new McpServer({ name: "contextweave-test-status-source", version: "0.0.0" });
    registerStatusTool(server, db, root);

    const result = await getTool(server, "cw_status").handler({ verbose: false });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).not.toBe(true);
    expect(text).not.toContain("non-source directories");

    db.close();
  });
});
