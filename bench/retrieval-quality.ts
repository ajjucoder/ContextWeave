import Database from "better-sqlite3";
import { createSchema } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrations.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";
import { resolve } from "node:path";

interface BenchmarkQuery {
  name: string;
  query: string;
  expectedFiles: string[];
  expectedSymbols: string[];
  mustNotInclude?: string[];
  mode: "narrow" | "broad";
  minUtilization: number;
}

interface QueryResult {
  name: string;
  precision: number;
  recall: number;
  f1: number;
  utilization: number;
  confidence: number;
  confidenceCalibrated: boolean;
  passed: boolean;
  failures: string[];
}

const BENCHMARK_QUERIES: BenchmarkQuery[] = [
  {
    name: "narrow: exact symbol lookup",
    query: "generateCapsule",
    expectedFiles: ["capsule/generator"],
    expectedSymbols: ["generateCapsule"],
    mode: "narrow",
    minUtilization: 0.3,
  },
  {
    name: "narrow: pivot scorer",
    query: "scorePivotRelevance",
    expectedFiles: ["capsule/pivot-scorer"],
    expectedSymbols: ["scorePivotRelevance"],
    mode: "narrow",
    minUtilization: 0.3,
  },
  {
    name: "narrow: hybrid ranker",
    query: "hybridSearch",
    expectedFiles: ["hybrid-ranker"],
    expectedSymbols: ["hybridSearch"],
    mode: "narrow",
    minUtilization: 0.3,
  },
  {
    name: "narrow: confidence computation",
    query: "computeCoverageConfidence",
    expectedFiles: ["capsule/confidence"],
    expectedSymbols: ["computeCoverageConfidence"],
    mode: "narrow",
    minUtilization: 0.3,
  },
  {
    name: "narrow: pattern detection",
    query: "detectPatterns",
    expectedFiles: ["pattern-detector"],
    expectedSymbols: ["detectPatterns"],
    mode: "narrow",
    minUtilization: 0.3,
  },
  {
    name: "broad: capsule pipeline architecture",
    query: "how does the capsule pipeline work end to end",
    expectedFiles: ["capsule/generator", "capsule/packer", "capsule/formatter"],
    expectedSymbols: ["generateCapsule", "packNodes"],
    mode: "broad",
    minUtilization: 0.4,
  },
  {
    name: "broad: indexing and parsing flow",
    query: "how does file indexing and AST parsing connect",
    expectedFiles: ["core/indexer", "core/parser"],
    expectedSymbols: ["indexProject", "parseFile"],
    mode: "broad",
    minUtilization: 0.4,
  },
  {
    name: "broad: search and ranking",
    query: "how does hybrid search rank results with BM25 and vectors",
    expectedFiles: ["hybrid-ranker"],
    expectedSymbols: ["hybridSearch"],
    mode: "broad",
    minUtilization: 0.4,
  },
  {
    name: "broad: memory and observations",
    query: "cross-session memory observations recall",
    expectedFiles: ["memory/"],
    expectedSymbols: [],
    mode: "broad",
    minUtilization: 0.3,
  },
  {
    name: "broad: MCP tool registration",
    query: "how are MCP tools registered and exposed",
    expectedFiles: ["mcp/"],
    expectedSymbols: [],
    mode: "broad",
    minUtilization: 0.3,
  },
];

function matchesFragment(haystack: string, fragment: string): boolean {
  return haystack.includes(fragment);
}

