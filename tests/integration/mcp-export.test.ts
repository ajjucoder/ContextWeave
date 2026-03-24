import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { registerExportTool } from "../../src/mcp/tools/export.js";

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

  server = new McpServer({ name: "contextweave-test-export", version: "0.0.0" });
  registerExportTool(server, db, FIXTURE_DIR);
}, 60000);

afterAll(() => {
  db.close();
});

describe("cw_export", () => {
  it("exports DOT for a scoped path", async () => {
    const result = await getTool(server, "cw_export").handler({
      format: "dot",
      scope: "sample.ts",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("digraph ContextWeaveExport");
    expect(text).toContain("sample.ts:");
    expect(text).toContain("->");
    expect(text).not.toContain("impact-primary.ts");
  });

  it("exports GraphML for a scoped path", async () => {
    const result = await getTool(server, "cw_export").handler({
      format: "graphml",
      scope: "sample.ts",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    expect(text).toContain("<graphml");
    expect(text).toContain("<node id=\"s");
    expect(text).toContain("<data key=\"filePath\">sample.ts</data>");
  });

  it("exports JSON with filtered nodes and edges", async () => {
    const result = await getTool(server, "cw_export").handler({
      format: "json",
      scope: "sample.ts",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);

    const parsed = JSON.parse(text) as {
      format: string;
      scope: string;
      nodeCount: number;
      edgeCount: number;
      nodes: Array<{ filePath: string }>;
      edges: Array<{ sourceId: number; targetId: number; kind: string }>;
    };

    expect(parsed.format).toBe("json");
    expect(parsed.scope).toBe("sample.ts");
    expect(parsed.nodeCount).toBeGreaterThan(0);
    expect(parsed.edgeCount).toBeGreaterThan(0);
    expect(parsed.nodes.every((node) => node.filePath === "sample.ts")).toBe(true);
    expect(parsed.edges.every((edge) => typeof edge.sourceId === "number" && typeof edge.targetId === "number")).toBe(true);
  });
});
