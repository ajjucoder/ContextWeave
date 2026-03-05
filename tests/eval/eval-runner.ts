import Database from "better-sqlite3";
import { performance } from "node:perf_hooks";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { countTokens } from "../../src/utils/tokens.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { capsuleLogQueries } from "../../src/db/queries/capsule-log.js";
import { EVAL_CODEBASE_FIXTURES, type EvalCodebaseFixture, type EvalQueryFixture } from "./fixtures/index.js";
import { aggregateMetrics, computeQueryMetrics, type AggregateMetricOutput, type EvalMetricOptions, type QueryMetricOutput } from "./metrics.js";

export interface EvalQueryResult {
  id: string;
  query: string;
  expectedFiles: string[];
  expectedSymbols: string[];
  actualFiles: string[];
  actualSymbols: string[];
  metrics: QueryMetricOutput;
}

export interface EvalCodebaseResult {
  id: string;
  label: string;
  root: string;
  rawTokenCount: number;
  indexStats: {
    filesIndexed: number;
    symbolsFound: number;
  };
  metrics: AggregateMetricOutput;
  queries: EvalQueryResult[];
}

export interface EvalSuiteResult {
  generatedAt: string;
  metrics: AggregateMetricOutput;
  codebases: EvalCodebaseResult[];
}

export interface EvalRunOptions {
  fixtures?: EvalCodebaseFixture[];
  metricOptions?: EvalMetricOptions;
}

export interface EvalThresholds {
  precisionMin: number;
  recallMin: number;
  confidenceMin: number;
  tokenEfficiencyMin: number;
  p95LatencyMax: number;
}

export interface EvalBaseline {
  metrics: {
    precision: number;
    recall: number;
    avgConfidence: number;
    avgTokenEfficiency: number;
    p95LatencyMs: number;
  };
  codebases: Record<string, EvalBaseline["metrics"]>;
  updatedAt: string;
}

export const DEFAULT_EVAL_THRESHOLDS: EvalThresholds = {
  precisionMin: 0.15,
  recallMin: 0.7,
  confidenceMin: 0.65,
  tokenEfficiencyMin: 0.6,
  p95LatencyMax: 75,
};

