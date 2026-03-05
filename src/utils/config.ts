import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ProjectConfig {
  version: number;
  ignore: string[];
  exclude: string[];
  excludePatterns: string[];
  tokenBudget: number;
  defaultMode: "debug" | "refactor" | "feature" | "review";
  stalenessDepth: number;
  confidenceDecay: number;
  gcThreshold: number;
}

const DEFAULTS: ProjectConfig = {
  version: 1,
  ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
  exclude: [],
  excludePatterns: [],
  tokenBudget: 4000,
  defaultMode: "feature",
  stalenessDepth: 2,
  confidenceDecay: 0.1,
  gcThreshold: 0.1,
};

function sanitizePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const configPath = resolve(projectRoot, ".contextweave", "config.json");
  if (!existsSync(configPath)) return { ...DEFAULTS };

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Partial<ProjectConfig>;
    const ignore = sanitizePatterns(raw.ignore ?? DEFAULTS.ignore);
    const exclude = sanitizePatterns(raw.exclude);
    const excludePatterns = sanitizePatterns(raw.excludePatterns);

    return {
      ...DEFAULTS,
      ...raw,
      ignore: uniq([...ignore, ...exclude, ...excludePatterns]),
      exclude,
      excludePatterns,
    };
  } catch {
    process.stderr.write(`[contextweave] Warning: could not parse config at ${configPath}, using defaults\n`);
    return { ...DEFAULTS };
  }
}
