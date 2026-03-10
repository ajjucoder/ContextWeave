import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import {
  buildConventionGraph,
  persistConventions,
  loadConventions,
  formatConventionSummary,
} from "../../src/core/convention-graph.js";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  return db;
}

function insertFile(db: Database.Database, path: string): number {
  const files = fileQueries(db);
  const now = Date.now();
  return files.insert({
    path,
    hash: "h",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
}

function insertSymbol(db: Database.Database, fileId: number, name: string): number {
  const syms = symbolQueries(db);
  const now = Date.now();
  return syms.insert({
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 10,
    signature: "fn()",
    bodyHash: `bh_${name}`,
    fullSource: "",
    isExported: true,
    docComment: null,
    centrality: 0,
    lastSeen: now,
  });
}

function insertEdge(db: Database.Database, sourceSymbolId: number, targetSymbolId: number): void {
  const edges = edgeQueries(db);
  edges.insert({
    sourceSymbolId,
    targetSymbolId,
    kind: "import",
    createdAt: Date.now(),
  });
}

describe("buildConventionGraph", () => {
  it("returns empty graph when project has no files", () => {
    const db = setupDb();
    const graph = buildConventionGraph(db, "");

    expect(graph.conventions).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);

    db.close();
  });

  it("detects naming conventions from file paths", () => {
    const db = setupDb();

    insertFile(db, "src/user.controller.ts");
    insertFile(db, "src/auth.controller.ts");
    insertFile(db, "src/user.service.ts");
    insertFile(db, "src/email.service.ts");
    insertFile(db, "src/user.model.ts");
    insertFile(db, "src/post.model.ts");

    const graph = buildConventionGraph(db, "");

    const names = graph.conventions.map((c) => c.name);
    expect(names).toContain("controllers");
    expect(names).toContain("services");
    expect(names).toContain("models");

    db.close();
  });

  it("detects directory conventions from file paths", () => {
    const db = setupDb();

    insertFile(db, "src/controllers/user.ts");
    insertFile(db, "src/controllers/auth.ts");
    insertFile(db, "src/services/auth.ts");
    insertFile(db, "src/services/mail.ts");

    const graph = buildConventionGraph(db, "");

    const names = graph.conventions.map((c) => c.name);
    expect(names).toContain("controllers");
    expect(names).toContain("services");

    db.close();
  });

  it("does not include a convention when fewer than 2 files match", () => {
    const db = setupDb();

    insertFile(db, "src/user.controller.ts");
    insertFile(db, "src/user.service.ts");
    insertFile(db, "src/auth.service.ts");

    const graph = buildConventionGraph(db, "");

    const names = graph.conventions.map((c) => c.name);
    expect(names).not.toContain("controllers");
    expect(names).toContain("services");

    db.close();
  });

  it("includes conventions for files that have symbol edges between them", () => {
    const db = setupDb();

    const controllerFileA = insertFile(db, "src/controllers/user.ts");
    const controllerFileB = insertFile(db, "src/controllers/auth.ts");
    const serviceFileA = insertFile(db, "src/services/user.ts");
    const serviceFileB = insertFile(db, "src/services/auth.ts");

    const controllerSym = insertSymbol(db, controllerFileA, "UserController");
    const controllerSym2 = insertSymbol(db, controllerFileB, "AuthController");
    const serviceSym = insertSymbol(db, serviceFileA, "UserService");
    const serviceSym2 = insertSymbol(db, serviceFileB, "AuthService");

    insertEdge(db, controllerSym, serviceSym);
    insertEdge(db, controllerSym2, serviceSym2);

    const graph = buildConventionGraph(db, "");

    const names = graph.conventions.map((c) => c.name);
    expect(names).toContain("controllers");
    expect(names).toContain("services");

    db.close();
  });

  it("does not create convention edges when no symbol edges exist between conventions", () => {
    const db = setupDb();

    insertFile(db, "src/controllers/user.ts");
    insertFile(db, "src/controllers/auth.ts");
    insertFile(db, "src/services/user.ts");
    insertFile(db, "src/services/auth.ts");

    const graph = buildConventionGraph(db, "");

    expect(graph.edges).toHaveLength(0);

    db.close();
  });

  it("classifies files matching both naming and directory patterns consistently", () => {
    const db = setupDb();

    insertFile(db, "src/hooks/useAuth.hook.ts");
    insertFile(db, "src/hooks/useUser.hook.ts");
    insertFile(db, "src/hooks/usePosts.hook.ts");

    const graph = buildConventionGraph(db, "");

    const hookConvention = graph.conventions.find((c) => c.name === "hooks");
    expect(hookConvention).toBeDefined();
    expect(hookConvention!.fileCount).toBeGreaterThanOrEqual(2);

    db.close();
  });

  it("assigns correct layer to detected naming conventions", () => {
    const db = setupDb();

    insertFile(db, "src/user.controller.ts");
    insertFile(db, "src/auth.controller.ts");

    const graph = buildConventionGraph(db, "");

    const ctrl = graph.conventions.find((c) => c.name === "controllers");
    expect(ctrl).toBeDefined();
    expect(ctrl!.layer).toBe("api-route");

    db.close();
  });

  it("assigns correct layer to detected directory conventions", () => {
    const db = setupDb();

    insertFile(db, "src/services/user.ts");
    insertFile(db, "src/services/auth.ts");

    const graph = buildConventionGraph(db, "");

    const svc = graph.conventions.find((c) => c.name === "services");
    expect(svc).toBeDefined();
    expect(svc!.layer).toBe("server");

    db.close();
  });

  it("handles files that match no known convention without error", () => {
    const db = setupDb();

    insertFile(db, "src/random/file-a.ts");
    insertFile(db, "src/random/file-b.ts");
    insertFile(db, "src/another/thing.ts");

    const graph = buildConventionGraph(db, "");

    expect(graph.conventions).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);

    db.close();
  });
});

