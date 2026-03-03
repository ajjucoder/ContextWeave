const DOWNWEIGHT_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  // Legacy, archive, old, prototype — standalone path segments
  { pattern: /(^|[/\\])(legacy|archive|old|prototype)[/\\]/i, weight: 0.15 },
  // Directories with _legacy, _demo, _old, _prototype, _archive suffix or infix
  { pattern: /_(legacy|demo|old|prototype|archive)[_/\\]/i, weight: 0.15 },
  // Vendor / third-party
  { pattern: /(^|[/\\])(vendor|third_party|external)[/\\]/i, weight: 0.3 },
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

export function getDirectoryWeight(filePath: string): number {
  for (const { pattern, weight } of DOWNWEIGHT_PATTERNS) {
    if (pattern.test(filePath)) return weight;
  }
  return 1.0;
}
