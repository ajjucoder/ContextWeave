import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStatusTool } from "../../src/mcp/tools/status.js";
import { registerCapsuleTool } from "../../src/mcp/tools/capsule.js";
import { registerFlowTool } from "../../src/mcp/tools/flow.js";
import { registerImpactTool } from "../../src/mcp/tools/impact.js";
import { registerRecallTool } from "../../src/mcp/tools/recall.js";
import { registerRememberTool } from "../../src/mcp/tools/remember.js";
import { registerReindexTool } from "../../src/mcp/tools/reindex.js";

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
    });
    expect(parseResult?.success).toBe(true);
  });

  it("cw_flow input schema parses valid args", async () => {
    const server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
    registerFlowTool(server, null as never);

    const parseResult = await getRegisteredTool(server, "cw_flow").inputSchema?.safeParseAsync({
      source: "UserService",
      target: "DbClient",
      max_hops: 4,
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
});
