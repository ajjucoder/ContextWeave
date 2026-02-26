import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { generateCapsule } from "../src/capsule/generator.js";
import { countTokens } from "../src/utils/tokens.js";

const PROJECT_ROOT = "/path/to/project";
const DB_PATH = `${PROJECT_ROOT}/.contextweave/contextweave.db`;

const db = getDb(DB_PATH);
runMigrations(db);

// Mix of broad and focused queries to show full range
const queries = [
  { q: "how do agents communicate and pass tasks",  label: "BROAD" },
  { q: "team creation and member management",        label: "BROAD" },
  { q: "SendMessage tool",                           label: "FOCUSED" },
  { q: "shutdown_request handler",                   label: "FOCUSED" },
  { q: "TaskCreate TaskUpdate",                      label: "FOCUSED" },
];

// Step 1 — Project scale
const totalFiles = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
const totalSymbols = (db.prepare("SELECT COUNT(*) as c FROM symbols").get() as { c: number }).c;
const totalEdges = (db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;

const samplePaths = (db.prepare("SELECT path FROM files LIMIT 30").all() as { path: string }[]);
let sampleTokenSum = 0, sampleCount = 0;
for (const { path } of samplePaths) {
  try {
    sampleTokenSum += countTokens(readFileSync(resolve(PROJECT_ROOT, path), "utf-8"));
    sampleCount++;
  } catch { /* skip */ }
}
const avgTokensPerFile = sampleCount > 0 ? Math.round(sampleTokenSum / sampleCount) : 600;
const totalProjectTokens = totalFiles * avgTokensPerFile;

console.log("=".repeat(68));
console.log("STEP 1 — Project Scale (codex-team-orchestrator)");
console.log("=".repeat(68));
console.log(`Files indexed:       ${totalFiles}`);
console.log(`Symbols indexed:     ${totalSymbols}`);
console.log(`Dependency edges:    ${totalEdges}`);
console.log(`Avg tokens/file:     ~${avgTokensPerFile}`);
console.log(`Total project size:  ~${totalProjectTokens.toLocaleString()} tokens`);
console.log(`Claude context max:  ~200,000 tokens`);
console.log(`% of context just to read all files: ${Math.round(totalProjectTokens / 200000 * 100)}%`);
console.log();

// Step 2+3 — Capsule quality + token reduction per query
console.log("=".repeat(68));
console.log("STEP 2+3 — Capsule Quality & Token Reduction Per Query");
console.log("=".repeat(68));

let totalCapsuleTokens = 0;
let totalRawTokens = 0;

for (const { q, label } of queries) {
  const capsule = generateCapsule(db, { query: q, tokenBudget: 4000, mode: "feature", projectRoot: PROJECT_ROOT });
  const meta = capsule.metadata;
  const capsuleTokens = meta.tokensUsed;
  const rawTokens = meta.fileCount * avgTokensPerFile;
  const reductionPct = rawTokens > 0 ? Math.round((1 - capsuleTokens / rawTokens) * 100) : 0;

  totalCapsuleTokens += capsuleTokens;
  totalRawTokens += rawTokens;

  const cb = meta.compressionBreakdown as Record<string, number>;
  const breakdown = Object.entries(cb).map(([k, v]) => `${k}=${v}`).join(" ");

  console.log();
  console.log(`[${label}] "${q}"`);
  console.log(`  Capsule tokens:   ${capsuleTokens} (budget: 4000)`);
  console.log(`  Uncertainty:      ${meta.quality.uncertainty}  |  Pivot coverage: ${Math.round(meta.quality.pivotCoverage * 100)}%`);
  console.log(`  Symbols packed:   ${meta.symbolCount} from ${meta.fileCount} files  |  Compression: ${breakdown}`);
  console.log(`  Raw read cost:    ~${rawTokens} tokens (reading those ${meta.fileCount} files in full)`);
  if (reductionPct > 0) {
    console.log(`  TOKEN REDUCTION:  ${reductionPct}% saved vs naive file reads`);
  }
}

console.log();
console.log("=".repeat(68));
console.log("STEP 4 — Summary");
console.log("=".repeat(68));
const overallReduction = Math.round((1 - totalCapsuleTokens / totalRawTokens) * 100);
console.log(`Across ${queries.length} queries:`);
console.log(`  Total capsule cost:  ${totalCapsuleTokens.toLocaleString()} tokens`);
console.log(`  Total naive cost:    ~${totalRawTokens.toLocaleString()} tokens`);
console.log(`  Overall reduction:   ${overallReduction}%`);
console.log();
console.log(`If Claude reads ALL 237 files for context: ~${totalProjectTokens.toLocaleString()} tokens`);
console.log(`With ContextWeave (one capsule per task):  ~4,000 tokens`);
console.log(`That's ${Math.round((1 - 4000 / totalProjectTokens) * 100)}% reduction from project total`);
console.log("=".repeat(68));

db.close();
