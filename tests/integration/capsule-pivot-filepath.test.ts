import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

afterEach(() => {
  vi.resetModules();
  vi.unmock("../../src/db/queries/files.js");
});

describe("capsule path pivot lookup", () => {
  it("does not depend on files.getAll during capsule generation", async () => {
    const actualFilesModule = await vi.importActual<typeof import("../../src/db/queries/files.js")>(
      "../../src/db/queries/files.js"
    );

    vi.doMock("../../src/db/queries/files.js", () => ({
      ...actualFilesModule,
      fileQueries(db: Database.Database) {
        const queries = actualFilesModule.fileQueries(db);
        return {
          ...queries,
          getAll() {
            throw new Error("files.getAll should not be used in capsule generation");
          },
        };
      },
    }));

    const { createSchema } = await import("../../src/db/schema.js");
    const { fileQueries } = await import("../../src/db/queries/files.js");
    const { symbolQueries } = await import("../../src/db/queries/symbols.js");
    const { generateCapsule } = await import("../../src/capsule/generator.js");

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const now = Date.now();

    const fileId = files.insert({
      path: "/repo/src/features/sample-feature.ts",
      hash: "h",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });

    symbols.insert({
      fileId,
      name: "sampleFeatureHandler",
      kind: "function",
      startLine: 1,
      endLine: 3,
      signature: "function sampleFeatureHandler()",
      bodyHash: "bh",
      fullSource: "function sampleFeatureHandler() { return 1; }",
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
    });

    const result = generateCapsule(db, {
      query: "sample feature",
      tokenBudget: 1500,
      mode: "feature",
    });

    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    expect(result.content).toContain("sampleFeatureHandler");
    db.close();
  });
});
