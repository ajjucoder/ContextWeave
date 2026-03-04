import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-isexported-"));
  tempRoots.push(root);
  return root;
}

describe("isExported - Python convention", () => {
  it("marks public functions (no underscore prefix) as exported", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "mod.py"),
      `def public_function():
    return 42

def another_public():
    pass
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const syms = symbolQueries(db);
    const publicFn = syms.getByName("public_function")[0];
    expect(publicFn).toBeDefined();
    expect(publicFn!.isExported).toBe(true);

    db.close();
  });

  it("marks private functions (underscore prefix) as NOT exported", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "mod.py"),
      `def _private_function():
    return 42

def __dunder__():
    pass
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const syms = symbolQueries(db);
    const privateFn = syms.getByName("_private_function")[0];
    expect(privateFn).toBeDefined();
    expect(privateFn!.isExported).toBe(false);

    db.close();
  });
});

describe("isExported - Go convention", () => {
  it("marks uppercase-named functions as exported", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "main.go"),
      `package main

func PublicFunc() int {
    return 42
}

func privateFunc() int {
    return 0
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const syms = symbolQueries(db);
    const pub = syms.getByName("PublicFunc")[0];
    const priv = syms.getByName("privateFunc")[0];

    expect(pub).toBeDefined();
    expect(pub!.isExported).toBe(true);

    expect(priv).toBeDefined();
    expect(priv!.isExported).toBe(false);

    db.close();
  });
});
