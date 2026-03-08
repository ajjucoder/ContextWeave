import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { indexDirectory, indexProject, indexSingleFile } from "../../src/core/indexer.js";

describe("unsupported language diagnostics", () => {
  let projectRoot = "";
  let db: Database.Database;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "cw-unsupported-lang-"));
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns an explicit error for unsupported single-file indexing", async () => {
    const swiftFile = join(projectRoot, "Widget.swift");
    writeFileSync(swiftFile, "struct Widget {}\n");

    const result = await indexSingleFile(db, swiftFile, projectRoot);

    expect(result.symbolCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Unsupported language");
    expect(result.errors[0]).toContain(".swift");
  });

  it("reports unsupported extensions while indexing a project", async () => {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "main.ts"), "export const main = 1;\n");
    writeFileSync(join(projectRoot, "src", "Widget.swift"), "struct Widget {}\n");
    writeFileSync(join(projectRoot, "src", "Service.kt"), "class Service\n");

    const result = await indexProject(db, projectRoot);
    const unsupportedSummary = result.errors.find((err) => err.startsWith("Skipped ") && err.includes("unsupported files"));

    expect(result.filesIndexed).toBe(1);
    expect(result.symbolsFound).toBeGreaterThan(0);
    expect(unsupportedSummary).toBeDefined();
    expect(unsupportedSummary).toContain(".swift");
    expect(unsupportedSummary).toContain(".kt");
  });

  it("reports unsupported extensions while indexing a directory", async () => {
    const targetDir = join(projectRoot, "src");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "Widget.swift"), "struct Widget {}\n");

    const result = await indexDirectory(db, targetDir, projectRoot);

    expect(result.filesIndexed).toBe(0);
    expect(result.symbolsFound).toBe(0);
    expect(result.errors.some((err) => err.includes("unsupported files") && err.includes(".swift"))).toBe(true);
  });
});
