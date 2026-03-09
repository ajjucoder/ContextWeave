import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { detectPatterns } from "../../src/core/pattern-detector.js";
import { indexProject } from "../../src/core/indexer.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

function seedPage(filePath: string, suffix: string, hooks: string[] = ["useDataLayer", "useRouter"]): void {
  const now = Date.now();
  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);

  const fileId = files.insert({
    path: filePath,
    hash: `hash-${suffix}`,
    lastIndexed: now,
    mtime: now,
    language: "tsx",
    symbolCount: hooks.length + 1,
    error: null,
  });

  const defaultExportId = syms.insert({
    fileId,
    name: `Page${suffix}`,
    kind: "function",
    startLine: 1,
    endLine: 20,
    signature: `export default function Page${suffix}()`,
    bodyHash: `body-page-${suffix}`,
    fullSource: "export default function Page() { return null; }",
    isExported: true,
    docComment: null,
    centrality: 1,
    lastSeen: now,
  });

  hooks.forEach((hook, index) => {
    const hookId = syms.insert({
      fileId,
      name: hook,
      kind: "function",
      startLine: 21 + index,
      endLine: 21 + index,
      signature: `${hook}()`,
      bodyHash: `body-${hook}-${suffix}`,
      fullSource: `${hook}();`,
      isExported: false,
      docComment: null,
      centrality: 0.2,
      lastSeen: now,
    });
    edges.insert({ sourceSymbolId: defaultExportId, targetSymbolId: hookId, kind: "call", createdAt: now });
  });

  const reactImportId = syms.insert({
    fileId,
    name: "react",
    kind: "module",
    startLine: 0,
    endLine: 0,
    signature: "react",
    bodyHash: `body-react-${suffix}`,
    fullSource: "import React from 'react';",
    isExported: false,
    docComment: null,
    centrality: 0.1,
    lastSeen: now,
  });
  const dataImportId = syms.insert({
    fileId,
    name: "@/lib/data-layer",
    kind: "module",
    startLine: 0,
    endLine: 0,
    signature: "@/lib/data-layer",
    bodyHash: `body-data-${suffix}`,
    fullSource: "import { useDataLayer } from '@/lib/data-layer';",
    isExported: false,
    docComment: null,
    centrality: 0.1,
    lastSeen: now,
  });
  edges.insert({ sourceSymbolId: defaultExportId, targetSymbolId: reactImportId, kind: "import", createdAt: now });
  edges.insert({ sourceSymbolId: defaultExportId, targetSymbolId: dataImportId, kind: "import", createdAt: now });
}

describe("detectPatterns", () => {
  it("groups 3+ files with the same structural signature", () => {
    seedPage("src/app/dashboard/page.tsx", "Dashboard");
    seedPage("src/app/settings/page.tsx", "Settings");
    seedPage("src/app/reports/page.tsx", "Reports");

    const patterns = detectPatterns(db);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.files).toEqual([
      "src/app/dashboard/page.tsx",
      "src/app/reports/page.tsx",
      "src/app/settings/page.tsx",
    ]);
    expect(patterns[0]?.signature.directoryPattern).toBe("src/app/*/page.tsx");
    expect(patterns[0]?.signature.importShape).toContain("@/lib/data-layer");
    expect(patterns[0]?.signature.hookUsage).toEqual(["useDataLayer", "useRouter"]);
    expect(patterns[0]?.name).toContain("Page Pattern");
    expect(patterns[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("does not emit patterns for fewer than 3 matching files", () => {
    seedPage("src/app/dashboard/page.tsx", "Dashboard");
    seedPage("src/app/settings/page.tsx", "Settings");

    expect(detectPatterns(db)).toEqual([]);
  });

  it("stores detected patterns in the patterns table", () => {
    seedPage("src/app/dashboard/page.tsx", "Dashboard");
    seedPage("src/app/settings/page.tsx", "Settings");
    seedPage("src/app/reports/page.tsx", "Reports");

    detectPatterns(db);

    const row = db.prepare("SELECT name, files, confidence FROM patterns LIMIT 1").get() as
      | { name: string; files: string; confidence: number }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.name).toContain("Page Pattern");
    expect(JSON.parse(row?.files ?? "[]")).toHaveLength(3);
    expect(row?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("persists patterns automatically after indexProject completes", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-pattern-index-"));
    try {
      for (const name of ["dashboard", "settings", "reports"]) {
        const dir = join(root, "src", "app", name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "page.tsx"),
          `import React from "react";\nimport { useDataLayer } from "@/lib/data-layer";\nimport { useRouter } from "next/navigation";\nexport default function ${name}Page() {\n  useDataLayer();\n  useRouter();\n  return <div>${name}</div>;\n}\n`
        );
      }

      await indexProject(db, root);

      const count = (db.prepare("SELECT COUNT(*) AS count FROM patterns").get() as { count: number }).count;
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});