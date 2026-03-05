export interface EvalMetricOptions {
  fileTopK?: number;
  symbolTopK?: number;
}

export interface QueryMetricInput {
  expectedFiles: string[];
  expectedSymbols: string[];
  actualFiles: string[];
  actualSymbols: string[];
  latencyMs: number;
  tokensUsed: number;
  rawTokenCount: number;
  coverageConfidence: number;
  options?: EvalMetricOptions;
}

export interface QueryMetricOutput {
  filePrecision: number;
  fileRecall: number;
  symbolPrecision: number;
  symbolRecall: number;
  precision: number;
  recall: number;
  tokenEfficiency: number;
  latencyMs: number;
  coverageConfidence: number;
  matchedFiles: string[];
  matchedSymbols: string[];
  consideredFiles: string[];
  consideredSymbols: string[];
}

export interface AggregateMetricOutput {
  queryCount: number;
  precision: number;
  recall: number;
  avgConfidence: number;
  avgTokenEfficiency: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

interface HitMetrics {
  precision: number;
  recall: number;
  matchedExpected: string[];
  consideredActual: string[];
}

const DEFAULT_TOP_K = {
  files: 3,
  symbols: 3,
};

function clamp(value: number, min = 0, max = 1): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").trim().toLowerCase();
}

function normalizeSymbol(name: string): string {
  return name.trim().toLowerCase();
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function pathMatches(expectedSuffix: string, actualPath: string): boolean {
  const normalizedExpected = normalizePath(expectedSuffix);
  const normalizedActual = normalizePath(actualPath);
  return normalizedActual === normalizedExpected || normalizedActual.endsWith(`/${normalizedExpected}`);
}

function symbolMatches(expected: string, actual: string): boolean {
  return normalizeSymbol(expected) === normalizeSymbol(actual);
}

function computeHitMetrics(
  expectedRaw: string[],
  actualRaw: string[],
  matcher: (expected: string, actual: string) => boolean
): HitMetrics {
  const expected = uniq(expectedRaw);
  const actual = uniq(actualRaw);

  const matchedExpected: string[] = [];
  for (const expectedValue of expected) {
    if (actual.some((actualValue) => matcher(expectedValue, actualValue))) {
      matchedExpected.push(expectedValue);
    }
  }

  const matchedActual = actual.filter((actualValue) =>
    expected.some((expectedValue) => matcher(expectedValue, actualValue))
  );

  const precision = actual.length === 0
    ? (expected.length === 0 ? 1 : 0)
    : matchedActual.length / actual.length;
  const recall = expected.length === 0 ? 1 : matchedExpected.length / expected.length;

  return {
    precision,
    recall,
    matchedExpected,
    consideredActual: actual,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function computeTokenEfficiency(tokensUsed: number, rawTokenCount: number): number {
  if (rawTokenCount <= 0) return 0;
  return clamp(1 - tokensUsed / rawTokenCount, 0, 1);
}

export function computeQueryMetrics(input: QueryMetricInput): QueryMetricOutput {
  const fileTopK = input.options?.fileTopK ?? DEFAULT_TOP_K.files;
  const symbolTopK = input.options?.symbolTopK ?? DEFAULT_TOP_K.symbols;

  const consideredFiles = input.actualFiles.slice(0, fileTopK);
  const consideredSymbols = input.actualSymbols.slice(0, symbolTopK);

  const fileMetrics = computeHitMetrics(input.expectedFiles, consideredFiles, pathMatches);
  const symbolMetrics = computeHitMetrics(input.expectedSymbols, consideredSymbols, symbolMatches);

  const dimensions: Array<{ precision: number; recall: number }> = [];
  if (input.expectedFiles.length > 0) {
    dimensions.push({ precision: fileMetrics.precision, recall: fileMetrics.recall });
  }
  if (input.expectedSymbols.length > 0) {
    dimensions.push({ precision: symbolMetrics.precision, recall: symbolMetrics.recall });
  }

  const precision = dimensions.length > 0 ? average(dimensions.map((d) => d.precision)) : 1;
  const recall = dimensions.length > 0 ? average(dimensions.map((d) => d.recall)) : 1;

  return {
    filePrecision: fileMetrics.precision,
    fileRecall: fileMetrics.recall,
    symbolPrecision: symbolMetrics.precision,
    symbolRecall: symbolMetrics.recall,
    precision,
    recall,
    tokenEfficiency: computeTokenEfficiency(input.tokensUsed, input.rawTokenCount),
    latencyMs: input.latencyMs,
    coverageConfidence: input.coverageConfidence,
    matchedFiles: fileMetrics.matchedExpected,
    matchedSymbols: symbolMetrics.matchedExpected,
    consideredFiles: fileMetrics.consideredActual,
    consideredSymbols: symbolMetrics.consideredActual,
  };
}

export function aggregateMetrics(queries: QueryMetricOutput[]): AggregateMetricOutput {
  return {
    queryCount: queries.length,
    precision: average(queries.map((q) => q.precision)),
    recall: average(queries.map((q) => q.recall)),
    avgConfidence: average(queries.map((q) => q.coverageConfidence)),
    avgTokenEfficiency: average(queries.map((q) => q.tokenEfficiency)),
    avgLatencyMs: average(queries.map((q) => q.latencyMs)),
    p95LatencyMs: percentile(queries.map((q) => q.latencyMs), 0.95),
  };
}
