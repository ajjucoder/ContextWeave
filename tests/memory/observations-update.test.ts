import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { sessionQueries } from "../../src/db/queries/sessions.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { ObservationStore } from "../../src/memory/observations.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("observation updates", () => {
  it("persists updated note text to disk-backed DB", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-observations-"));
    tempDirs.push(root);
    const dbPath = join(root, "observations.db");

    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    createSchema(db);
    sessionQueries(db).ensureSession("session-1", root);

    const store = new ObservationStore(db);
    const created = store.create({
      sessionId: "session-1",
      scope: "architecture",
      note: "original note",
    });

    const updated = store.update(created.id, { note: "updated note text" });
    expect(updated?.note).toBe("updated note text");
    db.close();

    const reopened = new Database(dbPath);
    reopened.pragma("foreign_keys = ON");
    const persisted = observationQueries(reopened).getById(created.id);
    expect(persisted?.note).toBe("updated note text");
    reopened.close();
  });
});
