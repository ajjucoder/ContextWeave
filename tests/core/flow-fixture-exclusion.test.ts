import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { buildFlowResult } from "../../src/mcp/tools/flow.js";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "cw-flow-fixtures-"));
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("cw_flow fixture exclusion", () => {
  it("prefers source paths over tests/fixtures noise for unresolved generic methods", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "tests", "fixtures"), { recursive: true });

      writeFileSync(
        join(root, "src", "signals.ts"),
        `export function termWeight(term: string, idfWeights?: Map<string, number>) {
  const raw = idfWeights?.get(term.toLowerCase()) ?? 1;
  return raw;
}
`
      );

      writeFileSync(
        join(root, "src", "entry.ts"),
        `import { termWeight } from "./signals";

export function registerCapsuleTool() {
  return termWeight("capsule", new Map());
}
`
      );

      writeFileSync(
        join(root, "tests", "fixtures", "sample.ts"),
        `export class UserService {
  get(id: string) {
    return id;
  }
}
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "registerCapsuleTool", undefined, 5, "outgoing");

      expect(result.text).toContain("termWeight");
      expect(result.text).not.toContain("tests/fixtures/sample.ts");
      expect(result.text).not.toContain("UserService.get");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
