import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { writeFileSync, rmSync, mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TEMP_DIR = resolve(__dirname, "../tmp-db-corruption");

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("database corruption recovery pattern", () => {
  it("detects and recovers from corrupt database files", () => {
    mkdirSync(TEMP_DIR, { recursive: true });
    const dbPath = resolve(TEMP_DIR, "test.db");
    writeFileSync(dbPath, "THIS IS NOT A VALID SQLITE DATABASE FILE");

    let recovered = false;
    let db: Database.Database | null = null;

    try {
      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
    } catch {
      if (db) {
        try { db.close(); } catch {}
        db = null;
      }

      try {
        renameSync(dbPath, `${dbPath}.corrupt`);
      } catch {
        try { unlinkSync(dbPath); } catch {}
      }

      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      recovered = true;
    }

    expect(recovered).toBe(true);
    expect(db).not.toBeNull();

    const result = db!.prepare("SELECT 1 as value").get() as { value: number };
    expect(result.value).toBe(1);

    expect(existsSync(`${dbPath}.corrupt`)).toBe(true);

    db!.close();
  });

  it("opens a fresh database without needing recovery", () => {
    mkdirSync(TEMP_DIR, { recursive: true });
    const dbPath = resolve(TEMP_DIR, "fresh.db");

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    const result = db.prepare("SELECT 1 as value").get() as { value: number };
    expect(result.value).toBe(1);

    db.close();
  });
});
