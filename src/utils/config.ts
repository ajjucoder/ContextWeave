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
}

const DEFAULTS: ProjectConfig = {
  version: 1,
  ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
  tokenBudget: 4000,
  defaultMode: "feature",
  stalenessDepth: 2,
  confidenceDecay: 0.1,
  gcThreshold: 0.1,
};

export function loadConfig(projectRoot: string): ProjectConfig {
  const configPath = resolve(projectRoot, ".contextweave", "config.json");
  if (!existsSync(configPath)) return { ...DEFAULTS };

  const raw = JSON.parse(readFileSync(configPath, "utf8")) as Partial<ProjectConfig>;
  return { ...DEFAULTS, ...raw };
}
