import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStatusTool } from "../../src/mcp/tools/status.js";
import { registerCapsuleTool } from "../../src/mcp/tools/capsule.js";

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
});