describe("persistConventions + loadConventions", () => {
  it("roundtrips conventions and edges through SQLite", () => {
    const db = setupDb();

    const graph = {
      conventions: [
        { id: "controllers", name: "controllers", layer: "api-route" as const, source: "naming" as const, fileCount: 3 },
        { id: "services", name: "services", layer: "server" as const, source: "naming" as const, fileCount: 4 },
      ],
      edges: [
        { sourceConvention: "controllers", targetConvention: "services", edgeCount: 7 },
      ],
    };

    persistConventions(db, graph);
    const loaded = loadConventions(db);

    expect(loaded.conventions).toHaveLength(2);
    expect(loaded.edges).toHaveLength(1);

    const ctrl = loaded.conventions.find((c) => c.id === "controllers");
    expect(ctrl).toBeDefined();
    expect(ctrl!.name).toBe("controllers");
    expect(ctrl!.layer).toBe("api-route");
    expect(ctrl!.source).toBe("naming");
    expect(ctrl!.fileCount).toBe(3);

    const edge = loaded.edges[0];
    expect(edge!.sourceConvention).toBe("controllers");
    expect(edge!.targetConvention).toBe("services");
    expect(edge!.edgeCount).toBe(7);

    db.close();
  });

  it("overwrites previously persisted conventions on re-persist", () => {
    const db = setupDb();

    const first = {
      conventions: [
        { id: "controllers", name: "controllers", layer: "api-route" as const, source: "naming" as const, fileCount: 2 },
      ],
      edges: [],
    };

    persistConventions(db, first);

    const second = {
      conventions: [
        { id: "services", name: "services", layer: "server" as const, source: "naming" as const, fileCount: 5 },
        { id: "models", name: "models", layer: "storage" as const, source: "naming" as const, fileCount: 3 },
      ],
      edges: [
        { sourceConvention: "services", targetConvention: "models", edgeCount: 4 },
      ],
    };

    persistConventions(db, second);
    const loaded = loadConventions(db);

    expect(loaded.conventions).toHaveLength(2);
    expect(loaded.conventions.map((c) => c.id)).not.toContain("controllers");
    expect(loaded.conventions.map((c) => c.id)).toContain("services");
    expect(loaded.conventions.map((c) => c.id)).toContain("models");

    db.close();
  });

  it("roundtrips an empty graph without error", () => {
    const db = setupDb();

    persistConventions(db, { conventions: [], edges: [] });
    const loaded = loadConventions(db);

    expect(loaded.conventions).toHaveLength(0);
    expect(loaded.edges).toHaveLength(0);

    db.close();
  });

  it("persists and reloads unknown layer value", () => {
    const db = setupDb();

    const graph = {
      conventions: [
        { id: "utilities", name: "utilities", layer: "unknown" as const, source: "naming" as const, fileCount: 2 },
      ],
      edges: [],
    };

    persistConventions(db, graph);
    const loaded = loadConventions(db);

    expect(loaded.conventions[0]!.layer).toBe("unknown");

    db.close();
  });
});

describe("loadConventions", () => {
  it("returns empty graph when conventions table does not exist", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    const graph = loadConventions(db);

    expect(graph.conventions).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);

    db.close();
  });

  it("returns empty graph when tables exist but are empty", () => {
    const db = setupDb();

    persistConventions(db, { conventions: [], edges: [] });
    const loaded = loadConventions(db);

    expect(loaded.conventions).toHaveLength(0);
    expect(loaded.edges).toHaveLength(0);

    db.close();
  });
});

