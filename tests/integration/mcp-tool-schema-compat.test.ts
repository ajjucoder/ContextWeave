import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStatusTool } from "../../src/mcp/tools/status.js";
import { registerCapsuleTool } from "../../src/mcp/tools/capsule.js";
import { registerFlowTool } from "../../src/mcp/tools/flow.js";
import { registerImpactTool } from "../../src/mcp/tools/impact.js";
import { registerRecallTool } from "../../src/mcp/tools/recall.js";
import { registerRememberTool } from "../../src/mcp/tools/remember.js";
import { registerReindexTool } from "../../src/mcp/tools/reindex.js";
import { registerOverviewTool } from "../../src/mcp/tools/overview.js";
import { registerFilesTool } from "../../src/mcp/tools/files.js";
import { registerSearchTool } from "../../src/mcp/tools/search.js";
import { registerReadTool } from "../../src/mcp/tools/read.js";
import { registerStatsTool } from "../../src/mcp/tools/stats.js";
import { registerExportTool } from "../../src/mcp/tools/export.js";
import { registerSnapshotTool } from "../../src/mcp/tools/snapshot.js";
import { registerHistoryTool } from "../../src/mcp/tools/history.js";

type RegisteredTool = {
  inputSchema?: {
    safeParseAsync: (args: unknown) => Promise<{ success: boolean }>;
  };
};

function getRegisteredTool(server: McpServer, name: string): RegisteredTool {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }
  return tool;
}

describe("MCP tool schema compatibility", () => {
  it("cw_status input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });

    registerStatusTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_status").inputSchema?.safeParseAsync({ verbose: true });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_capsule input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });

    registerCapsuleTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_capsule").inputSchema?.safeParseAsync({
      query: "UserService",
      token_budget: 4000,
      mode: "feature",
      anchor_symbols: ["AuthService", "UserService"],
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_capsule input schema rejects more than 20 anchor symbols", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });

    registerCapsuleTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_capsule").inputSchema?.safeParseAsync({
      query: "UserService",
      anchor_symbols: Array.from({ length: 21 }, (_, index) => `Anchor${index}`),
    });
    expect(parseResult?.success).toBe(false);
  });

  it("cw_flow input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerFlowTool(server, null as never);

    const parseResult = await getRegisteredTool(server, "cw_flow").inputSchema?.safeParseAsync({
      source: "UserService",
      target: "DbClient",
      max_hops: 4,
      order: "topological",
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_impact input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerImpactTool(server, null as never);

    const parseResult = await getRegisteredTool(server, "cw_impact").inputSchema?.safeParseAsync({
      target: "UserService",
      depth: 3,
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_recall input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerRecallTool(server, null as never);

    const parseResult = await getRegisteredTool(server, "cw_recall").inputSchema?.safeParseAsync({
      query: "cache invalidation",
      scope: "architecture",
      include_stale: false,
      limit: 10,
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_remember input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerRememberTool(server, null as never, "session-test", "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_remember").inputSchema?.safeParseAsync({
      scope: "decision",
      note: "Use FTS5 for symbol lookup",
      confidence: 0.9,
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_reindex input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerReindexTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_reindex").inputSchema?.safeParseAsync({
      path: "/tmp/project/src/index.ts",
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_reindex input schema parses multi-root args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerReindexTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_reindex").inputSchema?.safeParseAsync({
      paths: [".", "../service-a", "../service-b"],
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_overview input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerOverviewTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_overview").inputSchema?.safeParseAsync({
      path: "src/capsule",
      depth: 2,
      max_tokens: 1200,
      query: "generator",
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_files input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerFilesTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_files").inputSchema?.safeParseAsync({
      pattern: "src/**/*.ts",
      path: "src",
      max_results: 25,
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_grep input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerSearchTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_grep").inputSchema?.safeParseAsync({
      query: "generateCapsule",
      path: "src/capsule",
      glob: "**/*.ts",
      context_lines: 2,
      max_results: 20,
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_read input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerReadTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_read").inputSchema?.safeParseAsync({
      path: "src/capsule/generator.ts",
      start_line: 10,
      end_line: 60,
      max_lines: 200,
      symbol: "generateCapsule",
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_stats input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerStatsTool(server, null as never, "/tmp/project", "session-default");

    const parseResult = await getRegisteredTool(server, "cw_stats").inputSchema?.safeParseAsync({
      session_id: "session-override",
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_export input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerExportTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_export").inputSchema?.safeParseAsync({
      format: "dot",
      scope: "src/auth",
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_snapshot input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerSnapshotTool(server, null as never, "/tmp/project", "session-default");

    const parseResult = await getRegisteredTool(server, "cw_snapshot").inputSchema?.safeParseAsync({});
    expect(parseResult?.success).toBe(true);
  });

  it("cw_history input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerHistoryTool(server, null as never, "/tmp/project");

    const parseResult = await getRegisteredTool(server, "cw_history").inputSchema?.safeParseAsync({
      file: "src/auth.ts",
      symbol: "handleLogin",
    });
    expect(parseResult?.success).toBe(true);
  });
});
