import { afterEach, describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
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

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-flow-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
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

describe("cw_flow class and callback tracing", () => {
  it("resolves qualified class methods through JSX callback chains", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "Button.tsx"),
      `export function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Save</button>;
}
`
    );
    writeFileSync(
      join(root, "src", "ComposeModal.tsx"),
      `import { Button } from "./Button";

export class ComposeModal extends React.Component {
  handleSave() {
    return persistDraft();
  }

  render() {
    return <Button onClick={this.handleSave} />;
  }
}

export class CancelModal extends React.Component {
  handleSave() {
    return persistDiscard();
  }

  render() {
    return <Button onClick={this.handleSave} />;
  }
}

export function persistDraft() {
  return true;
}

export function persistDiscard() {
  return false;
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);

    try {
      await indexProject(db, root);
      const result = buildFlowResult(db, "ComposeModal.render", "persistDraft", 5);
      expect(result.isLimited).toBe(false);
      expect(result.text).toContain("ComposeModal.render");
      expect(result.text).toContain("ComposeModal.handleSave");
      expect(result.text).toContain("persistDraft");
      expect(result.text).not.toContain("CancelModal.handleSave");
    } finally {
      db.close();
    }
  });
});
