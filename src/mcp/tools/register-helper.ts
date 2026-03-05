import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type RegisterToolFn = (...args: any[]) => void;

export function getRegisterTool(server: McpServer): RegisterToolFn {
  return (server.tool as RegisterToolFn).bind(server);
}
