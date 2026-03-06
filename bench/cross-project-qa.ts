import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  commit?: string;
  tasks: Array<{
    id: string;
    goal: string;
    attempts: Array<{
      query: string;
      expectedFiles: string[];
      tokenBudget?: number;
    }>;
  }>;
}

const PROJECTS: QaProject[] = [
  {
    name: "express",
    repo: "https://github.com/expressjs/express.git",
    commit: "6c4249feec8ab40631817c8e7001baf2ed022224",
    tasks: [
      {
        id: "express-router-pipeline",
        goal: "Find the Express router request flow with a realistic first-shot architecture query and a narrower fallback.",
        attempts: [
          { query: "middleware routing request response pipeline", expectedFiles: ["lib/express.js"] },
          { query: "request lifecycle", expectedFiles: ["lib/express.js"] },
        ],
      },
    ],
  },
  {
    name: "fastify",
    repo: "https://github.com/fastify/fastify.git",
    commit: "b61c362cc9fba35e7e060a71284154e4f86d54f4",
    tasks: [
      {
        id: "fastify-hook-lifecycle",
        goal: "Find Fastify hook and validation flow with a realistic first-shot architecture query and a narrower fallback.",
        attempts: [
          { query: "fastify hook validation lifecycle", expectedFiles: ["lib/hooks.js", "lib/route.js"] },
          { query: "hook lifecycle request validation pipeline", expectedFiles: ["lib/hooks.js", "lib/route.js"] },
        ],
      },
    ],
  },
  {
    name: "zod",
    repo: "https://github.com/colinhacks/zod.git",
    commit: "c7805073fef5b6b8857307c3d4b3597a70613bc2",
    tasks: [
      {
        id: "zod-parse-pipeline",
        goal: "Find the Zod parse and transform pipeline with a realistic first-shot architecture query and a narrower fallback.",
        attempts: [
          { query: "zod schema validation transform pipeline", expectedFiles: ["v3/types.ts"] },
          { query: "schema validation transform pipeline", expectedFiles: ["v3/types.ts"] },
        ],
      },
    ],
  },
];

interface TaskSummary {
  success: boolean;
  firstPassSuccess: boolean;
  correction: boolean;
  tokensToSuccess: number;
  avgConfidence: number;
}

const PRODUCT_THRESHOLDS = {
  taskSuccessRateMin: 2 / 3,
  firstPassSuccessRateMin: 2 / 3,
  correctionRateMax: 0.3,
  avgConfidenceMin: 0.65,
};

