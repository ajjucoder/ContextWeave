import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { buildFlowResult } from "../../src/mcp/tools/flow.js";

function seedSymbolNoEdges(db: Database.Database): void {
  createSchema(db);
  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language) VALUES ('src/components/Modal.tsx', 'h1', 1, 1, 'tsx')"
  ).run();
  const fileId = (db.prepare("SELECT id FROM files WHERE path = 'src/components/Modal.tsx'").get() as { id: number }).id;
  db.prepare(
    `INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, last_seen)
     VALUES (?, 'handlePublish', 'function', 1, 50, 'function handlePublish()', 'h1', '', 1, 1)`
  ).run(fileId);
}

describe("cw_flow honest failure", () => {
  it("returns symbol location when no outgoing flows found", () => {
    const db = new Database(":memory:");
    seedSymbolNoEdges(db);
    const result = buildFlowResult(db, "handlePublish", undefined, 5);
    expect(result.text).toContain("src/components/Modal.tsx");
    expect(result.text).toContain("flows_limited");
  });

  it("indicates static-call limitation in failure message", () => {
    const db = new Database(":memory:");
    seedSymbolNoEdges(db);
    const result = buildFlowResult(db, "handlePublish", undefined, 5);
    expect(result.text).toContain("static");
  });

  it("returns isLimited true when no flows found", () => {
    const db = new Database(":memory:");
    seedSymbolNoEdges(db);
    const result = buildFlowResult(db, "handlePublish", undefined, 5);
    expect(result.isLimited).toBe(true);
  });

  it("returns isLimited false when symbol not found", () => {
    const db = new Database(":memory:");
    seedSymbolNoEdges(db);
    const result = buildFlowResult(db, "nonexistent", undefined, 5);
    expect(result.isLimited).toBe(false);
  });
});
