import { createSchema } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrations.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
createSchema(db);
runMigrations(db);
await indexProject(db, resolve(__dirname, "../src"));
updateCentralityScores(db);

const NARROW = ["generateCapsule", "weightedBfsTraversal", "scorePivotRelevance", "SessionContext", "computeClusters"];
const BROAD = [
  "capsule generation pipeline scoring compression",
  "database schema migration tables indexes",
  "file indexing parsing symbol extraction",
  "memory observation staleness confidence decay",
  "MCP server tool registration transport",
];
const TASK = [
  "find bugs in the capsule pipeline",
  "how does the indexer handle file changes",
  "implement a new MCP tool for symbol search",
  "optimize the BFS traversal for large graphs",
  "check for error handling issues in database queries",
];

function measure(queries: readonly string[], budget: number) {
  const confs = queries.map((q) => generateCapsule(db, { query: q, tokenBudget: budget }).metadata.quality.coverageConfidence);
  const avg = confs.reduce((s, v) => s + v, 0) / confs.length;
  const min = Math.min(...confs);
  return { avgConfidence: avg, minConfidence: min };
}

const result = {
  narrow: measure(NARROW, 4000),
  broad: measure(BROAD, 10000),
  task: measure(TASK, 10000),
  updatedAt: new Date().toISOString(),
};

const outPath = resolve(__dirname, "../tests/integration/quality-baseline.json");
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(`Baseline updated:\n${JSON.stringify(result, null, 2)}\n`);
db.close();
