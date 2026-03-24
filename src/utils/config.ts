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
  passiveTtlDays: number;
  embeddingModel: string;
  primaryDirs: string[];
  archiveDirs: string[];
}

// MCP schema defaults per specification
const DEFAULTS: ProjectConfig = {
  version: 1,
  ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
  tokenBudget: 10000,
  defaultMode: "feature",
  stalenessDepth: 7,
  confidenceDecay: 0.9,
  gcThreshold: 0.5,
  passiveTtlDays: 7,
  embeddingModel: "none",
  primaryDirs: [],
  archiveDirs: [],
};

// Bounds per MCP schema specification
const BOUNDS = {
  tokenBudget: { min: 100, max: 50000 },
  confidenceDecay: { min: 0, max: 1 },
  stalenessDepth: { min: 0, max: 10 },
  gcThreshold: { min: 0, max: 1 },
  passiveTtlDays: { min: 1, max: 3650 },
};

const VALID_MODES: ProjectConfig["defaultMode"][] = ["debug", "refactor", "feature", "review"];

function clampNumber(value: unknown, min: number, max: number, defaultValue: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return defaultValue;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sanitizePositiveInteger(value: unknown, defaultValue: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return defaultValue;
  if (!Number.isInteger(value) || value < 1) return defaultValue;
  return value;
}

function sanitizeDefaultMode(value: unknown): ProjectConfig["defaultMode"] {
  if (typeof value !== "string") return DEFAULTS.defaultMode;
  if (VALID_MODES.includes(value as ProjectConfig["defaultMode"])) {
    return value as ProjectConfig["defaultMode"];
  }
  return DEFAULTS.defaultMode;
}

function sanitizePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function sanitizeEmbeddingModel(value: unknown): string {
  if (typeof value !== "string") return DEFAULTS.embeddingModel;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULTS.embeddingModel;
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const configPath = resolve(projectRoot, ".contextweave", "config.json");
  if (!existsSync(configPath)) return { ...DEFAULTS };

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;

    // Build ignore list from multiple sources
    const ignore = sanitizePatterns(raw.ignore ?? DEFAULTS.ignore);
    const exclude = sanitizePatterns(raw.exclude);
    const excludePatterns = sanitizePatterns(raw.excludePatterns);
    const combinedIgnore = [...new Set([...ignore, ...exclude, ...excludePatterns])];

    // Explicitly validate and assign each field - NO ...raw spread
    const config: ProjectConfig = {
      version: sanitizePositiveInteger(raw.version, DEFAULTS.version),
      ignore: combinedIgnore.length > 0 ? combinedIgnore : DEFAULTS.ignore,
      tokenBudget: clampNumber(
        raw.tokenBudget,
        BOUNDS.tokenBudget.min,
        BOUNDS.tokenBudget.max,
        DEFAULTS.tokenBudget
      ),
      defaultMode: sanitizeDefaultMode(raw.defaultMode),
      stalenessDepth: clampNumber(
        raw.stalenessDepth,
        BOUNDS.stalenessDepth.min,
        BOUNDS.stalenessDepth.max,
        DEFAULTS.stalenessDepth
      ),
      confidenceDecay: clampNumber(
        raw.confidenceDecay,
        BOUNDS.confidenceDecay.min,
        BOUNDS.confidenceDecay.max,
        DEFAULTS.confidenceDecay
      ),
      gcThreshold: clampNumber(
        raw.gcThreshold,
        BOUNDS.gcThreshold.min,
        BOUNDS.gcThreshold.max,
        DEFAULTS.gcThreshold
      ),
      passiveTtlDays: clampNumber(
        raw.passiveTtlDays,
        BOUNDS.passiveTtlDays.min,
        BOUNDS.passiveTtlDays.max,
        DEFAULTS.passiveTtlDays
      ),
      embeddingModel: sanitizeEmbeddingModel(raw.embeddingModel),
      primaryDirs: sanitizePatterns(raw.primaryDirs),
      archiveDirs: sanitizePatterns(raw.archiveDirs),
    };

    return config;
  } catch {
    process.stderr.write(`[contextweave] Warning: could not parse config at ${configPath}, using defaults\n`);
    return { ...DEFAULTS };
  }
}
