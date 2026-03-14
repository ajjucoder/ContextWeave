import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { searchFilesByQuery } from "../../src/core/file-summaries.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-body-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
}

describe("body-aware file summary search", () => {
  it("finds files containing qualified name patterns like supabase.from", async () => {
    const root = makeTempProject();

    writeFileSync(
      join(root, "src", "sessions.ts"),
      `import { supabase } from './client';

export async function getSessions() {
  const { data } = await supabase.from("sessions").select("*");
  return data;
}
`
    );

    writeFileSync(
      join(root, "src", "client.ts"),
      `export const supabase = createClient("url", "key");
function createClient(url: string, key: string) { return { from: () => ({}) }; }
`
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    try {
      await indexProject(db, root);
      const results = searchFilesByQuery(db, "sessions", 10, root);
      const paths = results.map((r) => r.path);
      expect(paths.some((p) => p.includes("sessions.ts"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("finds files containing fetch API calls to specific routes", async () => {
    const root = makeTempProject();

    writeFileSync(
      join(root, "src", "api-client.ts"),
      `export async function fetchUsers() {
  const response = await fetch("/api/users");
  return response.json();
}
`
    );

    writeFileSync(
      join(root, "src", "utils.ts"),
      `export function formatName(first: string, last: string) {
  return first + " " + last;
}
`
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    try {
      await indexProject(db, root);
      const results = searchFilesByQuery(db, "users api endpoint", 10, root);
      const paths = results.map((r) => r.path);
      expect(paths.some((p) => p.includes("api-client.ts"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("finds files containing string literals matching query terms", async () => {
    const root = makeTempProject();

    writeFileSync(
      join(root, "src", "config.ts"),
      `export const DATABASE_URL = "postgresql://localhost:5432/myapp";
export const REDIS_URL = "redis://localhost:6379";
`
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    try {
      await indexProject(db, root);
      const results = searchFilesByQuery(db, "postgresql database", 10, root);
      const paths = results.map((r) => r.path);
      expect(paths.some((p) => p.includes("config.ts"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
