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
  sessionQueries: string[];
}

const PROJECTS: QaProject[] = [
  {
    name: "codex-team-orchestrator",
    repo: "https://github.com/ajjucoder/codex-team-orchestrator.git",
    sessionQueries: [
      "registerTaskBoardTools",
      "buildRebalancePlan",
      "HookEngine",
    ],
  },
  {
    name: "polymarket-arbitrage-sim",
    repo: "https://github.com/ajjucoder/polymarket-arbitrage-sim.git",
    sessionQueries: [
      "simulateExecution",
      "evaluateRisk",
      "rankOpportunities",
    ],
  },
  {
    name: "research-agent",
    repo: "https://github.com/ajjucoder/research-agent.git",
    sessionQueries: [
      "parse_query",
      "build_reddit_query_variants",
      "mention_scores",
    ],
  },
];

interface QueryResult {
  query: string;
  confidence: number;
  pivotCoverage: number;
  symbolCount: number;
  tokensUsed: number;
  tokenReductionPct: number | null;
}

interface ProjectResult {
  project: string;
  filesIndexed: number;
  symbolsFound: number;
  queryResults: QueryResult[];
  sessionConfidenceTrend: number;
  sessionTokenReductionPct: number | null;
}

async function runProject(
  project: QaProject,
  projectDir: string
): Promise<ProjectResult | null> {
  try {
    execSync(`git clone --depth 1 ${project.repo} "${projectDir}"`, {
      stdio: "pipe",
      timeout: 60000,
    });
  } catch {
    process.stdout.write(`  SKIP: failed to clone ${project.repo}\n`);
    return null;
  }

  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  process.stdout.write("  Indexing...\n");
  const indexResult = await indexProject(db, projectDir);
  updateCentralityScores(db);

  const { filesIndexed, symbolsFound } = indexResult;
  process.stdout.write(`  ${filesIndexed} files, ${symbolsFound} symbols\n`);

  const sessionId = `qa-session-${project.name}-${Date.now()}`;
  const queryResults: QueryResult[] = [];

  for (let i = 0; i < project.sessionQueries.length; i++) {
    const query = project.sessionQueries[i];
    const capsule = generateCapsule(db, {
      query,
      tokenBudget: 4000,
      sessionId,
    });

    const q = capsule.metadata.quality;
    const tokensUsed = capsule.metadata.tokensUsed;
    const q1Tokens = i === 0 ? tokensUsed : queryResults[0].tokensUsed;
    const tokenReductionPct =
      i === 0 ? null : ((q1Tokens - tokensUsed) / q1Tokens) * 100;

    queryResults.push({
      query,
      confidence: q.coverageConfidence,
      pivotCoverage: q.pivotCoverage,
      symbolCount: capsule.metadata.symbolCount,
      tokensUsed,
      tokenReductionPct,
    });

    const reductionStr =
      tokenReductionPct !== null
        ? ` (${tokenReductionPct >= 0 ? "-" : "+"}${Math.abs(tokenReductionPct).toFixed(1)}% vs Q1)`
        : "";

    process.stdout.write(
      `  Q${i + 1} "${query}" → confidence: ${(q.coverageConfidence * 100).toFixed(1)}%, tokens: ${tokensUsed}${reductionStr}\n`
    );
  }

  db.close();

  const firstConfidence = queryResults[0].confidence;
  const lastConfidence = queryResults[queryResults.length - 1].confidence;
  const sessionConfidenceTrend =
    (lastConfidence - firstConfidence) * 100;

  const q1Tokens = queryResults[0].tokensUsed;
  const lastTokens = queryResults[queryResults.length - 1].tokensUsed;
  const sessionTokenReductionPct =
    queryResults.length > 1
      ? ((q1Tokens - lastTokens) / q1Tokens) * 100
      : null;

  const trendSign = sessionConfidenceTrend >= 0 ? "+" : "";
  const tokenStr =
    sessionTokenReductionPct !== null
      ? `, ${sessionTokenReductionPct >= 0 ? "-" : "+"}${Math.abs(sessionTokenReductionPct).toFixed(1)}% tokens over session`
      : "";

  process.stdout.write(
    `  Session trend: ${trendSign}${sessionConfidenceTrend.toFixed(1)}% confidence${tokenStr}\n`
  );

  return {
    project: project.name,
    filesIndexed,
    symbolsFound,
    queryResults,
    sessionConfidenceTrend,
    sessionTokenReductionPct,
  };
}

async function main(): Promise<void> {
  if (existsSync(QA_DIR)) rmSync(QA_DIR, { recursive: true, force: true });
  mkdirSync(QA_DIR, { recursive: true });

  const projectResults: ProjectResult[] = [];

  for (const project of PROJECTS) {
    const projectDir = resolve(QA_DIR, project.name);
    process.stdout.write(`\nCloning ${project.name}...\n`);

    const result = await runProject(project, projectDir);
    if (result !== null) {
      projectResults.push(result);
    }
  }

  process.stdout.write("\n=== SUMMARY ===\n");

  if (projectResults.length === 0) {
    process.stdout.write("No results — all projects skipped (clone failures)\n");
    process.stdout.write("This is expected if repos are private or unavailable\n");
    process.stdout.write("Status: SKIP (not FAIL)\n");
    rmSync(QA_DIR, { recursive: true, force: true });
    return;
  }

  const allQueryResults = projectResults.flatMap((p) => p.queryResults);
  const avgConfidence =
    allQueryResults.reduce((acc, r) => acc + r.confidence, 0) /
    allQueryResults.length;
  const minConfidence = Math.min(...allQueryResults.map((r) => r.confidence));

  const followUpResults = allQueryResults.filter(
    (r) => r.tokenReductionPct !== null
  );
  const avgTokenReduction =
    followUpResults.length > 0
      ? followUpResults.reduce((acc, r) => acc + (r.tokenReductionPct ?? 0), 0) /
        followUpResults.length
      : null;

  process.stdout.write(`Average confidence: ${(avgConfidence * 100).toFixed(1)}%\n`);
  process.stdout.write(`Min confidence:     ${(minConfidence * 100).toFixed(1)}%\n`);

  if (avgTokenReduction !== null) {
    const reductionLabel = avgTokenReduction >= 0 ? "reduction" : "increase";
    process.stdout.write(
      `Avg token ${reductionLabel} (Q2+Q3 vs Q1): ${Math.abs(avgTokenReduction).toFixed(1)}%\n`
    );
  }

  process.stdout.write(`Target confidence:  >65%\n`);
  process.stdout.write(`Target token trend: reduction > 0% on Q2/Q3\n`);

  const confidencePass = avgConfidence > 0.65;
  const tokenPass = avgTokenReduction !== null && avgTokenReduction > 0;

  process.stdout.write(
    `Confidence status:  ${confidencePass ? "PASS" : "FAIL"}\n`
  );

  if (avgTokenReduction !== null) {
    process.stdout.write(
      `Token dedup status: ${tokenPass ? "PASS" : "FAIL"}\n`
    );
  }

  const overallPass = confidencePass && (avgTokenReduction === null || tokenPass);
  process.stdout.write(`Overall status:     ${overallPass ? "PASS" : "FAIL"}\n`);

  rmSync(QA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`QA failed: ${err}\n`);
  process.exit(1);
});
