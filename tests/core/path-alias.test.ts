import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-alias-"));
  tempRoots.push(root);
  return root;
}

describe("TypeScript path alias resolution", () => {
  it("resolves @/* alias to correct file — excludes wrong-file duplicates from import edges", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "utils"), { recursive: true });
    mkdirSync(join(root, "src", "legacy"), { recursive: true });
    mkdirSync(join(root, "src", "app"), { recursive: true });

    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      })
    );

    writeFileSync(
      join(root, "src", "utils", "format.ts"),
      `export function formatDate(d: Date): string {
  return d.toISOString();
}
`
    );

    writeFileSync(
      join(root, "src", "legacy", "format.ts"),
      `export function formatDate(d: Date): string {
  return d.toString();
}
`
    );

    writeFileSync(
      join(root, "src", "app", "page.ts"),
      `import { formatDate } from "@/utils/format";

export function renderPage() {
  return formatDate(new Date());
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const files = fileQueries(db);

    const renderPage = symbols.getByName("renderPage").find((s) => s.kind === "function");
    expect(renderPage).toBeDefined();

    const pageEdges = edges.getBySource(renderPage!.id);
    const importEdges = pageEdges.filter((e) => e.kind === "import");
    const importTargetIds = new Set(importEdges.map((e) => e.targetSymbolId));

    const allFormatDates = symbols.getByName("formatDate");
    expect(allFormatDates.length).toBe(2);

    const utilsFormatDate = allFormatDates.find((s) => {
      const file = files.getById(s.fileId);
      return file?.path.includes("utils/format");
    });
    const legacyFormatDate = allFormatDates.find((s) => {
      const file = files.getById(s.fileId);
      return file?.path.includes("legacy/format");
    });

    expect(utilsFormatDate).toBeDefined();
    expect(legacyFormatDate).toBeDefined();

    expect(importTargetIds.has(utilsFormatDate!.id)).toBe(true);
    expect(importTargetIds.has(legacyFormatDate!.id)).toBe(false);

    db.close();
  });

  it("resolves baseUrl-relative imports without path aliases", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    mkdirSync(join(root, "src", "old"), { recursive: true });
    mkdirSync(join(root, "src", "app"), { recursive: true });

    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "src" },
      })
    );

    writeFileSync(
      join(root, "src", "lib", "math.ts"),
      `export function add(a: number, b: number): number {
  return a + b;
}
`
    );

    writeFileSync(
      join(root, "src", "old", "math.ts"),
      `export function add(a: number, b: number): number {
  return a + b + 0;
}
`
    );

    writeFileSync(
      join(root, "src", "app", "calc.ts"),
      `import { add } from "lib/math";

export function calculate() {
  return add(1, 2);
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const files = fileQueries(db);

    const calculate = symbols.getByName("calculate").find((s) => s.kind === "function");
    expect(calculate).toBeDefined();

    const calcEdges = edges.getBySource(calculate!.id);
    const importEdges = calcEdges.filter((e) => e.kind === "import");
    const importTargetIds = new Set(importEdges.map((e) => e.targetSymbolId));

    const libAdd = symbols.getByName("add").find((s) => {
      const file = files.getById(s.fileId);
      return file?.path.includes("lib/math");
    });

    expect(libAdd).toBeDefined();
    expect(importTargetIds.has(libAdd!.id)).toBe(true);

    const oldAdd = symbols.getByName("add").find((s) => {
      const file = files.getById(s.fileId);
      return file?.path.includes("old/math");
    });

    if (oldAdd) {
      expect(importTargetIds.has(oldAdd.id)).toBe(false);
    }

    db.close();
  });
});