function runBenchmark(db: Database.Database, projectRoot: string): QueryResult[] {
  const results: QueryResult[] = [];

  for (const query of BENCHMARK_QUERIES) {
    const capsule = generateCapsule(db, {
      query: query.query,
      tokenBudget: 8000,
      mode: query.mode === "narrow" ? "feature" : "review",
      projectRoot,
    });

    const filesIncluded = capsule.metadata.filesIncluded;
    const content = capsule.content;
    const utilization = capsule.metadata.tokensUsed / capsule.metadata.tokenBudget;
    const confidence = capsule.metadata.quality.coverageConfidence;
    const failures: string[] = [];

    const fileHits = query.expectedFiles.filter((expected) =>
      filesIncluded.some((f) => matchesFragment(f, expected)) || matchesFragment(content, expected)
    );
    const symbolHits = query.expectedSymbols.filter((expected) =>
      matchesFragment(content, expected)
    );

    const expectedTotal = query.expectedFiles.length + query.expectedSymbols.length;
    const hitTotal = fileHits.length + symbolHits.length;
    const recall = expectedTotal > 0 ? hitTotal / expectedTotal : 1;

    const mustNotViolations = (query.mustNotInclude ?? []).filter((banned) =>
      matchesFragment(content, banned) || filesIncluded.some((f) => matchesFragment(f, banned))
    );

    const totalReturned = filesIncluded.length + capsule.metadata.symbolCount;
    const truePositives = hitTotal;
    const precision = totalReturned > 0 ? Math.min(1, truePositives / Math.max(1, totalReturned * 0.3)) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    const confidenceCalibrated = !(utilization < 0.3 && confidence > 0.7);

    if (utilization < query.minUtilization) {
      failures.push(`utilization ${(utilization * 100).toFixed(1)}% < min ${(query.minUtilization * 100).toFixed(1)}%`);
    }
    if (recall < 0.5) {
      failures.push(`recall ${(recall * 100).toFixed(1)}% < 50%`);
    }
    if (mustNotViolations.length > 0) {
      failures.push(`must-not-include violations: ${mustNotViolations.join(", ")}`);
    }
    if (!confidenceCalibrated) {
      failures.push(`confidence ${(confidence * 100).toFixed(1)}% too high for utilization ${(utilization * 100).toFixed(1)}%`);
    }

    for (const expected of query.expectedFiles) {
      if (!fileHits.includes(expected)) {
        failures.push(`missing expected file: ${expected}`);
      }
    }
    for (const expected of query.expectedSymbols) {
      if (!symbolHits.includes(expected)) {
        failures.push(`missing expected symbol: ${expected}`);
      }
    }

    results.push({
      name: query.name,
      precision,
      recall,
      f1,
      utilization,
      confidence,
      confidenceCalibrated,
      passed: failures.length === 0,
      failures,
    });
  }

  return results;
}

function formatResults(results: QueryResult[]): string {
  const lines: string[] = ["ContextWeave Retrieval Quality Benchmark", "=".repeat(45), ""];

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    lines.push(`[${status}] ${result.name}`);
    lines.push(`  Precision: ${(result.precision * 100).toFixed(1)}%  Recall: ${(result.recall * 100).toFixed(1)}%  F1: ${(result.f1 * 100).toFixed(1)}%`);
    lines.push(`  Utilization: ${(result.utilization * 100).toFixed(1)}%  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        lines.push(`  ! ${failure}`);
      }
    }
    lines.push("");
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const avgPrecision = results.reduce((sum, r) => sum + r.precision, 0) / total;
  const avgRecall = results.reduce((sum, r) => sum + r.recall, 0) / total;
  const avgF1 = results.reduce((sum, r) => sum + r.f1, 0) / total;
  const avgUtilization = results.reduce((sum, r) => sum + r.utilization, 0) / total;

  lines.push("=".repeat(45));
  lines.push(`Passed: ${passed}/${total}`);
  lines.push(`Avg Precision: ${(avgPrecision * 100).toFixed(1)}%`);
  lines.push(`Avg Recall:    ${(avgRecall * 100).toFixed(1)}%`);
  lines.push(`Avg F1:        ${(avgF1 * 100).toFixed(1)}%`);
  lines.push(`Avg Utilization: ${(avgUtilization * 100).toFixed(1)}%`);

  return lines.join("\n");
}

async function main(): Promise<void> {
  const projectDir = process.argv[2];
  if (!projectDir) {
    console.error("Usage: npx tsx bench/retrieval-quality.ts <projectDir>");
    process.exit(1);
  }

  const projectRoot = resolve(projectDir);
  console.log(`Indexing ${projectRoot}...`);

  const db = new Database(":memory:");
  createSchema(db);
  runMigrations(db);

  await indexProject(db, projectRoot);
  updateCentralityScores(db);

  console.log("Running benchmark queries...\n");
  const results = runBenchmark(db, projectRoot);
  console.log(formatResults(results));

  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
