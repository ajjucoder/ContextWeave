import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILTIN_IGNORE_PATTERNS } from "../core/indexer.js";
import { loadConfig } from "./config.js";

const SUSPICIOUS_DIRS = [
  "node_modules",
  "vendor",
  "demo",
  "demos",
  "examples",
  "build",
  "dist",
  ".next",
  "coverage",
  "venv",
  ".venv",
  ".tox",
  "target",
  ".cache",
  ".turbo",
];

export interface ProfileFileRecord {
  path: string;
  language: string;
}

export interface ProjectProfile {
  languages: Array<{ name: string; count: number }>;
  activeRoots: Array<{ path: string; count: number }>;
  excludedRoots: Array<{ path: string; source: string }>;
  suspiciousDirs: Array<{ path: string; excluded: boolean }>;
  ignoreNotes: string[];
}

function readIgnoreFile(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function extractRootPattern(pattern: string): string | null {
  const normalized = pattern.replace(/^!/, "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized.includes("*") || normalized.includes("?")) return null;
  if (normalized.includes("/")) {
    return null;
  }
  return normalized;
}

function buildIgnoreSources(projectRoot: string): Map<string, string> {
  const ignoreSources = new Map<string, string>();
  for (const pattern of BUILTIN_IGNORE_PATTERNS) {
    ignoreSources.set(pattern, "built-in");
  }

  const config = loadConfig(projectRoot);
  for (const pattern of config.ignore) {
    const root = extractRootPattern(pattern);
    if (root) ignoreSources.set(root, "config");
  }

  for (const pattern of readIgnoreFile(resolve(projectRoot, ".cwignore"))) {
    const root = extractRootPattern(pattern);
    if (root) ignoreSources.set(root, ".cwignore");
  }

  for (const pattern of readIgnoreFile(resolve(projectRoot, ".gitignore"))) {
    const root = extractRootPattern(pattern);
    if (root) ignoreSources.set(root, ".gitignore");
  }

  return ignoreSources;
}

function buildIgnoreNotes(languages: string[]): string[] {
  const notes: string[] = [];
  const languageSet = new Set(languages);

  if (languageSet.has("typescript") || languageSet.has("tsx") || languageSet.has("javascript") || languageSet.has("jsx")) {
    notes.push("JS/TS defaults exclude node_modules, dist, build, .next, and coverage.");
  }
  if (languageSet.has("python")) {
    notes.push("Python defaults exclude __pycache__, venv/.venv, and .tox.");
  }
  if (languageSet.size > 1) {
    notes.push("Mixed repos merge config.ignore, config.exclude, config.excludePatterns, .gitignore, and .cwignore.");
  }

  return notes;
}

export function buildProjectProfile(projectRoot: string, files: ProfileFileRecord[]): ProjectProfile {
  const languageCounts = new Map<string, number>();
  const rootCounts = new Map<string, number>();

  for (const file of files) {
    languageCounts.set(file.language, (languageCounts.get(file.language) ?? 0) + 1);

    const relativePath = file.path.startsWith(projectRoot)
      ? file.path.slice(projectRoot.length).replace(/^[/\\]+/, "")
      : file.path;
    const [root] = relativePath.replace(/\\/g, "/").split("/");
    const bucket = root && root.length > 0 ? root : ".";
    rootCounts.set(bucket, (rootCounts.get(bucket) ?? 0) + 1);
  }

  const ignoreSources = buildIgnoreSources(projectRoot);
  const topLevelDirs = readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== ".contextweave")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const suspiciousDirs = topLevelDirs
    .filter((dir) => SUSPICIOUS_DIRS.includes(dir))
    .map((dir) => ({
      path: dir,
      excluded: ignoreSources.has(dir),
    }));
  const presentTopLevel = new Set(topLevelDirs);

  return {
    languages: [...languageCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    activeRoots: [...rootCounts.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, 8),
    excludedRoots: [...ignoreSources.entries()]
      .map(([path, source]) => ({ path, source }))
      .sort((a, b) => {
        const aPresent = presentTopLevel.has(a.path) ? 0 : 1;
        const bPresent = presentTopLevel.has(b.path) ? 0 : 1;
        if (aPresent !== bPresent) return aPresent - bPresent;
        const aBuiltIn = a.source === "built-in" ? 1 : 0;
        const bBuiltIn = b.source === "built-in" ? 1 : 0;
        if (aBuiltIn !== bBuiltIn) return aBuiltIn - bBuiltIn;
        return a.path.localeCompare(b.path);
      }),
    suspiciousDirs,
    ignoreNotes: buildIgnoreNotes([...languageCounts.keys()]),
  };
}

export function formatProjectProfile(profile: ProjectProfile): string[] {
  const lines: string[] = [];
  const languageLine = profile.languages.length > 0
    ? profile.languages.map((item) => `${item.name} (${item.count})`).join(", ")
    : "none";
  lines.push("Project Profile");
  lines.push(`Languages: ${languageLine}`);

  if (profile.activeRoots.length > 0) {
    lines.push(
      `Active roots: ${profile.activeRoots.map((item) => `${item.path} (${item.count})`).join(", ")}`
    );
  }

  if (profile.excludedRoots.length > 0) {
    const topExcluded = profile.excludedRoots.slice(0, 8);
    lines.push(
      `Excluded roots: ${topExcluded.map((item) => `${item.path} [${item.source}]`).join(", ")}`
    );
  }

  if (profile.suspiciousDirs.length > 0) {
    lines.push(
      `Suspicious dirs: ${profile.suspiciousDirs.map((item) => `${item.path} (${item.excluded ? "excluded" : "present"})`).join(", ")}`
    );
  }

  for (const note of profile.ignoreNotes) {
    lines.push(`Ignore defaults: ${note}`);
  }

  return lines;
}