describe("formatConventionSummary", () => {
  it("returns empty array for an empty graph", () => {
    const lines = formatConventionSummary({ conventions: [], edges: [] });
    expect(lines).toHaveLength(0);
  });

  it("includes convention names in output", () => {
    const graph = {
      conventions: [
        { id: "controllers", name: "controllers", layer: "api-route" as const, source: "naming" as const, fileCount: 3 },
        { id: "services", name: "services", layer: "server" as const, source: "naming" as const, fileCount: 5 },
      ],
      edges: [],
    };

    const lines = formatConventionSummary(graph);
    const joined = lines.join("\n");

    expect(joined).toContain("controllers");
    expect(joined).toContain("services");
  });

  it("groups conventions by layer in output", () => {
    const graph = {
      conventions: [
        { id: "controllers", name: "controllers", layer: "api-route" as const, source: "naming" as const, fileCount: 2 },
        { id: "resolvers", name: "resolvers", layer: "api-route" as const, source: "naming" as const, fileCount: 2 },
        { id: "services", name: "services", layer: "server" as const, source: "naming" as const, fileCount: 3 },
      ],
      edges: [],
    };

    const lines = formatConventionSummary(graph);
    const joined = lines.join("\n");

    expect(joined).toContain("api-route");
    expect(joined).toContain("server");
  });

  it("includes file counts next to convention names", () => {
    const graph = {
      conventions: [
        { id: "services", name: "services", layer: "server" as const, source: "naming" as const, fileCount: 7 },
      ],
      edges: [],
    };

    const lines = formatConventionSummary(graph);
    const joined = lines.join("\n");

    expect(joined).toContain("services (7)");
  });

  it("includes top dependency flows when edges are present", () => {
    const graph = {
      conventions: [
        { id: "controllers", name: "controllers", layer: "api-route" as const, source: "naming" as const, fileCount: 2 },
        { id: "services", name: "services", layer: "server" as const, source: "naming" as const, fileCount: 3 },
      ],
      edges: [
        { sourceConvention: "controllers", targetConvention: "services", edgeCount: 12 },
      ],
    };

    const lines = formatConventionSummary(graph);
    const joined = lines.join("\n");

    expect(joined).toContain("controllers");
    expect(joined).toContain("services");
    expect(joined).toContain("12");
  });

  it("limits displayed edges to top 5 by edge count", () => {
    const conventions = Array.from({ length: 6 }, (_, i) => ({
      id: `conv${i}`,
      name: `conv${i}`,
      layer: "server" as const,
      source: "naming" as const,
      fileCount: 2,
    }));

    const edges = [
      { sourceConvention: "conv0", targetConvention: "conv1", edgeCount: 10 },
      { sourceConvention: "conv0", targetConvention: "conv2", edgeCount: 8 },
      { sourceConvention: "conv1", targetConvention: "conv2", edgeCount: 6 },
      { sourceConvention: "conv2", targetConvention: "conv3", edgeCount: 4 },
      { sourceConvention: "conv3", targetConvention: "conv4", edgeCount: 2 },
      { sourceConvention: "conv4", targetConvention: "conv5", edgeCount: 1 },
    ];

    const lines = formatConventionSummary({ conventions, edges });
    const flowLines = lines.filter((l) => l.includes("->"));

    expect(flowLines).toHaveLength(5);
  });

  it("starts output with Architectural Conventions header", () => {
    const graph = {
      conventions: [
        { id: "services", name: "services", layer: "server" as const, source: "naming" as const, fileCount: 2 },
      ],
      edges: [],
    };

    const lines = formatConventionSummary(graph);

    expect(lines[0]).toBe("Architectural Conventions:");
  });
});

describe("buildConventionGraph + persistConventions + loadConventions integration", () => {
  it("builds, persists, and reloads a graph with same convention data", () => {
    const db = setupDb();

    insertFile(db, "src/controllers/user.ts");
    insertFile(db, "src/controllers/auth.ts");
    insertFile(db, "src/services/user.ts");
    insertFile(db, "src/services/auth.ts");

    const built = buildConventionGraph(db, "");
    persistConventions(db, built);
    const loaded = loadConventions(db);

    expect(loaded.conventions).toHaveLength(built.conventions.length);

    for (const expected of built.conventions) {
      const actual = loaded.conventions.find((c) => c.id === expected.id);
      expect(actual).toBeDefined();
      expect(actual!.name).toBe(expected.name);
      expect(actual!.layer).toBe(expected.layer);
      expect(actual!.fileCount).toBe(expected.fileCount);
    }

    db.close();
  });
});
