import { describe, it, expect, afterEach } from "vitest";
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
  const root = mkdtempSync(join(tmpdir(), "cw-edge-kinds-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
}

describe("inheritance edges", () => {
  it("creates inheritance edge for class extends", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "base.ts"),
      `export class BaseService {
  start() { return true; }
}
`
    );
    writeFileSync(
      join(root, "src", "child.ts"),
      `import { BaseService } from "./base";

export class ChildService extends BaseService {
  run() { return this.start(); }
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const childClass = symbols.getByName("ChildService").find((s) => s.kind === "class");
    expect(childClass).toBeDefined();

    const childEdges = edges.getBySource(childClass!.id);
    const inheritanceEdges = childEdges.filter((e) => e.kind === "inheritance");

    const targetNames = inheritanceEdges.map((e) => symbols.getById(e.targetSymbolId)?.name);
    expect(targetNames).toContain("BaseService");

    db.close();
  });
});

describe("implements edges", () => {
  it("creates implements edge for class implements interface", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "types.ts"),
      `export interface Serializable {
  serialize(): string;
}
`
    );
    writeFileSync(
      join(root, "src", "model.ts"),
      `import { Serializable } from "./types";

export class UserModel implements Serializable {
  serialize() { return JSON.stringify(this); }
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const userModel = symbols.getByName("UserModel").find((s) => s.kind === "class");
    expect(userModel).toBeDefined();

    const modelEdges = edges.getBySource(userModel!.id);
    const implementsEdges = modelEdges.filter((e) => e.kind === "implements");

    const targetNames = implementsEdges.map((e) => symbols.getById(e.targetSymbolId)?.name);
    expect(targetNames).toContain("Serializable");

    db.close();
  });
});

describe("type_usage edges", () => {
  it("creates type_usage edge for type annotation references", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "config.ts"),
      `export interface AppConfig {
  port: number;
  host: string;
}
`
    );
    writeFileSync(
      join(root, "src", "server.ts"),
      `import { AppConfig } from "./config";

export function startServer(config: AppConfig): void {
  console.log(config.host, config.port);
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const startServer = symbols.getByName("startServer").find((s) => s.kind === "function");
    expect(startServer).toBeDefined();

    const serverEdges = edges.getBySource(startServer!.id);
    const typeEdges = serverEdges.filter((e) => e.kind === "type_usage");

    const targetNames = typeEdges.map((e) => symbols.getById(e.targetSymbolId)?.name);
    expect(targetNames).toContain("AppConfig");

    db.close();
  });
});
