import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { weightedBfsTraversal } from "../../src/core/weighted-bfs.js";

let db: Database.Database;
let chainIds: number[] = [];

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();

  // Build a chain of 10 symbols: s0 → s1 → s2 → ... → s9
  // Each edge is an import between same-dir files with effective cost 0.6 / 0.8 = 0.75.
  // With maxDepth=7 and no maxHops, deep nodes remain reachable by cost budget alone.
  for (let i = 0; i < 10; i++) {
    const fileId = files.insert({
      path: `src/chain/node${i}.ts`,
      hash: `h${i}`,
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 1,
      error: null,
    });
    const symId = syms.insert({
      fileId,
      name: `chainNode${i}`,
      kind: "function",
      startLine: 1,
      endLine: 5,
      signature: `function chainNode${i}()`,
      bodyHash: `bh${i}`,
      fullSource: "",
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
    });
    chainIds.push(symId);
  }

  // Connect as a chain with import edges
  for (let i = 0; i < chainIds.length - 1; i++) {
    edges.insert({
      sourceSymbolId: chainIds[i]!,
      targetSymbolId: chainIds[i + 1]!,
      kind: "import",
      createdAt: now,
    });
  }
});

afterAll(() => db?.close());

describe("BFS maxHops cap", () => {
  it("without maxHops reaches deep nodes via many cheap edges", () => {
    // Same-dir import cost = 0.6 / 0.8 = 0.75 per hop.
    // With maxDepth=7, BFS can traverse 7/0.75 ≈ 9 hops.
    const nodes = weightedBfsTraversal(db, [chainIds[0]!], 7);
    const reachedNames = nodes.map((n) => {
      return symbolQueries(db).getById(n.symbolId)?.name;
    });
    // Should reach node 8 (hop 8, cost 8 * 0.75 = 6.0 < 7)
    expect(reachedNames).toContain("chainNode8");
  });

  it("maxHops=4 stops traversal after 4 edges even if cost budget allows more", () => {
    const nodes = weightedBfsTraversal(db, [chainIds[0]!], 7, null, { maxHops: 4 });
    const symsQ = symbolQueries(db);
    const reachedNames = nodes.map((n) => symsQ.getById(n.symbolId)?.name);

    // With maxHops=4, we can reach nodes 0 through 4 (4 hops from start)
    expect(reachedNames).toContain("chainNode0");
    expect(reachedNames).toContain("chainNode4");
    // Node 5 requires 5 hops — must NOT be included
    expect(reachedNames).not.toContain("chainNode5");
  });

  it("maxHops=1 only includes the pivot and its direct neighbors", () => {
    const nodes = weightedBfsTraversal(db, [chainIds[0]!], 7, null, { maxHops: 1 });
    const symsQ = symbolQueries(db);
    const reachedNames = nodes.map((n) => symsQ.getById(n.symbolId)?.name);

    expect(reachedNames).toContain("chainNode0");
    expect(reachedNames).toContain("chainNode1"); // 1 hop
    expect(reachedNames).not.toContain("chainNode2"); // 2 hops
  });
});