export const DEFAULT_BASELINE: EvalBaseline = {
  metrics: {
    precision: 0.1,
    recall: 0.3,
    avgConfidence: 0.3,
    avgTokenEfficiency: 0.3,
    p95LatencyMs: 200,
  },
  codebases: {},
  updatedAt: new Date(0).toISOString(),
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function repositoryRoot(): string {
  return resolve(import.meta.dirname, "../..");
}

function resolveCodebaseRoot(codebase: EvalCodebaseFixture): string {
  return resolve(repositoryRoot(), codebase.root);
}

function computeRawTokenCount(db: Database.Database, absoluteRoot: string): number {
  const files = fileQueries(db).getAll();
  let total = 0;
  for (const file of files) {
    const absolutePath = resolve(absoluteRoot, file.path);
    if (!existsSync(absolutePath)) continue;
    total += countTokens(readFileSync(absolutePath, "utf8"));
  }
  return total;
}

function queryToResult(
  fixture: EvalQueryFixture,
  latestLog: { filesIncluded: string[]; symbolsIncluded: string[] },
  rawTokenCount: number,
  coverageConfidence: number,
  latencyMs: number,
  tokensUsed: number,
  options?: EvalMetricOptions
): EvalQueryResult {
  const expectedSymbols = fixture.expectedSymbols ?? [];
  const actualFiles = unique(latestLog.filesIncluded);
  const actualSymbols = unique(latestLog.symbolsIncluded);
  const metrics = computeQueryMetrics({
    expectedFiles: fixture.expectedFiles,
    expectedSymbols,
    actualFiles,
    actualSymbols,
    coverageConfidence,
    latencyMs,
    tokensUsed,
    rawTokenCount,
    options,
  });

  return {
    id: fixture.id,
    query: fixture.query,
    expectedFiles: fixture.expectedFiles,
    expectedSymbols,
    actualFiles,
    actualSymbols,
    metrics,
  };
}

async function runCodebaseEval(
  fixture: EvalCodebaseFixture,
  metricOptions?: EvalMetricOptions
): Promise<EvalCodebaseResult> {
  const absoluteRoot = resolveCodebaseRoot(fixture);
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  createSchema(db);
  runMigrations(db);
  const indexStats = await indexProject(db, absoluteRoot);
  updateCentralityScores(db);

  const rawTokenCount = computeRawTokenCount(db, absoluteRoot);
  const logs = capsuleLogQueries(db);
  const queryResults: EvalQueryResult[] = [];

  for (const queryFixture of fixture.queries) {
    const tokenBudget = queryFixture.tokenBudget ?? fixture.defaultTokenBudget;
    const start = performance.now();
    const capsule = generateCapsule(db, {
      query: queryFixture.query,
      tokenBudget,
      projectRoot: absoluteRoot,
    });
    const latencyMs = performance.now() - start;

    const latestLog = logs.getLatest();
    if (!latestLog) {
      throw new Error(`Missing capsule log entry for query "${queryFixture.query}" on ${fixture.id}`);
    }

    queryResults.push(
      queryToResult(
        queryFixture,
        {
          filesIncluded: latestLog.filesIncluded,
          symbolsIncluded: latestLog.symbolsIncluded,
        },
        rawTokenCount,
        capsule.metadata.quality.coverageConfidence,
        latencyMs,
        capsule.metadata.tokensUsed,
        metricOptions
      )
    );
  }

  db.close();

  return {
    id: fixture.id,
    label: fixture.label,
    root: fixture.root,
    rawTokenCount,
    indexStats: {
      filesIndexed: indexStats.filesIndexed,
      symbolsFound: indexStats.symbolsFound,
    },
    metrics: aggregateMetrics(queryResults.map((q) => q.metrics)),
    queries: queryResults,
  };
}

export async function runEvalSuite(options: EvalRunOptions = {}): Promise<EvalSuiteResult> {
  const fixtures = options.fixtures ?? EVAL_CODEBASE_FIXTURES;
  const codebases: EvalCodebaseResult[] = [];

  for (const fixture of fixtures) {
    codebases.push(await runCodebaseEval(fixture, options.metricOptions));
  }

  return {
    generatedAt: new Date().toISOString(),
    metrics: aggregateMetrics(codebases.flatMap((codebase) => codebase.queries.map((query) => query.metrics))),
    codebases,
  };
}

export function summarizeFailures(
  result: EvalSuiteResult,
  thresholds: EvalThresholds = DEFAULT_EVAL_THRESHOLDS
): string[] {
  const failures: string[] = [];
  if (result.metrics.precision < thresholds.precisionMin) {
    failures.push(`precision ${result.metrics.precision.toFixed(3)} < ${thresholds.precisionMin.toFixed(3)}`);
  }
  if (result.metrics.recall < thresholds.recallMin) {
    failures.push(`recall ${result.metrics.recall.toFixed(3)} < ${thresholds.recallMin.toFixed(3)}`);
  }
  if (result.metrics.avgConfidence < thresholds.confidenceMin) {
    failures.push(`avgConfidence ${result.metrics.avgConfidence.toFixed(3)} < ${thresholds.confidenceMin.toFixed(3)}`);
  }
  if (result.metrics.avgTokenEfficiency < thresholds.tokenEfficiencyMin) {
    failures.push(
      `avgTokenEfficiency ${result.metrics.avgTokenEfficiency.toFixed(3)} < ${thresholds.tokenEfficiencyMin.toFixed(3)}`
    );
  }
  if (result.metrics.p95LatencyMs > thresholds.p95LatencyMax) {
    failures.push(`p95LatencyMs ${result.metrics.p95LatencyMs.toFixed(1)} > ${thresholds.p95LatencyMax.toFixed(1)}`);
  }
  return failures;
}

export function toBaseline(result: EvalSuiteResult): EvalBaseline {
  const codebases: Record<string, EvalBaseline["metrics"]> = {};
  for (const codebase of result.codebases) {
    codebases[codebase.id] = {
      precision: codebase.metrics.precision,
      recall: codebase.metrics.recall,
      avgConfidence: codebase.metrics.avgConfidence,
      avgTokenEfficiency: codebase.metrics.avgTokenEfficiency,
      p95LatencyMs: codebase.metrics.p95LatencyMs,
    };
  }

  return {
    metrics: {
      precision: result.metrics.precision,
      recall: result.metrics.recall,
      avgConfidence: result.metrics.avgConfidence,
      avgTokenEfficiency: result.metrics.avgTokenEfficiency,
      p95LatencyMs: result.metrics.p95LatencyMs,
    },
    codebases,
    updatedAt: result.generatedAt,
  };
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printReport(result: EvalSuiteResult): void {
  console.log("\nContextWeave Eval Report");
  console.log("=======================");
  console.log(`Generated: ${result.generatedAt}`);
  console.log(`Codebases: ${result.codebases.length}`);
  console.log(`Queries: ${result.metrics.queryCount}`);
  console.log();

  console.log("Overall:");
  console.log(`  Precision:       ${formatPct(result.metrics.precision)}`);
  console.log(`  Recall:          ${formatPct(result.metrics.recall)}`);
  console.log(`  Avg confidence:  ${formatPct(result.metrics.avgConfidence)}`);
  console.log(`  Token efficiency:${formatPct(result.metrics.avgTokenEfficiency)}`);
  console.log(`  Avg latency:     ${result.metrics.avgLatencyMs.toFixed(1)}ms`);
  console.log(`  P95 latency:     ${result.metrics.p95LatencyMs.toFixed(1)}ms`);
  console.log();

  for (const codebase of result.codebases) {
    console.log(`${codebase.label} (${codebase.id})`);
    console.log(`  Root:            ${codebase.root}`);
    console.log(`  Indexed:         ${codebase.indexStats.filesIndexed} files, ${codebase.indexStats.symbolsFound} symbols`);
    console.log(`  Raw tokens:      ${codebase.rawTokenCount}`);
    console.log(`  Precision:       ${formatPct(codebase.metrics.precision)}`);
    console.log(`  Recall:          ${formatPct(codebase.metrics.recall)}`);
    console.log(`  Avg confidence:  ${formatPct(codebase.metrics.avgConfidence)}`);
    console.log(`  Token efficiency:${formatPct(codebase.metrics.avgTokenEfficiency)}`);
    console.log(`  Avg latency:     ${codebase.metrics.avgLatencyMs.toFixed(1)}ms`);
    console.log(`  P95 latency:     ${codebase.metrics.p95LatencyMs.toFixed(1)}ms`);
    console.log();
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has("--json");
  const shouldAssert = args.has("--assert");

  const result = await runEvalSuite();

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  if (shouldAssert) {
    const failures = summarizeFailures(result);
    if (failures.length > 0) {
      console.error("\nEval threshold failures:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