async function runProject(project: QaProject, projectDir: string): Promise<TaskSummary[] | null> {
  try {
    execSync(`git clone --depth 1 ${project.repo} "${projectDir}"`, {
      stdio: "pipe",
      timeout: 60000,
    });
    if (project.commit) {
      execSync(`git -C "${projectDir}" checkout --detach ${project.commit}`, {
        stdio: "pipe",
        timeout: 60000,
      });
    }
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
  process.stdout.write(`  ${indexResult.filesIndexed} files, ${indexResult.symbolsFound} symbols\n`);

  const sessionId = `qa-session-${project.name}-${Date.now()}`;
  const summaries: TaskSummary[] = [];

  for (const task of project.tasks) {
    let tokensToSuccess = 0;
    let success = false;
    let correction = false;
    const confidences: number[] = [];

    for (let attemptIndex = 0; attemptIndex < task.attempts.length; attemptIndex++) {
      const attempt = task.attempts[attemptIndex]!;
      const capsule = generateCapsule(db, {
        query: attempt.query,
        tokenBudget: attempt.tokenBudget ?? 4000,
        sessionId,
      });
      confidences.push(capsule.metadata.quality.coverageConfidence);
      tokensToSuccess += capsule.metadata.tokensUsed;

      const expectedCount = attempt.expectedFiles.filter((fragment) => capsule.content.includes(fragment)).length;
      const successNow = expectedCount === attempt.expectedFiles.length;

      process.stdout.write(
        `  ${task.id} / attempt ${attemptIndex + 1}: "${attempt.query}" -> ${successNow ? "success" : "miss"}, confidence ${(capsule.metadata.quality.coverageConfidence * 100).toFixed(1)}%, tokens ${capsule.metadata.tokensUsed}\n`
      );

      if (successNow) {
        success = true;
        correction = attemptIndex > 0;
        break;
      }
    }

    summaries.push({
      success,
      firstPassSuccess: success && !correction,
      correction,
      tokensToSuccess,
      avgConfidence: confidences.reduce((sum, value) => sum + value, 0) / Math.max(1, confidences.length),
    });
  }

  db.close();
  return summaries;
}

async function main(): Promise<void> {
  if (existsSync(QA_DIR)) rmSync(QA_DIR, { recursive: true, force: true });
  mkdirSync(QA_DIR, { recursive: true });

  const summaries: TaskSummary[] = [];

  for (const project of PROJECTS) {
    const projectDir = resolve(QA_DIR, project.name);
    process.stdout.write(`\nCloning ${project.name}...\n`);
    const result = await runProject(project, projectDir);
    if (result) summaries.push(...result);
  }

  process.stdout.write("\n=== PRODUCT BENCH SUMMARY ===\n");

  if (summaries.length === 0) {
    process.stdout.write("No results — all projects skipped (clone failures)\n");
    process.stdout.write("Status: SKIP (not FAIL)\n");
    rmSync(QA_DIR, { recursive: true, force: true });
    return;
  }

  const taskSuccessRate = summaries.reduce((sum, task) => sum + (task.success ? 1 : 0), 0) / summaries.length;
  const firstPassSuccessRate = summaries.reduce((sum, task) => sum + (task.firstPassSuccess ? 1 : 0), 0) / summaries.length;
  const correctionRate = summaries.reduce((sum, task) => sum + (task.correction ? 1 : 0), 0) / summaries.length;
  const avgTaskTokens = summaries.reduce((sum, task) => sum + task.tokensToSuccess, 0) / summaries.length;
  const avgConfidence = summaries.reduce((sum, task) => sum + task.avgConfidence, 0) / summaries.length;
  const passed =
    taskSuccessRate >= PRODUCT_THRESHOLDS.taskSuccessRateMin &&
    firstPassSuccessRate >= PRODUCT_THRESHOLDS.firstPassSuccessRateMin &&
    correctionRate <= PRODUCT_THRESHOLDS.correctionRateMax &&
    avgConfidence >= PRODUCT_THRESHOLDS.avgConfidenceMin;

  process.stdout.write(`Task success rate: ${(taskSuccessRate * 100).toFixed(1)}%\n`);
  process.stdout.write(`First-pass rate:   ${(firstPassSuccessRate * 100).toFixed(1)}%\n`);
  process.stdout.write(`Correction rate:   ${(correctionRate * 100).toFixed(1)}%\n`);
  process.stdout.write(`Avg tokens to first correct context: ${avgTaskTokens.toFixed(1)}\n`);
  process.stdout.write(`Avg confidence:    ${(avgConfidence * 100).toFixed(1)}%\n`);
  process.stdout.write(
    `Thresholds:       success >= ${(PRODUCT_THRESHOLDS.taskSuccessRateMin * 100).toFixed(1)}%, ` +
    `first-pass >= ${(PRODUCT_THRESHOLDS.firstPassSuccessRateMin * 100).toFixed(1)}%, ` +
    `correction <= ${(PRODUCT_THRESHOLDS.correctionRateMax * 100).toFixed(1)}%, ` +
    `confidence >= ${(PRODUCT_THRESHOLDS.avgConfidenceMin * 100).toFixed(1)}%\n`
  );
  process.stdout.write(`Overall status:    ${passed ? "PASS" : "FAIL"}\n`);

  if (!passed) {
    process.exitCode = 1;
  }

  rmSync(QA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`QA failed: ${err}\n`);
  process.exit(1);
});
