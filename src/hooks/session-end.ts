import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { StalenessEngine } from "../memory/staleness.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("hook:session-end");

interface SessionEndInput {
  session_id?: string;
  project_root?: string;
}

export async function handleSessionEnd(input: SessionEndInput): Promise<void> {
  const projectRoot = input.project_root ?? process.cwd();
  const cwDir = resolve(projectRoot, ".contextweave");
  if (!existsSync(cwDir)) return;

  const dbPath = resolve(cwDir, "contextweave.db");
  const db = getDb(dbPath);
  runMigrations(db);

  if (input.session_id) {
    db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(Date.now(), input.session_id);
    log.info(`closed session ${input.session_id}`);
  }

  const staleness = new StalenessEngine(db);

  staleness.decayConfidence(0.1);
  log.debug("applied confidence decay");

  const archived = staleness.runGC();
  if (archived > 0) {
    log.info(`GC archived ${archived} observations`);
  }

  closeDb();
}

if (process.argv[1] && process.argv[1].includes("session-end")) {
  const stdinChunks: Buffer[] = [];
  process.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(Buffer.concat(stdinChunks).toString()) as SessionEndInput;
      handleSessionEnd(input).catch((err) => {
        log.error("hook failed", err);
        process.exit(1);
      });
    } catch {
      process.exit(0);
    }
  });
}
