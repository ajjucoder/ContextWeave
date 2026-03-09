import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";

const TEMP_DIR = resolve(__dirname, "../tmp-edge-resolution");

describe("indexer edge resolution", () => {
  let db: Database.Database;

  beforeEach(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
    mkdirSync(TEMP_DIR, { recursive: true });

    writeFileSync(
      resolve(TEMP_DIR, "module.ts"),
      "export function handler(): number { return 1; }\n"
    );

    writeFileSync(
      resolve(TEMP_DIR, "importer.ts"),
      [
        "import { handler } from './module';",
        "export function run(): number {",
        "  return handler();",
        "}",
        "",
      ].join("\n")
    );

    for (let i = 0; i < 40; i++) {
      writeFileSync(
        resolve(TEMP_DIR, `noise_${i}.ts`),
        [
          `export function handler(): number { return ${i}; }`,
          "export function wrapper(): number {",
          "  return handler();",
          "}",
          "",
        ].join("\n")
      );
    }

    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it("keeps imported call edges scoped instead of fanning out to every same-name symbol", async () => {
    await indexProject(db, TEMP_DIR);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const importerFile = files.getByPath("importer.ts");
    const moduleFile = files.getByPath("module.ts");
    expect(importerFile).toBeDefined();
    expect(moduleFile).toBeDefined();

    const importerSymbols = symbols.getByFileId(importerFile!.id);
    const moduleSymbols = symbols.getByFileId(moduleFile!.id);

    const runSymbol = importerSymbols.find((s) => s.name === "run");
    const moduleHandler = moduleSymbols.find((s) => s.name === "handler");
    expect(runSymbol).toBeDefined();
    expect(moduleHandler).toBeDefined();

    const runOutgoing = edges.getBySource(runSymbol!.id);
    const callEdges = runOutgoing.filter((e) => e.kind === "call");

    expect(callEdges.some((e) => e.targetSymbolId === moduleHandler!.id)).toBe(true);
    expect(callEdges.length).toBeLessThanOrEqual(3);
    expect(edges.count()).toBeLessThan(250);
  });

  it("resolves CommonJS module alias imports to exported symbols in the required file", async () => {
    writeFileSync(
      resolve(TEMP_DIR, "application.js"),
      [
        "var app = exports = module.exports = {};",
        "app.init = function init() {",
        "  return app;",
        "};",
        "",
      ].join("\n")
    );

    writeFileSync(
      resolve(TEMP_DIR, "express.js"),
      [
        "var proto = require('./application');",
        "export function createApplication() {",
        "  return proto.init();",
        "}",
        "",
      ].join("\n")
    );

    await indexProject(db, TEMP_DIR);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const expressFile = files.getByPath("express.js");
    const applicationFile = files.getByPath("application.js");
    expect(expressFile).toBeDefined();
    expect(applicationFile).toBeDefined();

    const createApplication = symbols.getByFileId(expressFile!.id).find((s) => s.name === "createApplication");
    const appInit = symbols.getByFileId(applicationFile!.id).find((s) => s.name === "init");
    expect(createApplication).toBeDefined();
    expect(appInit).toBeDefined();

    const outgoing = edges.getBySource(createApplication!.id);
    const applicationTargets = outgoing.filter((edge) => {
      const target = symbols.getById(edge.targetSymbolId);
      return target?.fileId === applicationFile!.id;
    });

    expect(applicationTargets.some((edge) => edge.targetSymbolId === appInit!.id)).toBe(true);
  });
});
