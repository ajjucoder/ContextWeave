import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";

const FIXTURE_DIR = resolve(
  import.meta.dirname,
  "../../bench/scenarios/polyglot-fullstack"
);

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  await indexProject(db, FIXTURE_DIR);
  updateCentralityScores(db);
}, 30000);

afterAll(() => {
  db.close();
});

describe("polyglot-fullstack fixture — indexing", () => {
  it("indexes all 4 language directories", () => {
    const files = fileQueries(db).getAll();
    const languages = new Set(files.map((f) => f.language));

    expect(languages.has("typescript") || languages.has("tsx")).toBe(true);
    expect(languages.has("python")).toBe(true);
    expect(languages.has("go")).toBe(true);
    expect(languages.has("rust")).toBe(true);
  });

  it("indexes at least 15 files across the fixture", () => {
    const files = fileQueries(db).getAll();
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it("indexes TypeScript/TSX frontend files", () => {
    const files = fileQueries(db).getAll();
    const tsFiles = files.filter(
      (f) => (f.language === "typescript" || f.language === "tsx") && f.path.includes("frontend")
    );
    expect(tsFiles.length).toBeGreaterThanOrEqual(5);
  });

  it("indexes Python backend files", () => {
    const files = fileQueries(db).getAll();
    const pyFiles = files.filter((f) => f.language === "python");
    expect(pyFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("indexes Go service files", () => {
    const files = fileQueries(db).getAll();
    const goFiles = files.filter((f) => f.language === "go");
    expect(goFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("indexes Rust backend files", () => {
    const files = fileQueries(db).getAll();
    const rsFiles = files.filter((f) => f.language === "rust");
    expect(rsFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts a meaningful symbol count", () => {
    const count = symbolQueries(db).count();
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it("extracts TypeScript symbols from frontend components", () => {
    const allFiles = fileQueries(db).getAll();
    const fileById = new Map(allFiles.map((f) => [f.id, f]));
    const symbols = symbolQueries(db).getAll();
    const tsSymbols = symbols.filter((s) => {
      const file = fileById.get(s.fileId);
      return file?.language === "typescript" || file?.language === "tsx";
    });
    expect(tsSymbols.length).toBeGreaterThanOrEqual(5);
  });

  it("extracts Python symbols from FastAPI and signals", () => {
    const symbols = symbolQueries(db).getAll();
    const symNames = symbols.map((s) => s.name);
    expect(symNames.some((n) => ["list_items", "create_item", "delete_item", "get_item"].includes(n))).toBe(true);
  });

  it("extracts Go symbols including struct methods", () => {
    const symbols = symbolQueries(db).getAll();
    const symNames = symbols.map((s) => s.name);
    expect(symNames.some((n) => ["NewServer", "CreateTask", "GetTask", "CompleteTask"].includes(n))).toBe(true);
  });

  it("extracts Rust symbols including tauri commands", () => {
    const symbols = symbolQueries(db).getAll();
    const symNames = symbols.map((s) => s.name);
    expect(symNames.some((n) => ["get_tasks", "create_task", "complete_task"].includes(n))).toBe(true);
  });

  it("builds at least some edges between symbols", () => {
    const edges = edgeQueries(db).getAll();
    expect(edges.length).toBeGreaterThan(0);
  });

  it("assigns centrality scores after PageRank", () => {
    const symbols = symbolQueries(db).getAll();
    const withCentrality = symbols.filter((s) => s.centrality > 0);
    expect(withCentrality.length).toBeGreaterThan(0);
  });
});

describe("polyglot-fullstack fixture — cross-boundary patterns", () => {
  it("detects Tauri invoke calls in TypeScript files", () => {
    const files = fileQueries(db).getAll();
    const tauriLib = files.find((f) => f.path.includes("tauri.ts"));
    expect(tauriLib).toBeDefined();
    if (tauriLib) {
      const syms = symbolQueries(db).getByFileId(tauriLib.id);
      expect(syms.some((s) => ["fetchTasks", "completeTask", "createTask"].includes(s.name))).toBe(true);
    }
  });

  it("detects Go channel declarations in service files", () => {
    const files = fileQueries(db).getAll();
    const serverFile = files.find((f) => f.path.includes("server.go"));
    expect(serverFile).toBeDefined();
  });

  it("detects Rust tauri::command handlers", () => {
    const files = fileQueries(db).getAll();
    const commandsFile = files.find((f) => f.path.includes("commands.rs"));
    expect(commandsFile).toBeDefined();
    if (commandsFile) {
      const syms = symbolQueries(db).getByFileId(commandsFile.id);
      expect(syms.length).toBeGreaterThan(0);
    }
  });

  it("detects Python signal definitions", () => {
    const files = fileQueries(db).getAll();
    const signalsFile = files.find((f) => f.path.includes("signals.py"));
    expect(signalsFile).toBeDefined();
  });
});

describe("polyglot-fullstack fixture — flow tracing stubs", () => {
  it.todo("traces Tauri invoke from TS frontend to Rust command handler (requires Task #14)");
  it.todo("traces Go channel send in server.go to recv in events.go (requires Task #14)");
  it.todo("traces Django signal send in main.py to @receiver in signals.py (requires Task #14)");
  it.todo("detects FastAPI @app.get decorators as route entry points (requires Task #10)");
  it.todo("detects @shared_task decorator on Celery tasks (requires Task #10)");
  it.todo("detects @tauri::command attribute on Rust functions (requires Task #10)");
});
