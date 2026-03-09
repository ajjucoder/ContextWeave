import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;

function insertSymbol(filePath: string, name: string, options: { centrality?: number; fullSource?: string } = {}): number {
  const now = Date.now();
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const existingFile = files.getByPath(filePath);
  const fileId = existingFile?.id ?? files.insert({
    path: filePath,
    hash: `${filePath}-hash`,
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });

  return symbols.insert({
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 20,
    signature: `function ${name}()`,
    bodyHash: `${name}-body`,
    fullSource: options.fullSource ?? `export function ${name}() { return ${JSON.stringify(name)}; }`,
    isExported: true,
    docComment: null,
    centrality: options.centrality ?? 0.05,
    lastSeen: now,
  });
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("exact-match capsule fast path", () => {
  it("keeps the exact symbol as the top structured result even when a neighbor is more central", () => {
    insertSymbol("src/hooks/use-data-layer.ts", "useDataLayer", { centrality: 0.0001 });
    insertSymbol("src/runtime/use-data-layer-bridge.ts", "useDataLayerRuntimeBridge", {
      centrality: 0.8,
      fullSource: "export function useDataLayerRuntimeBridge() { return useDataLayer(); }",
    });

    const result = generateCapsule(db, { query: "useDataLayer", tokenBudget: 1800 });

    const firstFile = result.structured?.files[0];
    expect(firstFile?.path).toMatch(/use-data-layer\.ts$/);
    expect(firstFile?.symbols).toContain("useDataLayer");
  });

  it("skips content fallback noise for exact matches and keeps only the direct call neighborhood", () => {
    const exactId = insertSymbol("src/core/recommend-fanout.ts", "recommendFanout", {
      fullSource: "export function recommendFanout() { return buildRecommendations(); }",
    });
    const callerId = insertSymbol("src/routes/recommend-route.ts", "handleRecommendRoute", {
      fullSource: "export function handleRecommendRoute() { return recommendFanout(); }",
    });
    const calleeId = insertSymbol("src/core/build-recommendations.ts", "buildRecommendations", {
      fullSource: "export function buildRecommendations() { return ['ok']; }",
    });

    const edges = edgeQueries(db);
    const now = Date.now();
    edges.insert({ sourceSymbolId: callerId, targetSymbolId: exactId, kind: "call", createdAt: now });
    edges.insert({ sourceSymbolId: exactId, targetSymbolId: calleeId, kind: "call", createdAt: now });

    for (let index = 0; index < 8; index += 1) {
      insertSymbol(`src/noise/noise-${index}.ts`, `noiseSymbol${index}`, {
        fullSource: `export function noiseSymbol${index}() { return 'recommendFanout background mention ${index}'; }`,
      });
    }

    const result = generateCapsule(db, { query: "recommendFanout", tokenBudget: 2200 });

    expect(result.content).toContain("recommendFanout");
    expect(result.content).toContain("handleRecommendRoute");
    expect(result.content).toContain("buildRecommendations");
    expect(result.content).not.toContain("noiseSymbol0");
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBe(3);
    expect(new Set(result.metadata.filesIncluded)).toEqual(new Set([
      "src/core/recommend-fanout.ts",
      "src/routes/recommend-route.ts",
      "src/core/build-recommendations.ts",
    ]));
  });
});