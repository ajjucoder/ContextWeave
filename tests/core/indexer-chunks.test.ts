import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexSingleFile } from "../../src/core/indexer.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-chunks-"));
  tempRoots.push(root);
  return root;
}

function bumpMtime(filePath: string): void {
  const next = new Date(Date.now() + 5_000);
  utimesSync(filePath, next, next);
}

describe("indexer chunk persistence", () => {
  it("stores contextualized chunks for indexed files", async () => {
    const root = makeTempProject();
    const filePath = join(root, "user-service.ts");
    writeFileSync(
      filePath,
      `import { Database } from "./db";

export class UserService {
  constructor(private readonly db: Database) {}

  async getUser(id: string) {
    return this.db.find(id);
  }

  formatUser(user: { id: string }) {
    return user.id.toUpperCase();
  }
}
`
    );
    bumpMtime(filePath);

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const result = await indexSingleFile(db, filePath, root);
    expect(result.errors).toEqual([]);

    const rows = db.prepare(`
      SELECT chunk_index, contextualized_text, scope_chain, import_context, sibling_context, entity_context, token_count
      FROM chunks
      ORDER BY chunk_index
    `).all() as Array<{
      chunk_index: number;
      contextualized_text: string;
      scope_chain: string;
      import_context: string;
      sibling_context: string;
      entity_context: string;
      token_count: number;
    }>;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.contextualized_text.includes("getUser"))).toBe(true);
    expect(rows.some((row) => JSON.parse(row.import_context).includes("./db"))).toBe(true);
    expect(rows.some((row) => JSON.parse(row.entity_context).includes("getUser"))).toBe(true);
    expect(rows.some((row) => JSON.parse(row.scope_chain).length > 0 || JSON.parse(row.sibling_context).length > 0)).toBe(true);
    expect(rows.every((row) => row.token_count > 0)).toBe(true);

    db.close();
  });

  it("replaces stale chunks when a file is re-indexed", async () => {
    const root = makeTempProject();
    const filePath = join(root, "handlers.ts");
    writeFileSync(
      filePath,
      `export function loadProfile() {
  return "profile";
}
`
    );
    bumpMtime(filePath);

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const first = await indexSingleFile(db, filePath, root);
    expect(first.errors).toEqual([]);

    writeFileSync(
      filePath,
      `export function saveProfile() {
  return "saved";
}
`
    );
    bumpMtime(filePath);

    const second = await indexSingleFile(db, filePath, root);
    expect(second.errors).toEqual([]);

    const entityContexts = db.prepare("SELECT entity_context FROM chunks").all() as Array<{ entity_context: string }>;
    const flattened = entityContexts.flatMap((row) => JSON.parse(row.entity_context) as string[]);

    expect(flattened).toContain("saveProfile");
    expect(flattened).not.toContain("loadProfile");

    db.close();
  });

  it("indexes markdown files with document chunks instead of failing code chunking", async () => {
    const root = makeTempProject();
    const filePath = join(root, "notes.md");
    writeFileSync(filePath, "# Notes\n\nRemember the retry budget.\n");
    bumpMtime(filePath);

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const result = await indexSingleFile(db, filePath, root);

    expect(result.errors).toEqual([]);
    const count = (db.prepare("SELECT COUNT(*) as count FROM chunks").get() as { count: number }).count;
    expect(count).toBe(1);
    const row = db.prepare("SELECT text, contextualized_text FROM chunks LIMIT 1").get() as {
      text: string;
      contextualized_text: string;
    };
    expect(row.text).toContain("Notes");
    expect(row.contextualized_text).toContain("notes.md");

    db.close();
  });
});
