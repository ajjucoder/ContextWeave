import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { registerOverviewTool } from "../../src/mcp/tools/overview.js";
import { registerFilesTool } from "../../src/mcp/tools/files.js";
import { registerSearchTool } from "../../src/mcp/tools/search.js";
import { registerReadTool } from "../../src/mcp/tools/read.js";
import { registerStatusTool } from "../../src/mcp/tools/status.js";
import { registerCapsuleTool } from "../../src/mcp/tools/capsule.js";
import { registerStatsTool } from "../../src/mcp/tools/stats.js";

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

  server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
  registerStatusTool(server, db, FIXTURE_DIR);
  registerCapsuleTool(server, db, FIXTURE_DIR, { version: 1, ignore: [], tokenBudget: 2400, defaultMode: "feature", stalenessDepth: 2, confidenceDecay: 0.1, gcThreshold: 0.1 }, "session-1");
  registerStatsTool(server, db, FIXTURE_DIR, "session-1");
  registerOverviewTool(server, db, FIXTURE_DIR);
  registerFilesTool(server, db, FIXTURE_DIR);
  registerSearchTool(server, db, FIXTURE_DIR);
  registerReadTool(server, db, FIXTURE_DIR);
}, 60000);

afterAll(() => {
  db.close();
});

describe("mcp navigation tools", () => {
  it("cw_overview returns compact project summary", async () => {
    const result = await getTool(server, "cw_overview").handler({
      path: ".",
      depth: 2,
      max_tokens: 1200,
      query: "UserService",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ContextWeave Overview");
    expect(text).toContain("Indexed Files:");
    expect(text).toContain("First-pass rate:");
    expect(text).toContain("Correction rate:");
    expect(text).toContain("Query Focus:");
  });

  it("cw_files lists indexed files with metadata and filtering", async () => {
    const result = await getTool(server, "cw_files").handler({
      pattern: "**/*.ts",
      max_results: 20,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Indexed Files");
    expect(text).toContain("sample.ts");
    expect(text).toContain("symbols:");
  });

  it("cw_grep returns snippet matches with optional scope filters", async () => {
    const result = await getTool(server, "cw_grep").handler({
      query: "validateEmail",
      path: ".",
      glob: "**/*.ts",
      context_lines: 1,
      max_results: 5,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Search results");
    expect(text).toContain("sample.ts");
    expect(text).toContain("validateEmail");
  });

  it("cw_grep treats /pattern/ as regex and expands brace globs consistently", async () => {
    const result = await getTool(server, "cw_grep").handler({
      query: "/validate[A-Z]\\w+/",
      path: ".",
      glob: "**/*.{ts,tsx}",
      context_lines: 1,
      max_results: 5,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Search results");
    expect(text).toContain("sample.ts");
    expect(text).toContain("validateEmail");
  });

  it("cw_read reads bounded line ranges and symbol-targeted ranges", async () => {
    const byPath = await getTool(server, "cw_read").handler({
      path: "sample.ts",
      start_line: 1,
      end_line: 6,
      max_lines: 6,
    });
    const byPathText = byPath.content[0]?.text ?? "";
    expect(byPath.isError).not.toBe(true);
    expect(byPathText).toContain("Read sample.ts:1-6");
    expect(byPathText).toContain("1 |");

    const bySymbol = await getTool(server, "cw_read").handler({
      symbol: "validateEmail",
      max_lines: 80,
    });
    const bySymbolText = bySymbol.content[0]?.text ?? "";
    expect(bySymbol.isError).not.toBe(true);
    expect(bySymbolText).toContain("Symbol:");
    expect(bySymbolText).toContain("validateEmail");
  });

  it("cw_read suggests a next tool when symbol resolution misses", async () => {
    const result = await getTool(server, "cw_read").handler({
      symbol: "missingSymbol",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain('No indexed symbol found matching "missingSymbol"');
    expect(text).toContain('cw_grep(query: "missingSymbol")');
    expect(text).toContain('cw_overview(query: "missingSymbol")');
  });

  it("cw_status returns index health and project profile data", async () => {
    const result = await getTool(server, "cw_status").handler({ verbose: false });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ContextWeave Index Status");
    expect(text).toContain("Files:");
    expect(text).toContain("First-pass rate:");
    expect(text).toContain("Correction rate:");
    expect(text).toContain("Project Profile");
  });

  it("cw_overview suggests a follow-up query action when query focus is empty", async () => {
    const result = await getTool(server, "cw_overview").handler({
      path: ".",
      depth: 2,
      max_tokens: 1200,
      query: "missingSymbol",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain('Query Focus: "missingSymbol"');
    expect(text).toContain("No focused file matches found.");
    expect(text).toContain('cw_grep(query: "missingSymbol")');
  });

  it("cw_capsule returns capsule content through the registered MCP handler", async () => {
    const result = await getTool(server, "cw_capsule").handler({
      query: "validate email flow",
      token_budget: 2400,
      mode: "feature",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ContextWeave Capsule");
    expect(text).toContain("sample.ts");
  });

  it("cw_capsule includes next-step commands when confidence is low", async () => {
    const result = await getTool(server, "cw_capsule").handler({
      query: "missing symbol journey",
      token_budget: 2400,
      mode: "feature",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("--- Next Actions ---");
    expect(text).toContain('cw_overview(query: "missing symbol journey")');
  });

  it("cw_stats reports session-level savings for the active session", async () => {
    const result = await getTool(server, "cw_stats").handler({});

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ContextWeave Session Stats");
    expect(text).toContain("Session: session-1");
    expect(text).toContain("First-pass rate:");
    expect(text).toContain("Correction rate:");
  });
});
