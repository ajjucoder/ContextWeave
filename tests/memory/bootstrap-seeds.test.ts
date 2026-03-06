import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { syncBootstrapObservations } from "../../src/memory/bootstrap.js";
import { MemorySearch } from "../../src/memory/search.js";
import { observationQueries } from "../../src/db/queries/observations.js";

let db: Database.Database;
let root: string;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  root = mkdtempSync(join(tmpdir(), "cw-bootstrap-seeds-"));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("bootstrap observation seeding", () => {
  it("seeds durable observations from README, CLAUDE, and architecture docs", async () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "README.md"), "# Overview\n\n- Auth uses JWT refresh rotation for agent sessions.\n");
    writeFileSync(join(root, ".claude", "CLAUDE.md"), "# Team rules\n\n- Prefer cw_capsule before broad grep sweeps.\n");
    writeFileSync(
      join(root, "docs", "architecture.md"),
      "# Architecture\n\nThe billing webhook pipeline writes Stripe events into the audit ledger before retries.\n\n## Follow-up actions\n- [x] Verified webhook retries stay idempotent.\n"
    );

    await indexProject(db, root);

    const result = syncBootstrapObservations(db, root);
    const search = new MemorySearch(db);
    const observations = observationQueries(db).getBySession("contextweave-bootstrap");
    const notes = observations.map((observation) => observation.note);

    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(notes.some((note) => note.includes("Auth uses JWT refresh rotation"))).toBe(true);
    expect(notes.some((note) => note.includes("Prefer cw capsule before broad grep sweeps"))).toBe(true);
    expect(notes.some((note) => note.includes("billing webhook pipeline writes Stripe events"))).toBe(true);
    expect(notes.some((note) => note.includes("Validated follow-up: Verified webhook retries stay idempotent"))).toBe(true);
    expect(search.search("jwt refresh rotation", { limit: 10 }).length).toBeGreaterThan(0);
    expect(search.search("webhook retries idempotent", { limit: 10 }).length).toBeGreaterThan(0);
  });

  it("archives stale bootstrap notes instead of duplicating them on re-sync", async () => {
    writeFileSync(join(root, "README.md"), "# Overview\n\n- Auth uses JWT refresh rotation for agent sessions.\n");

    await indexProject(db, root);

    const first = syncBootstrapObservations(db, root);
    writeFileSync(join(root, "README.md"), "# Overview\n\n- Auth now uses signed session cookies for agent sessions.\n");
    const second = syncBootstrapObservations(db, root);

    const active = observationQueries(db).getBySession("contextweave-bootstrap");
    const archived = db
      .prepare("SELECT note FROM observations WHERE session_id = ? AND archived = 1")
      .all("contextweave-bootstrap") as Array<{ note: string }>;

    expect(first.seeded).toBeGreaterThan(0);
    expect(second.archived).toBeGreaterThan(0);
    expect(active.some((observation) => observation.note.includes("signed session cookies"))).toBe(true);
    expect(archived.some((observation) => observation.note.includes("JWT refresh rotation"))).toBe(true);
  });
});
