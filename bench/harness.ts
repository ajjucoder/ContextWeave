import { resolve } from "node:path";
import { mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { getDb, closeDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";
import { countTokens } from "../src/utils/tokens.js";
import { symbolQueries } from "../src/db/queries/symbols.js";
import { edgeQueries } from "../src/db/queries/edges.js";

const FIXTURE_PATH = resolve(import.meta.dirname, "scenarios/small-project/src");
const TEMP_DB_PATH = resolve(import.meta.dirname, ".bench-tmp.db");

const QUERIES = [
  "authentication handler",
  "User type definition",
  "hash password",
  "validate token",
];

interface QueryResult {
  query: string;
  tokens: number;
  reduction: number;
  symbols: number;
  latency: number;
}

async function getTotalRawTokens(): Promise<number> {
  let total = 0;
  for await (const entry of glob("**/*.ts", { cwd: FIXTURE_PATH })) {
    const content = readFileSync(resolve(FIXTURE_PATH, entry), "utf-8");
    total += countTokens(content);
  }
  return total;
}

function pad(s: string, width: number, right = false): string {
  if (right) return s.padStart(width);
  return s.padEnd(width);
}

function printReport(results: QueryResult[], totalRawTokens: number, filesIndexed: number, symbolCount: number, edgeCount: number): void {
  const avgReduction = results.reduce((sum, r) => sum + r.reduction, 0) / results.length;

  console.log("\nContextWeave Benchmark Report");
  console.log("=============================");
  console.log(`Fixture: small-project (${filesIndexed} files, ${symbolCount} symbols, ${edgeCount} edges)`);
  console.log(`Total raw tokens: ${totalRawTokens}`);
  console.log();

  const col1 = 24;
  const col2 = 7;
  const col3 = 10;
  const col4 = 8;
  const col5 = 8;

  console.log(
    `${pad("Query", col1)} | ${pad("Tokens", col2, true)} | ${pad("Reduction", col3, true)} | ${pad("Symbols", col4, true)} | ${pad("Latency", col5, true)}`
  );
  console.log(`${"-".repeat(col1)}-|-${"-".repeat(col2)}-|-${"-".repeat(col3)}-|-${"-".repeat(col4)}-|-${"-".repeat(col5)}`);

  for (const r of results) {
    console.log(
      `${pad(r.query, col1)} | ${pad(String(r.tokens), col2, true)} | ${pad(r.reduction.toFixed(1) + "%", col3, true)} | ${pad(String(r.symbols), col4, true)} | ${pad(r.latency + "ms", col5, true)}`
    );
  }

  console.log();
  console.log(`Average reduction: ${avgReduction.toFixed(1)}%`);
  const passed = avgReduction >= 65;
  console.log(`Target: >= 65% ${passed ? "✓" : "✗"}`);
  console.log();

  if (!passed) {
    console.error(`FAIL: average token reduction ${avgReduction.toFixed(1)}% is below the 65% target`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (existsSync(TEMP_DB_PATH)) rmSync(TEMP_DB_PATH);

  mkdirSync(resolve(import.meta.dirname), { recursive: true });

  const db = getDb(TEMP_DB_PATH);
  runMigrations(db);

  const { filesIndexed, symbolsFound } = await indexProject(db, FIXTURE_PATH);
  updateCentralityScores(db);

  const totalRawTokens = await getTotalRawTokens();
  const edgeCount = edgeQueries(db).getAll().length;
  const allSymbols = symbolQueries(db).getAll();

  const results: QueryResult[] = [];

  for (const query of QUERIES) {
    const tokenBudget = Math.min(4000, Math.floor(totalRawTokens * 0.4));
    const start = Date.now();
    const capsule = generateCapsule(db, { query, tokenBudget });
    const latency = Date.now() - start;

    const tokens = capsule.metadata.tokensUsed;
    const reduction = totalRawTokens > 0 ? ((1 - tokens / totalRawTokens) * 100) : 0;

    results.push({
      query,
      tokens,
      reduction,
      symbols: capsule.metadata.symbolCount,
      latency,
    });
  }

  closeDb();

  if (existsSync(TEMP_DB_PATH)) rmSync(TEMP_DB_PATH);

  printReport(results, totalRawTokens, filesIndexed, allSymbols.length, edgeCount);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
