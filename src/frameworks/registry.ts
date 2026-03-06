import type { ParsedFrameworkCall, ParsedSymbol } from "../core/types.js";
import { expressFrameworkPlugin } from "./plugins/express.js";
import { nextFrameworkPlugin } from "./plugins/next.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "./types.js";

const FRAMEWORK_TRACE_PLUGINS: FrameworkTracePlugin[] = [
  nextFrameworkPlugin,
  expressFrameworkPlugin,
];

export function extractFrameworkCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
  return FRAMEWORK_TRACE_PLUGINS.flatMap((plugin) => plugin.extractCalls(language, symbols));
}

export function resolveFrameworkTargets(
  frameworkCall: ParsedFrameworkCall,
  context: FrameworkResolveContext
): number[] {
  const plugin = FRAMEWORK_TRACE_PLUGINS.find((candidate) => candidate.supports(frameworkCall));
  if (!plugin) return [];
  return plugin.resolveTargets(frameworkCall, context);
}
