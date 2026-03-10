import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { checkChainCoverage, type LayerCoverage } from "../../src/capsule/chain-coverage.js";
import type { ScoredNode } from "../../src/core/types.js";
import type { ArchLayer, RetrievalLane } from "../../src/core/repo-profiler.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

function makeScoredNode(fileId: number, path: string, symbolId: number, score: number): ScoredNode {
  return {
    symbol: {
      id: symbolId,
      fileId,
      name: `sym_${symbolId}`,
      kind: "function",
      startLine: 1,
      endLine: 10,
      signature: "fn()",
      bodyHash: "h",
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 0.5,
      lastSeen: Date.now(),
    },
    file: {
      id: fileId,
      path,
      hash: "h",
      lastIndexed: Date.now(),
      mtime: Date.now(),
      language: "typescript",
      symbolCount: 1,
      error: null,
    },
    score,
    distance: 1,
    compressionLevel: 0,
    rendered: "",
    tokenCount: 100,
  };
}

function insertFile(path: string): number {
  const now = Date.now();
  return fileQueries(db).insert({
    path,
    hash: `hash-${path}`,
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
}

function insertSymbol(fileId: number, name: string, isExported = true, centrality = 0.5): number {
  return symbolQueries(db).insert({
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 10,
    signature: `function ${name}()`,
    bodyHash: `body-${name}`,
    fullSource: `export function ${name}() {}`,
    isExported,
    docComment: null,
    centrality,
    lastSeen: Date.now(),
  });
}

function makeStorageLane(): RetrievalLane {
  return {
    name: "storage-lane",
    layer: "storage",
    pathPrefixes: ["src/db/"],
    fileGlobs: ["**/*.ts"],
    priority: 10,
  };
}

function makeServerLane(): RetrievalLane {
  return {
    name: "server-lane",
    layer: "server",
    pathPrefixes: ["src/server/"],
    fileGlobs: ["**/*.ts"],
    priority: 10,
  };
}

describe("checkChainCoverage", () => {
  it("returns empty result when expectedLayers is empty", () => {
    const result = checkChainCoverage(db, "/project", [], [], [makeStorageLane()]);

    expect(result.coverages).toHaveLength(0);
    expect(result.fillNodes).toHaveLength(0);
    expect(result.missingLayers).toHaveLength(0);
  });

  it("returns empty result when lanes is empty", () => {
    const result = checkChainCoverage(db, "/project", [], ["storage"], []);

    expect(result.coverages).toHaveLength(0);
    expect(result.fillNodes).toHaveLength(0);
    expect(result.missingLayers).toHaveLength(0);
  });

  it("detects all layers covered when nodes match lane prefixes", () => {
    const fileId = insertFile("src/db/user-repo.ts");
    const symId = insertSymbol(fileId, "UserRepo");

    const node = makeScoredNode(fileId, "src/db/user-repo.ts", symId, 0.9);
    const lanes = [makeStorageLane()];
    const expectedLayers: ArchLayer[] = ["storage"];

    const result = checkChainCoverage(db, "/project", [node], expectedLayers, lanes);

    expect(result.missingLayers).toHaveLength(0);
    expect(result.fillNodes).toHaveLength(0);
    expect(result.coverages).toHaveLength(1);
    expect(result.coverages[0]!.layer).toBe("storage");
    expect(result.coverages[0]!.count).toBe(1);
    expect(result.coverages[0]!.filled).toBe(0);
  });

  it("detects missing layer and fills with symbols from missing layer", () => {
    const storageFileId = insertFile("src/db/queries.ts");
    const storageSymId = insertSymbol(storageFileId, "runQuery");

    const serverFileId = insertFile("src/server/handler.ts");
    insertSymbol(serverFileId, "handleRequest");

    const node = makeScoredNode(storageFileId, "src/db/queries.ts", storageSymId, 0.8);
    const lanes = [makeStorageLane(), makeServerLane()];
    const expectedLayers: ArchLayer[] = ["storage", "server"];

    const result = checkChainCoverage(db, "/project", [node], expectedLayers, lanes);

    expect(result.missingLayers).toContain("server");
    expect(result.fillNodes).toHaveLength(1);
    expect(result.fillNodes[0]!.file.path).toBe("src/server/handler.ts");
  });

  it("caps fill at MAX_FILL_PER_LAYER (3) even when more files exist", () => {
    for (let i = 0; i < 10; i++) {
      const fid = insertFile(`src/server/handler-${i}.ts`);
      insertSymbol(fid, `handle${i}`);
    }

    const lanes = [makeServerLane()];
    const expectedLayers: ArchLayer[] = ["server"];

    const result = checkChainCoverage(db, "/project", [], expectedLayers, lanes);

    expect(result.fillNodes).toHaveLength(3);
    expect(result.missingLayers).toContain("server");
  });

  it("fill score is 0.3 times the median of existing node scores", () => {
    const storageFileId = insertFile("src/db/base.ts");
    const storageSymId = insertSymbol(storageFileId, "baseQuery");

    const serverFileId = insertFile("src/server/app.ts");
    insertSymbol(serverFileId, "startApp");

    const nodes = [
      makeScoredNode(storageFileId, "src/db/base.ts", storageSymId, 0.6),
      makeScoredNode(storageFileId, "src/db/base.ts", storageSymId, 0.4),
    ];

    const lanes = [makeStorageLane(), makeServerLane()];
    const expectedLayers: ArchLayer[] = ["storage", "server"];

    const result = checkChainCoverage(db, "/project", nodes, expectedLayers, lanes);

    const medianScore = 0.5;
    const expectedFillScore = medianScore * 0.3;

    expect(result.fillNodes).toHaveLength(1);
    expect(result.fillNodes[0]!.score).toBeCloseTo(expectedFillScore, 5);
  });

  it("does not include files already present in nodes as fill candidates", () => {
    const serverFileId = insertFile("src/server/existing.ts");
    const serverSymId = insertSymbol(serverFileId, "existingHandler");

    const storageFileId = insertFile("src/db/repo.ts");
    insertSymbol(storageFileId, "repoQuery");

    const node = makeScoredNode(serverFileId, "src/server/existing.ts", serverSymId, 0.7);

    const lanes = [makeStorageLane(), makeServerLane()];
    const expectedLayers: ArchLayer[] = ["storage", "server"];

    const result = checkChainCoverage(db, "/project", [node], expectedLayers, lanes);

    const fillPaths = result.fillNodes.map((n) => n.file.path);
    expect(fillPaths).not.toContain("src/server/existing.ts");
    expect(fillPaths).toContain("src/db/repo.ts");
  });

  it("reports correct count and filled metadata on each LayerCoverage", () => {
    const s1 = insertFile("src/db/repo.ts");
    const s1sym = insertSymbol(s1, "repoQuery");
    const s2 = insertFile("src/db/repo2.ts");
    const s2sym = insertSymbol(s2, "repoQuery2");

    const serverFileId = insertFile("src/server/route.ts");
    insertSymbol(serverFileId, "routeHandler");

    const nodes = [
      makeScoredNode(s1, "src/db/repo.ts", s1sym, 0.8),
      makeScoredNode(s2, "src/db/repo2.ts", s2sym, 0.6),
    ];

    const lanes = [makeStorageLane(), makeServerLane()];
    const expectedLayers: ArchLayer[] = ["storage", "server"];

    const result = checkChainCoverage(db, "/project", nodes, expectedLayers, lanes);

    const storageCoverage = result.coverages.find((c) => c.layer === "storage");
    const serverCoverage = result.coverages.find((c) => c.layer === "server");

    expect(storageCoverage).toBeDefined();
    expect(storageCoverage!.count).toBe(2);
    expect(storageCoverage!.filled).toBe(0);

    expect(serverCoverage).toBeDefined();
    expect(serverCoverage!.filled).toBe(1);
    expect(result.fillNodes).toHaveLength(1);
    expect(result.missingLayers).toContain("server");
  });

  it("uses minimum fill score of 0.01 when existing nodes have zero scores", () => {
    const storageFileId = insertFile("src/db/zero.ts");
    const storageSymId = insertSymbol(storageFileId, "zeroFn");

    const serverFileId = insertFile("src/server/zero-server.ts");
    insertSymbol(serverFileId, "zeroHandler");

    const node = makeScoredNode(storageFileId, "src/db/zero.ts", storageSymId, 0);

    const lanes = [makeStorageLane(), makeServerLane()];
    const expectedLayers: ArchLayer[] = ["storage", "server"];

    const result = checkChainCoverage(db, "/project", [node], expectedLayers, lanes);

    expect(result.fillNodes).toHaveLength(1);
    expect(result.fillNodes[0]!.score).toBe(0.01);
  });

  it("fill nodes have distance 99 and compressionLevel 2", () => {
    const serverFileId = insertFile("src/server/fill-target.ts");
    insertSymbol(serverFileId, "fillTarget");

    const lanes = [makeServerLane()];
    const expectedLayers: ArchLayer[] = ["server"];

    const result = checkChainCoverage(db, "/project", [], expectedLayers, lanes);

    expect(result.fillNodes).toHaveLength(1);
    expect(result.fillNodes[0]!.distance).toBe(99);
    expect(result.fillNodes[0]!.compressionLevel).toBe(2);
  });

  it("skips fill for missing layers that have no matching path prefixes in lanes", () => {
    const noLaneLane: RetrievalLane = {
      name: "ui-lane",
      layer: "ui-component",
      pathPrefixes: [],
      fileGlobs: [],
      priority: 5,
    };

    const lanes = [noLaneLane];
    const expectedLayers: ArchLayer[] = ["ui-component"];

    const result = checkChainCoverage(db, "/project", [], expectedLayers, lanes);

    expect(result.missingLayers).toContain("ui-component");
    expect(result.fillNodes).toHaveLength(0);
  });

  it("files without symbols are skipped during fill", () => {
    const serverFileId = insertFile("src/server/empty.ts");

    const node = makeScoredNode(serverFileId, "src/server/empty.ts", 999, 0.5);

    const storageFileNoSym = insertFile("src/db/no-sym.ts");

    const lanes = [makeStorageLane(), makeServerLane()];
    const expectedLayers: ArchLayer[] = ["storage", "server"];

    const result = checkChainCoverage(db, "/project", [node], expectedLayers, lanes);

    expect(result.fillNodes).toHaveLength(0);
    expect(result.missingLayers).toContain("storage");
  });
});
