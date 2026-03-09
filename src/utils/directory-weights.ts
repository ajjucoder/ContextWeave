import { loadConfig, type ProjectConfig } from "./config.js";

const DOWNWEIGHT_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  // Legacy, archive, old, prototype — standalone path segments
  { pattern: /(^|[/\\])(legacy|archive|old|prototype)[/\\]/i, weight: 0.15 },
  // Directories with _legacy, _demo, _old, _prototype, _archive suffix or infix
  { pattern: /_(legacy|demo|old|prototype|archive)[_/\\]/i, weight: 0.15 },
  // Vendor / third-party
  { pattern: /(^|[/\\])(vendor|third_party|external)[/\\]/i, weight: 0.3 },
  // Examples, samples, demo standalone dirs
  { pattern: /(^|[/\\])(examples|samples?|demo)[/\\]/i, weight: 0.2 },
  // Tests
  { pattern: /(^|[/\\])(tests?|__tests?__|spec)[/\\]/i, weight: 0.6 },
  // Docs
  { pattern: /(^|[/\\])(docs?|documentation)[/\\]/i, weight: 0.4 },
  // Scripts / bin
  { pattern: /(^|[/\\])(scripts?|bin)[/\\]/i, weight: 0.5 },
  // Mocks / fixtures
  { pattern: /(^|[/\\])(mocks?|stubs?|fakes?|fixtures?)[/\\]/i, weight: 0.4 },
  // Migrations / seeds
  { pattern: /(^|[/\\])(migrations?|seeds?)[/\\]/i, weight: 0.5 },
];

const PREFIX_DOWNWEIGHTS: Array<{ prefix: string; weight: number }> = [
  { prefix: "src/main/resources/static", weight: 0.2 },
  { prefix: "assets", weight: 0.3 },
  { prefix: "public", weight: 0.3 },
  { prefix: "dist", weight: 0.1 },
  { prefix: "build", weight: 0.1 },
  { prefix: "out", weight: 0.1 },
  { prefix: ".next", weight: 0.1 },
];

const PREFIX_UPWEIGHTS: Array<{ prefix: string; weight: number }> = [
  { prefix: "src/main/java", weight: 1.5 },
  { prefix: "src/app", weight: 1.5 },
  { prefix: "src/lib", weight: 1.5 },
  { prefix: "src/core", weight: 1.5 },
  { prefix: "packages", weight: 1.3 },
  { prefix: "libs", weight: 1.3 },
];

const configCache = new Map<string, Pick<ProjectConfig, "primaryDirs" | "archiveDirs">>();

function normalizeDirectoryPath(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function matchesPrefix(filePath: string, prefix: string): boolean {
  const normalizedPath = normalizeDirectoryPath(filePath);
  const normalizedPrefix = normalizeDirectoryPath(prefix);
  return normalizedPrefix.length > 0 && (normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`));
}

function getConfigOverrides(projectRoot?: string): Pick<ProjectConfig, "primaryDirs" | "archiveDirs"> {
  if (!projectRoot) {
    return { primaryDirs: [], archiveDirs: [] };
  }
  const cached = configCache.get(projectRoot);
  if (cached) return cached;

  const config = loadConfig(projectRoot);
  const overrides = {
    primaryDirs: config.primaryDirs,
    archiveDirs: config.archiveDirs,
  };
  configCache.set(projectRoot, overrides);
  return overrides;
}

export function getDirectoryWeight(filePath: string, projectRoot?: string): number {
  const normalizedPath = normalizeDirectoryPath(filePath);
  const { primaryDirs, archiveDirs } = getConfigOverrides(projectRoot);
  let downweight = 1.0;

  for (const { pattern, weight } of DOWNWEIGHT_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      downweight = Math.min(downweight, weight);
    }
  }

  for (const { prefix, weight } of PREFIX_DOWNWEIGHTS) {
    if (matchesPrefix(normalizedPath, prefix)) {
      downweight = Math.min(downweight, weight);
    }
  }

  for (const archiveDir of archiveDirs) {
    if (matchesPrefix(normalizedPath, archiveDir)) {
      downweight = Math.min(downweight, 0.1);
    }
  }

  if (downweight < 1.0) {
    return downweight;
  }

  let upweight = 1.0;
  for (const { prefix, weight } of PREFIX_UPWEIGHTS) {
    if (matchesPrefix(normalizedPath, prefix)) {
      upweight = Math.max(upweight, weight);
    }
  }

  for (const primaryDir of primaryDirs) {
    if (matchesPrefix(normalizedPath, primaryDir)) {
      upweight = Math.max(upweight, 1.5);
    }
  }

  return upweight;
}
