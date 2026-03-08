import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ProjectConfig {
  version: number;
  ignore: string[];
  tokenBudget: number;
  defaultMode: "debug" | "refactor" | "feature" | "review";
  stalenessDepth: number;
  confidenceDecay: number;
  gcThreshold: number;
  embeddingModel?: string;
  primaryDirs: string[];
  archiveDirs: string[];
}

const DEFAULTS: ProjectConfig = {
  version: 1,
  ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
  tokenBudget: 4000,
  defaultMode: "feature",
  stalenessDepth: 2,
  confidenceDecay: 0.1,
  gcThreshold: 0.1,
  primaryDirs: [],
  archiveDirs: [],
};

function sanitizePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function sanitizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const configPath = resolve(projectRoot, ".contextweave", "config.json");
  if (!existsSync(configPath)) return { ...DEFAULTS };

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const ignore = sanitizePatterns(raw.ignore ?? DEFAULTS.ignore);
    const exclude = sanitizePatterns(raw.exclude);
    const excludePatterns = sanitizePatterns(raw.excludePatterns);

    return {
      ...DEFAULTS,
      ...raw,
      ignore: [...new Set([...ignore, ...exclude, ...excludePatterns])],
      embeddingModel: sanitizeOptionalString(raw.embeddingModel),
      primaryDirs: sanitizePatterns(raw.primaryDirs),
      archiveDirs: sanitizePatterns(raw.archiveDirs),
    } as ProjectConfig;
  } catch {
    process.stderr.write(`[contextweave] Warning: could not parse config at ${configPath}, using defaults\n`);
    return { ...DEFAULTS };
  }
}
