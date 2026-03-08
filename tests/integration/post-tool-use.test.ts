import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, closeDb } from "../../src/db/connection.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { handlePostToolUse } from "../../src/hooks/post-tool-use.js";

const projectRoots: string[] = [];

function createProjectRoot(name: string): { projectRoot: string; dbPath: string } {
  const projectRoot = resolve(join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`));
  mkdirSync(join(projectRoot, ".contextweave"), { recursive: true });
  projectRoots.push(projectRoot);
  return {
    projectRoot,
    dbPath: join(projectRoot, ".contextweave", "contextweave.db"),
  };
}

function seedCapsuleLog(
  dbPath: string,
  projectRoot: string,
  filesIncluded: string[],
  options?: { sessionId?: string; query?: string }
): void {
  const sessionId = options?.sessionId ?? "session-1";
  const query = options?.query ?? "user query";
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  db.prepare(
    "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, "claude-code", projectRoot, Date.now());
  db.prepare(`
    INSERT INTO capsule_log (session_id, query, mode, token_budget, tokens_used, symbols_included, files_included, timestamp, followed_up, miss_ratio, noise_ratio)
    VALUES (?, ?, 'feature', ?, ?, ?, ?, ?, 0, 0, 0)
  `).run(sessionId, query, 4000, 1200, JSON.stringify(["loadUser"]), JSON.stringify(filesIncluded), Date.now());
  db.close();
}

afterEach(() => {
  closeDb();
});

describe("post-tool-use hook", () => {
  it("treats similarly named files as capsule misses instead of substring hits", async () => {
    const { projectRoot, dbPath } = createProjectRoot("cw-post-tool-use");
    seedCapsuleLog(dbPath, projectRoot, ["src/routes/user.ts"]);

    await handlePostToolUse({
      tool_name: "Read",
      tool_input: {
        file_path: resolve(projectRoot, "src/routes/user.tsx"),
      },
      project_root: projectRoot,
    });

    const db = getDb(dbPath);
    const row = db.prepare("SELECT followed_up, miss_ratio FROM capsule_log ORDER BY id DESC LIMIT 1").get() as {
      followed_up: number;
      miss_ratio: number | null;
    };

    expect(row.followed_up).toBe(1);
    expect(row.miss_ratio).toBe(1);
  });

  it("updates the active session capsule row instead of the latest row from another session", async () => {
    const { projectRoot, dbPath } = createProjectRoot("cw-post-tool-use-session");
    seedCapsuleLog(dbPath, projectRoot, ["src/routes/user.ts"], { sessionId: "session-a", query: "first query" });
    seedCapsuleLog(dbPath, projectRoot, ["src/routes/admin.ts"], { sessionId: "session-b", query: "second query" });

    await handlePostToolUse({
      tool_name: "Read",
      tool_input: {
        file_path: resolve(projectRoot, "src/routes/user.tsx"),
      },
      project_root: projectRoot,
      session_id: "session-a",
    });

    const db = getDb(dbPath);
    const rows = db.prepare(
      "SELECT session_id, followed_up, miss_ratio FROM capsule_log ORDER BY id ASC"
    ).all() as Array<{ session_id: string; followed_up: number; miss_ratio: number | null }>;

    expect(rows).toEqual([
      { session_id: "session-a", followed_up: 1, miss_ratio: 1 },
      { session_id: "session-b", followed_up: 0, miss_ratio: 0 },
    ]);
  });
});
