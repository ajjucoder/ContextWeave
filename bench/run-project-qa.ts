import Database from "better-sqlite3";
import { createSchema } from "../src/db/schema.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";

interface TaskAttempt {
  query: string;
  expectedFiles: string[];
  expectedSnippets?: string[];
  forbiddenFiles?: string[];
  tokenBudget?: number;
  semanticRerank?: boolean;
}

interface QaTask {
  id: string;
  goal: string;
  attempts: TaskAttempt[];
}

interface QaProject {
  name: string;
  tasks: QaTask[];
}

interface TaskSummary {
  success: boolean;
  firstPassSuccess: boolean;
  correction: boolean;
  tokensToSuccess: number;
  avgConfidence: number;
}

function capsuleHasFileFragment(
  capsule: ReturnType<typeof generateCapsule>,
  fragment: string
): boolean {
  const basename = fragment.split("/").pop() ?? fragment;
  return (
    capsule.metadata.filesIncluded.some((filePath) => filePath.includes(fragment) || filePath.endsWith(`/${basename}`)) ||
    capsule.content.includes(fragment) ||
    capsule.content.includes(basename)
  );
}

async function main(): Promise<void> {
  const [projectDir, payload] = process.argv.slice(2);
  if (!projectDir || !payload) {
    throw new Error("Usage: run-project-qa.ts <projectDir> <projectPayloadBase64>");
  }

  const project = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as QaProject;
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
        semanticRerank: attempt.semanticRerank,
      });
      confidences.push(capsule.metadata.quality.coverageConfidence);
      tokensToSuccess += capsule.metadata.tokensUsed;

      const expectedFileMatches = attempt.expectedFiles.map((fragment) => ({
        fragment,
        matched: capsuleHasFileFragment(capsule, fragment),
      }));
      const expectedSnippetMatches = (attempt.expectedSnippets ?? []).map((fragment) => ({
        fragment,
        matched: capsule.content.includes(fragment),
      }));
      const forbiddenMatches = (attempt.forbiddenFiles ?? []).map((fragment) => ({
        fragment,
        matched: capsuleHasFileFragment(capsule, fragment),
      }));
      const expectedFileCount = expectedFileMatches.filter((entry) => entry.matched).length;
      const expectedSnippetCount = expectedSnippetMatches.filter((entry) => entry.matched).length;
      const forbiddenCount = forbiddenMatches.filter((entry) => entry.matched).length;
      const successNow =
        expectedFileCount === attempt.expectedFiles.length &&
        expectedSnippetCount === (attempt.expectedSnippets ?? []).length &&
        forbiddenCount === 0;

      process.stdout.write(
        `  ${task.id} / attempt ${attemptIndex + 1}: "${attempt.query}"${attempt.semanticRerank ? " [semantic]" : ""} -> ${successNow ? "success" : "miss"}, confidence ${(capsule.metadata.quality.coverageConfidence * 100).toFixed(1)}%, tokens ${capsule.metadata.tokensUsed}${forbiddenCount > 0 ? `, forbidden ${forbiddenCount}` : ""}\n`
      );

      if (!successNow) {
        process.stdout.write(
          `    expected files: ${expectedFileMatches.map((entry) => `${entry.fragment}=${entry.matched ? "hit" : "miss"}`).join(", ")}\n`
        );
        if (expectedSnippetMatches.length > 0) {
          process.stdout.write(
            `    expected snippets: ${expectedSnippetMatches.map((entry) => `${entry.fragment}=${entry.matched ? "hit" : "miss"}`).join(", ")}\n`
          );
        }
        if (forbiddenMatches.length > 0) {
          process.stdout.write(
            `    forbidden: ${forbiddenMatches.map((entry) => `${entry.fragment}=${entry.matched ? "hit" : "clear"}`).join(", ")}\n`
          );
        }
        process.stdout.write(
          `    files included: ${capsule.metadata.filesIncluded.map((filePath) => filePath.replace(`${projectDir}/`, "")).join(", ")}\n`
        );
      }

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
  process.stdout.write(`__CW_JSON__${JSON.stringify(summaries)}\n`);
}

await main();
