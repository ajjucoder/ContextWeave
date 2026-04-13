import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { registerRepoMapTool } from "../../src/mcp/tools/repo-map.js";

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

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, FIXTURE_DIR);
  updateCentralityScores(db);

  server = new McpServer({ name: "contextweave-test-repo-map", version: "0.0.0" });
  registerRepoMapTool(server, db, FIXTURE_DIR);
}, 60000);

afterAll(() => {
  db.close();
});

describe("cw_repo_map", () => {
  it("returns a compact repo map from the existing index", async () => {
    const result = await getTool(server, "cw_repo_map").handler({
      path: ".",
      max_files: 4,
      max_symbols_per_file: 2,
      max_tokens: 1200,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ContextWeave Repo Map");
    expect(text).toContain("Directories:");
    expect(text).toContain("sample.ts");
    expect(text).toContain("validateEmail");
    expect(text).toContain("UserService");
  });

  it("can focus the map on query-relevant files", async () => {
    const result = await getTool(server, "cw_repo_map").handler({
      query: "profile sync",
      max_files: 2,
      max_symbols_per_file: 2,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain('Query Focus: "profile sync"');
    expect(text).toContain("impact-primary.ts");
    expect(text).toContain("syncProfile");
  });
});
