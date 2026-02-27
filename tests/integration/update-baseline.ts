import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import {
  NARROW_QUERIES,
  BROAD_QUERIES,
  TASK_QUERIES,
  NARROW_TOKEN_BUDGET,
  BROAD_TOKEN_BUDGET,
  TASK_TOKEN_BUDGET,
} from "./task-query-fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, "../../.contextweave/quality-baseline.json");

interface QueryClassBaseline {
  avgConfidence: number;
  minConfidence: number;
}

interface QualityBaseline {
  narrow: QueryClassBaseline;
  broad: QueryClassBaseline;
  task: QueryClassBaseline;
  updatedAt: string;
}

function measureClass(
  db: Database.Database,
  queries: readonly string[],
  tokenBudget: number
): QueryClassBaseline {
  const confidences = queries.map((query) =>
    generateCapsule(db, { query, tokenBudget }).metadata.quality.coverageConfidence
  );

  return {
    avgConfidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
    minConfidence: Math.min(...confidences),
  };
}

function loadExistingBaseline(): QualityBaseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as QualityBaseline;
}

function ratchet(existing: QueryClassBaseline | undefined, current: QueryClassBaseline): QueryClassBaseline {
  if (!existing) return current;
  return {
    avgConfidence: Math.max(existing.avgConfidence, current.avgConfidence),
    minConfidence: Math.max(existing.minConfidence, current.minConfidence),
  };
}

async function main(): Promise<void> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  createSchema(db);
  runMigrations(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);

  const current: QualityBaseline = {
    narrow: measureClass(db, NARROW_QUERIES, NARROW_TOKEN_BUDGET),
    broad: measureClass(db, BROAD_QUERIES, BROAD_TOKEN_BUDGET),
    task: measureClass(db, TASK_QUERIES, TASK_TOKEN_BUDGET),
    updatedAt: new Date().toISOString(),
  };

  db.close();

  const existing = loadExistingBaseline();
  const next: QualityBaseline = {
    narrow: ratchet(existing?.narrow, current.narrow),
    broad: ratchet(existing?.broad, current.broad),
    task: ratchet(existing?.task, current.task),
    updatedAt: current.updatedAt,
  };

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");

  console.log(`Updated baseline: ${BASELINE_PATH}`);
  console.log(
    JSON.stringify(
      {
        existing,
        current,
        next,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
