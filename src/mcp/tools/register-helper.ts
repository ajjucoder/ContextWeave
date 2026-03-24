import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod/v3";

/**
 * Compatible Zod shape type matching SDK's internal ZodRawShapeCompat.
 * Record of field names to Zod schema types.
 */
export type ZodRawShapeCompat = Record<string, z.ZodTypeAny>;

/**
 * Tool handler return type matching MCP SDK's expected response shape.
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// Re-export the SDK's ToolCallback type for use in tool implementations
export type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Get a typed registerTool function from the MCP server.
 * This helper avoids complex generic overload issues by accepting any callback
 * and letting the schema validation happen at runtime.
 */
export function getRegisterTool(server: McpServer): (
  name: string,
  description: string,
  paramsSchema: ZodRawShapeCompat,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (args: any, extra: any) => Promise<ToolResult> | ToolResult
) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return server.tool.bind(server) as any;
}
