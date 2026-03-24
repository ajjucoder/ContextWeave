import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { searchFilesByQuery } from "../../src/core/file-summaries.js";

let db: Database.Database;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-noncode-formats-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "docs", "ADR"), { recursive: true });
  writeFileSync(
    join(root, "pyproject.toml"),
    "[tool.ruff]\nline-length = 100\n[tool.pytest.ini_options]\naddopts = \"-q\"\n"
  );
  writeFileSync(
    join(root, "config", "settings.ini"),
    "[runtime]\ncache_timeout = 45\nretry_attempts = 3\n"
  );
  writeFileSync(
    join(root, "docs", "ADR", "ADR-001-auth-tokens.md"),
    [
      "# ADR-001: Auth Tokens",
      "",
      "Use refresh tokens for session continuity.",
      "",
      "## Decision",
      "",
      "Store refresh tokens in HttpOnly cookies.",
      "",
    ].join("\n")
  );

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("indexer non-code config formats", () => {
  it("indexes TOML and INI files so they can contribute to first-pass search", async () => {
    await indexProject(db, root);

    const tomlResults = searchFilesByQuery(db, "ruff pytest line length", 10);
    const iniResults = searchFilesByQuery(db, "cache timeout retry attempts", 10);

    expect(tomlResults.some((result) => result.path.endsWith("pyproject.toml"))).toBe(true);
    expect(iniResults.some((result) => result.path.endsWith("config/settings.ini"))).toBe(true);
  });

  it("indexes markdown ADR documents for first-pass BM25 search", async () => {
    await indexProject(db, root);

    const results = searchFilesByQuery(db, "auth tokens HttpOnly cookies", 10, root);
    const adrResults = searchFilesByQuery(db, "ADR-001 auth tokens", 10, root);

    expect(results.some((result) => result.path.endsWith("docs/ADR/ADR-001-auth-tokens.md"))).toBe(true);
    expect(adrResults.some((result) => result.path.endsWith("docs/ADR/ADR-001-auth-tokens.md"))).toBe(true);
  });
});
