import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { registerReadTool } from "../../src/mcp/tools/read.js";

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

let db: Database.Database;
let server: McpServer;
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
  registerReadTool(server, db, FIXTURE_DIR);
});

afterAll(() => {
  db.close();
});

describe("cw_read path guards", () => {
  it("rejects traversal paths outside project root", async () => {
    const result = await getTool(server, "cw_read").handler({
      path: "../../etc/passwd",
      max_lines: 20,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("outside the project root");
  });

  it("rejects directory targets", async () => {
    const result = await getTool(server, "cw_read").handler({
      path: ".",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("not a file");
  });
});
