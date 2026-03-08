import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-dynamic-dispatch-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
}

describe("dynamic dispatch edges", () => {
  it("creates dynamic_dispatch edges from emitter emits to registered handlers", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "events.ts"),
      `const bus = createBus();

export function handleReady() {
  return "ready";
}

export function wireReadyListener() {
  bus.on("ready", handleReady);
}

export function emitReady() {
  bus.emit("ready");
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const emitReady = symbols.getByName("emitReady").find((symbol) => symbol.kind === "function");
    const handleReady = symbols.getByName("handleReady").find((symbol) => symbol.kind === "function");

    expect(emitReady).toBeDefined();
    expect(handleReady).toBeDefined();

    const outgoing = edges.getBySource(emitReady!.id);
    const dynamicTargets = new Set(
      outgoing.filter((edge) => edge.kind === "dynamic_dispatch").map((edge) => edge.targetSymbolId)
    );

    expect(dynamicTargets.has(handleReady!.id)).toBe(true);
    db.close();
  });

  it("creates dynamic_dispatch edges from registry dispatchers to registered handlers", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "registry.ts"),
      `const registry = createRegistry();

export function saveDraft() {
  return "saved";
}

export function registerSaveAction() {
  registry.register("save", saveDraft);
}

export function runSaveAction() {
  registry.dispatch("save");
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const runSaveAction = symbols.getByName("runSaveAction").find((symbol) => symbol.kind === "function");
    const saveDraft = symbols.getByName("saveDraft").find((symbol) => symbol.kind === "function");

    expect(runSaveAction).toBeDefined();
    expect(saveDraft).toBeDefined();

    const outgoing = edges.getBySource(runSaveAction!.id);
    const dynamicTargets = new Set(
      outgoing.filter((edge) => edge.kind === "dynamic_dispatch").map((edge) => edge.targetSymbolId)
    );

    expect(dynamicTargets.has(saveDraft!.id)).toBe(true);
    db.close();
  });
});
