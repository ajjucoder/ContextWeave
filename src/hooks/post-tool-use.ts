import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { indexSingleFile } from "../core/indexer.js";
import { capsuleLogQueries } from "../db/queries/capsule-log.js";
import { detectLanguage } from "../core/parser.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("hook:post-tool-use");

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  project_root?: string;
}

function normalizeTrackedFilePath(projectRoot: string, filePath: string): string {
  return resolve(projectRoot, filePath).replace(/\\/g, "/");
}

export async function handlePostToolUse(input: HookInput): Promise<void> {
  const projectRoot = input.project_root ?? process.cwd();
  const cwDir = resolve(projectRoot, ".contextweave");
  if (!existsSync(cwDir)) return;

  const dbPath = resolve(cwDir, "contextweave.db");
  const db = getDb(dbPath);
  runMigrations(db);

  const toolName = input.tool_name;
  const filePath = (input.tool_input["file_path"] ?? input.tool_input["path"]) as string | undefined;

  if (!filePath) {
    closeDb();
    return;
  }

  const language = detectLanguage(filePath);
  if (!language) {
    closeDb();
    return;
  }

  const isWrite = toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit";
  const isRead = toolName === "Read";

  if (isWrite) {
    try {
      indexSingleFile(db, filePath, projectRoot);
      log.debug(`reindexed after write: ${filePath}`);
    } catch (err) {
      log.error(`failed to reindex ${filePath}`, err);
    }
  }

  const capsuleLogs = capsuleLogQueries(db);
  const latest = capsuleLogs.getLatest();

  if (latest && !latest.followedUp) {
    const normalizedFilePath = normalizeTrackedFilePath(projectRoot, filePath);
    const wasInCapsule = latest.filesIncluded.some((candidatePath) => (
      normalizeTrackedFilePath(projectRoot, candidatePath) === normalizedFilePath
    ));

    if (isRead && !wasInCapsule) {
      const currentMiss = latest.missRatio ?? 0;
      capsuleLogs.updateFeedback(latest.id, true, currentMiss + 1, latest.noiseRatio);
      log.debug(`capsule miss: ${filePath} was read but not in capsule`);
    }

    if (isWrite && wasInCapsule) {
      capsuleLogs.updateFeedback(latest.id, true, latest.missRatio, latest.noiseRatio);
      log.debug(`capsule hit: ${filePath} was edited and was in capsule`);
    }
  }

  closeDb();
}

if (process.argv[1] && process.argv[1].includes("post-tool-use")) {
  const stdinChunks: Buffer[] = [];
  process.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(Buffer.concat(stdinChunks).toString()) as HookInput;
      handlePostToolUse(input).catch((err) => {
        log.error("hook failed", err);
        process.exit(1);
      });
    } catch {
      process.exit(0);
    }
  });
}
