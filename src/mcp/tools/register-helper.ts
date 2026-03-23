import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod/v3";

/**
 * Compatible Zod shape type for parameter schemas.
 * Record of field names to Zod schema types.
 * This matches the SDK's internal ZodRawShapeCompat type.
 */
export type ZodRawShapeCompat = Record<string, z.ZodTypeAny>;

/**
 * Tool handler return type matching MCP SDK's expected response shape.
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Infers the shape of a Zod raw schema into a typed object.
 * Maps each field's Zod type to its inferred TypeScript type.
 */
export type InferZodShape<Shape extends ZodRawShapeCompat> = {
  [K in keyof Shape]: Shape[K] extends z.ZodTypeAny ? z.infer<Shape[K]> : never;
};

/**
 * Tool callback type matching MCP SDK's expected handler signature.
 * The args type is derived from the Zod schema shape.
 */
export type ToolCallback<Args extends ZodRawShapeCompat = ZodRawShapeCompat> = (
  args: InferZodShape<Args>,
  extra: unknown
) => Promise<ToolResult> | ToolResult;

/**
 * Type for the registerTool function returned by getRegisterTool.
 * This matches the McpServer.tool() signature for the common 4-argument overload:
 * tool(name, description, paramsSchema, callback)
 */
export type RegisterToolFn = <Args extends ZodRawShapeCompat>(
  name: string,
  description: string,
  paramsSchema: Args,
  callback: ToolCallback<Args>
) => void;

export function getRegisterTool(server: McpServer): RegisterToolFn {
  return (server.tool as RegisterToolFn).bind(server);
}
