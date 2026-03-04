import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("tsconfig-paths");

export interface TsconfigPaths {
  baseUrl: string;
  aliases: Array<{ prefix: string; paths: string[] }>;
}

export function loadTsconfigPaths(projectRoot: string): TsconfigPaths | null {
  const candidates = ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"];

  for (const filename of candidates) {
    const configPath = resolve(projectRoot, filename);
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const config = JSON.parse(stripped) as {
        compilerOptions?: {
          baseUrl?: string;
          paths?: Record<string, string[]>;
        };
      };

      const compilerOptions = config.compilerOptions;
      if (!compilerOptions) continue;

      const baseUrl = compilerOptions.baseUrl
        ? resolve(projectRoot, compilerOptions.baseUrl)
        : projectRoot;

      const aliases: TsconfigPaths["aliases"] = [];

      if (compilerOptions.paths) {
        for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
          if (!pattern.endsWith("/*") || !Array.isArray(targets)) continue;
          const prefix = pattern.slice(0, -1);
          const resolvedPaths = targets
            .filter((t) => t.endsWith("/*"))
            .map((t) => resolve(baseUrl, t.slice(0, -1)));
          if (resolvedPaths.length > 0) {
            aliases.push({ prefix, paths: resolvedPaths });
          }
        }
      }

      log.debug("loaded tsconfig paths", { file: filename, baseUrl, aliasCount: aliases.length });
      return { baseUrl, aliases };
    } catch (err) {
      log.debug("failed to parse tsconfig", { file: filename, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return null;
}

export function resolveAliasedImport(
  importSource: string,
  tsconfigPaths: TsconfigPaths
): string[] {
  for (const alias of tsconfigPaths.aliases) {
    if (importSource.startsWith(alias.prefix)) {
      const remainder = importSource.slice(alias.prefix.length);
      return alias.paths.map((basePath) => join(basePath, remainder));
    }
  }

  if (importSource.startsWith(".") || importSource.startsWith("/")) return [];

  return [resolve(tsconfigPaths.baseUrl, importSource)];
}
