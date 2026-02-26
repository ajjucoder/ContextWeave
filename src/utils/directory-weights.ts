const DOWNWEIGHT_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\/(tests?|__tests?__|spec)\//i, weight: 0.6 },
  { pattern: /\/(scripts?|bin)\//i, weight: 0.5 },
  { pattern: /\/(vendor|third_party|external)\//i, weight: 0.3 },
  { pattern: /\/(examples?|samples?|demo)\//i, weight: 0.5 },
  { pattern: /\/(docs?|documentation)\//i, weight: 0.4 },
  { pattern: /\/(mocks?|stubs?|fakes?|fixtures?)\//i, weight: 0.4 },
  { pattern: /\/(migrations?|seeds?)\//i, weight: 0.5 },
];

export function getDirectoryWeight(filePath: string): number {
  for (const { pattern, weight } of DOWNWEIGHT_PATTERNS) {
    if (pattern.test(filePath)) return weight;
  }
  return 1.0;
}
