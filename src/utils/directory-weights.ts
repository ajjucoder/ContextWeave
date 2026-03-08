export interface DirectoryWeightOverrides {
  primaryDirs?: string[];
  archiveDirs?: string[];
}

const DOWNWEIGHT_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  // Legacy, archive, old, prototype — standalone path segments
  { pattern: /(^|[/\\])(legacy|archive|old|prototype)[/\\]/i, weight: 0.15 },
  // Directories with _legacy, _demo, _old, _prototype, _archive suffix or infix
  { pattern: /_(legacy|demo|old|prototype|archive)[_/\\]/i, weight: 0.15 },
  // Static and public assets
  { pattern: /(^|[/\\])src[/\\]main[/\\]resources[/\\]static([/\\]|$)/i, weight: 0.2 },
  { pattern: /(^|[/\\])(assets|public|dist)[/\\]/i, weight: 0.22 },
  // Vendor / third-party
  { pattern: /(^|[/\\])(vendor|third_party|external)[/\\]/i, weight: 0.3 },
  // Template directories that often carry admin/vendor noise
  { pattern: /(^|[/\\])templates[/\\](admin|vendor)([/\\]|$)/i, weight: 0.25 },
  // Examples, samples, demo standalone dirs
  { pattern: /(^|[/\\])(examples?|samples?|demo)[/\\]/i, weight: 0.2 },
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

const UPWEIGHT_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /(^|[/\\])src[/\\]main[/\\]java([/\\]|$)/i, weight: 1.8 },
  { pattern: /(^|[/\\])src[/\\](app|lib|core)([/\\]|$)/i, weight: 1.6 },
  { pattern: /(^|[/\\])(packages|libs)[/\\]/i, weight: 1.6 },
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
}

function normalizeDirPattern(pattern: string): string {
  return normalizePath(pattern).replace(/^\/+/, "").replace(/\/+$/, "");
}

function matchesConfiguredDir(filePath: string, patterns: readonly string[]): boolean {
  const normalizedPath = normalizePath(filePath);
  return patterns
    .map(normalizeDirPattern)
    .filter((pattern) => pattern.length > 0)
    .some((pattern) => normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`));
}

export function getDirectoryWeight(filePath: string, overrides: DirectoryWeightOverrides = {}): number {
  if (matchesConfiguredDir(filePath, overrides.archiveDirs ?? [])) {
    return 0.15;
  }

  for (const { pattern, weight } of DOWNWEIGHT_PATTERNS) {
    if (pattern.test(filePath)) return weight;
  }

  let weight = 1.0;
  if (matchesConfiguredDir(filePath, overrides.primaryDirs ?? [])) {
    weight = Math.max(weight, 1.8);
  }

  for (const { pattern, weight: boostedWeight } of UPWEIGHT_PATTERNS) {
    if (pattern.test(filePath)) {
      weight = Math.max(weight, boostedWeight);
    }
  }

  return weight;
}
