import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { sessionQueries } from "../../src/db/queries/sessions.js";
import {
  promoteFrequentObservations,
  demoteStaleObservations,
} from "../../src/memory/observations.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const tempDirs: string[] = [];

function createTestDb(): Database.Database {
  const root = mkdtempSync(join(tmpdir(), "cw-obs-promo-"));
  tempDirs.push(root);
  const db = new Database(join(root, "test.db"));
  db.pragma("foreign_keys = ON");
  createSchema(db);
  sessionQueries(db).ensureSession("session-1", root);
  return db;
}

function insertObservation(
  db: Database.Database,
  overrides: {
    scope?: string;
    note?: string;
    confidence?: number;
    hitCount?: number;
    lastHitAt?: number | null;
    createdAt?: number;
    archived?: number;
  } = {}
): number {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO observations (session_id, agent_id, scope, note, confidence, created_at, updated_at, stale, archived, hit_count, last_hit_at)
    VALUES ('session-1', 'claude-code', ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    overrides.scope ?? "architecture",
    overrides.note ?? "test observation",
    overrides.confidence ?? 1.0,
    overrides.createdAt ?? now,
    now,
    overrides.archived ?? 0,
    overrides.hitCount ?? 0,
    overrides.lastHitAt ?? null
  );
  return Number(result.lastInsertRowid);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("observation promotion", () => {
  it("promotes observation with 3+ hits to convention scope with confidence 0.9", () => {
    const db = createTestDb();

    const id = insertObservation(db, {
      scope: "architecture",
      confidence: 0.7,
      hitCount: 3,
      lastHitAt: Date.now(),
    });

    const promoted = promoteFrequentObservations(db);
    expect(promoted).toBe(1);

    const row = db.prepare("SELECT scope, confidence FROM observations WHERE id = ?").get(id) as {
      scope: string;
      confidence: number;
    };
    expect(row.scope).toBe("convention");
    expect(row.confidence).toBe(0.9);

    db.close();
  });

  it("does not promote observations already at convention scope", () => {
    const db = createTestDb();

    insertObservation(db, {
      scope: "convention",
      confidence: 0.8,
      hitCount: 5,
      lastHitAt: Date.now(),
    });

    const promoted = promoteFrequentObservations(db);
    expect(promoted).toBe(0);

    db.close();
  });

  it("does not promote observations with fewer than 3 hits", () => {
    const db = createTestDb();

    insertObservation(db, {
      scope: "architecture",
      confidence: 0.7,
      hitCount: 2,
      lastHitAt: Date.now(),
    });

    const promoted = promoteFrequentObservations(db);
    expect(promoted).toBe(0);

    db.close();
  });
});

describe("observation demotion", () => {
  it("reduces confidence for observations with no hits for 30+ days", () => {
    const db = createTestDb();

    const oldTime = Date.now() - THIRTY_DAYS_MS - 1000;
    const id = insertObservation(db, {
      confidence: 0.8,
      lastHitAt: oldTime,
      createdAt: oldTime,
    });

    const demoted = demoteStaleObservations(db);
    expect(demoted).toBe(1);

    const row = db.prepare("SELECT confidence, archived FROM observations WHERE id = ?").get(id) as {
      confidence: number;
      archived: number;
    };
    expect(row.confidence).toBeLessThan(0.8);
    expect(row.archived).toBe(0);

    db.close();
  });

  it("reduces confidence based on null last_hit_at using created_at", () => {
    const db = createTestDb();

    const oldTime = Date.now() - 2 * THIRTY_DAYS_MS;
    const id = insertObservation(db, {
      confidence: 0.5,
      lastHitAt: null,
      createdAt: oldTime,
    });

    const demoted = demoteStaleObservations(db);
    expect(demoted).toBe(1);

    const row = db.prepare("SELECT confidence FROM observations WHERE id = ?").get(id) as {
      confidence: number;
    };
    expect(row.confidence).toBeCloseTo(0.3, 1);

    db.close();
  });

  it("archives observation when confidence drops below 0.1", () => {
    const db = createTestDb();

    const veryOldTime = Date.now() - 5 * THIRTY_DAYS_MS;
    const id = insertObservation(db, {
      confidence: 0.3,
      lastHitAt: veryOldTime,
      createdAt: veryOldTime,
    });

    const demoted = demoteStaleObservations(db);
    expect(demoted).toBe(1);

    const row = db.prepare("SELECT confidence, archived FROM observations WHERE id = ?").get(id) as {
      confidence: number;
      archived: number;
    };
    expect(row.confidence).toBeLessThan(0.1);
    expect(row.archived).toBe(1);

    db.close();
  });

  it("does not demote recent observations", () => {
    const db = createTestDb();

    insertObservation(db, {
      confidence: 0.8,
      lastHitAt: Date.now(),
      createdAt: Date.now(),
    });

    const demoted = demoteStaleObservations(db);
    expect(demoted).toBe(0);

    db.close();
  });
});
