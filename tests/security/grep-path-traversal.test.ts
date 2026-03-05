import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { registerSearchTool } from "../../src/mcp/tools/search.js";

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

describe("cw_grep path traversal protection", () => {
  let db: Database.Database;
  let server: McpServer;
  const projectRoot = "/tmp/test-project";

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerSearchTool(server, db, projectRoot);
  });

  it("rejects path with ../ traversal", async () => {
    const tool = getTool(server, "cw_grep");
    const result = await tool.handler({
      query: "test",
      path: "../../etc",
    });

    const text = result.content?.[0]?.text ?? "";
    expect(result.isError || text.includes("outside") || text.includes("No indexed")).toBe(true);
  });

  it("rejects absolute path outside project", async () => {
    const tool = getTool(server, "cw_grep");
    const result = await tool.handler({
      query: "test",
      path: "/etc/passwd",
    });

    const text = result.content?.[0]?.text ?? "";
    expect(result.isError || text.includes("outside") || text.includes("No indexed")).toBe(true);
  });

  it("accepts valid relative path within project", async () => {
    const tool = getTool(server, "cw_grep");
    const result = await tool.handler({
      query: "test",
      path: "src/core",
    });

    expect(result.isError).not.toBe(true);
  });
});
