import type { ParsedFrameworkCall, ParsedSymbol } from "../core/types.js";
import { expressFrameworkPlugin } from "./plugins/express.js";
import { nextFrameworkPlugin } from "./plugins/next.js";
import { convexFrameworkPlugin } from "./plugins/convex.js";
import { fastapiFrameworkPlugin } from "./plugins/fastapi.js";
import { djangoFrameworkPlugin } from "./plugins/django.js";
import { flaskFrameworkPlugin } from "./plugins/flask.js";
import { springFrameworkPlugin } from "./plugins/spring.js";
import { aspnetFrameworkPlugin } from "./plugins/aspnet.js";
import { railsFrameworkPlugin } from "./plugins/rails.js";
import { ginFrameworkPlugin } from "./plugins/gin.js";
import { axumFrameworkPlugin } from "./plugins/axum.js";
import { laravelFrameworkPlugin } from "./plugins/laravel.js";
import { celerySidekiqFrameworkPlugin } from "./plugins/celery-sidekiq.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "./types.js";

const FRAMEWORK_TRACE_PLUGINS: FrameworkTracePlugin[] = [
  nextFrameworkPlugin,
  expressFrameworkPlugin,
  convexFrameworkPlugin,
  fastapiFrameworkPlugin,
  djangoFrameworkPlugin,
  flaskFrameworkPlugin,
  springFrameworkPlugin,
  aspnetFrameworkPlugin,
  railsFrameworkPlugin,
  ginFrameworkPlugin,
  axumFrameworkPlugin,
  laravelFrameworkPlugin,
  celerySidekiqFrameworkPlugin,
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
