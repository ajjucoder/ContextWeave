import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const DEFAULT_BASELINE: QualityBaseline = {
  narrow: { avgConfidence: 0.7, minConfidence: 0.6 },
  broad: { avgConfidence: 0.4, minConfidence: 0.3 },
  task: { avgConfidence: 0.35, minConfidence: 0.25 },
  updatedAt: new Date(0).toISOString(),
};

function loadBaseline(): QualityBaseline {
  if (existsSync(BASELINE_PATH)) {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as QualityBaseline;
  }

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(DEFAULT_BASELINE, null, 2) + "\n");
  return DEFAULT_BASELINE;
}

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

afterAll(() => db?.close());

function measureClass(queries: readonly string[], tokenBudget: number): QueryClassBaseline {
  const confidences = queries.map((query) =>
    generateCapsule(db, { query, tokenBudget }).metadata.quality.coverageConfidence
  );
  const avgConfidence = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  const minConfidence = Math.min(...confidences);
  return { avgConfidence, minConfidence };
}

describe("quality ratchet - no regression allowed", () => {
  const baseline = loadBaseline();

  it("narrow queries don't regress below baseline", () => {
    const current = measureClass(NARROW_QUERIES, NARROW_TOKEN_BUDGET);
    expect(current.avgConfidence).toBeGreaterThanOrEqual(baseline.narrow.avgConfidence);
    expect(current.minConfidence).toBeGreaterThanOrEqual(baseline.narrow.minConfidence);
  });

  it("broad queries don't regress below baseline", () => {
    const current = measureClass(BROAD_QUERIES, BROAD_TOKEN_BUDGET);
    expect(current.avgConfidence).toBeGreaterThanOrEqual(baseline.broad.avgConfidence);
    expect(current.minConfidence).toBeGreaterThanOrEqual(baseline.broad.minConfidence);
  });

  it("task queries don't regress below baseline", () => {
    const current = measureClass(TASK_QUERIES, TASK_TOKEN_BUDGET);
    expect(current.avgConfidence).toBeGreaterThanOrEqual(baseline.task.avgConfidence);
    expect(current.minConfidence).toBeGreaterThanOrEqual(baseline.task.minConfidence);
  });
});
