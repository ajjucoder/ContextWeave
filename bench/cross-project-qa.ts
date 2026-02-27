import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createSchema } from "../src/db/schema.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_DIR = resolve(__dirname, "../.qa-temp");

interface QaProject {
  name: string;
  repo: string;
  queries: string[];
}

const PROJECTS: QaProject[] = [
  {
    name: "codex-team-orchestrator",
    repo: "https://github.com/ajjucoder/codex-team-orchestrator.git",
    queries: ["registerTaskBoardTools", "buildRebalancePlan", "HookEngine"],
  },
  {
    name: "polymarket-arbitrage-sim",
    repo: "https://github.com/ajjucoder/polymarket-arbitrage-sim.git",
    queries: ["simulateExecution", "evaluateRisk", "rankOpportunities"],
  },
  {
    name: "research-agent",
    repo: "https://github.com/ajjucoder/research-agent.git",
    queries: ["parse_query", "build_reddit_query_variants", "mention_scores"],
  },
];

interface QaResult {
  project: string;
  query: string;
  confidence: number;
  pivotCoverage: number;
  symbolCount: number;
  tokensUsed: number;
}

async function main(): Promise<void> {
  if (existsSync(QA_DIR)) rmSync(QA_DIR, { recursive: true, force: true });
  mkdirSync(QA_DIR, { recursive: true });

  const results: QaResult[] = [];

  for (const project of PROJECTS) {
    const projectDir = resolve(QA_DIR, project.name);
    process.stdout.write(`\nCloning ${project.name}...\n`);

    try {
      execSync(`git clone --depth 1 ${project.repo} "${projectDir}"`, { stdio: "pipe", timeout: 60000 });
    } catch {
      process.stdout.write(`  SKIP: failed to clone ${project.repo}\n`);
      continue;
    }

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);

    process.stdout.write("  Indexing...\n");
    const indexResult = await indexProject(db, projectDir);
    updateCentralityScores(db);
    process.stdout.write(`  ${indexResult.filesIndexed} files, ${indexResult.symbolsFound} symbols\n`);

    for (const query of project.queries) {
      const capsule = generateCapsule(db, { query, tokenBudget: 4000 });
      const q = capsule.metadata.quality;
      results.push({
        project: project.name,
        query,
        confidence: q.coverageConfidence,
        pivotCoverage: q.pivotCoverage,
        symbolCount: capsule.metadata.symbolCount,
        tokensUsed: capsule.metadata.tokensUsed,
      });
      process.stdout.write(
        `  "${query}" → confidence: ${(q.coverageConfidence * 100).toFixed(1)}%, pivots: ${(q.pivotCoverage * 100).toFixed(1)}%, ${capsule.metadata.symbolCount} symbols, ${capsule.metadata.tokensUsed} tokens\n`
      );
    }

    db.close();
  }

  process.stdout.write("\n=== SUMMARY ===\n");

  if (results.length === 0) {
    process.stdout.write("No results — all projects skipped (clone failures)\n");
    process.stdout.write("This is expected if repos are private or unavailable\n");
    process.stdout.write("Status: SKIP (not FAIL)\n");
    rmSync(QA_DIR, { recursive: true, force: true });
    return;
  }

  const avgConfidence = results.reduce((acc, r) => acc + r.confidence, 0) / results.length;
  const minConfidence = Math.min(...results.map((r) => r.confidence));
  process.stdout.write(`Average confidence: ${(avgConfidence * 100).toFixed(1)}%\n`);
  process.stdout.write(`Min confidence:     ${(minConfidence * 100).toFixed(1)}%\n`);
  process.stdout.write(`Target:             >60%\n`);
  process.stdout.write(`Status:             ${avgConfidence > 0.6 ? "PASS" : "FAIL"}\n`);

  rmSync(QA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`QA failed: ${err}\n`);
  process.exit(1);
});
