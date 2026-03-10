import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { registerImpactTool, traceImpact } from "../../src/mcp/tools/impact.js";

const NOW = Date.now();

function makeFile(db: Database.Database, path: string): number {
  return fileQueries(db).insert({
    path,
    hash: `h-${path}`,
    lastIndexed: NOW,
    mtime: NOW,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
}

function makeSymbol(
  db: Database.Database,
  fileId: number,
  name: string,
  centrality = 0
): number {
  return symbolQueries(db).insert({
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 10,
    signature: `function ${name}()`,
    bodyHash: `bh-${name}-${fileId}`,
    fullSource: `function ${name}() {}`,
    isExported: true,
    docComment: null,
    centrality,
    lastSeen: NOW,
  });
}

let db: Database.Database;
const tempRoots: string[] = [];

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterEach(() => {
  db.close();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-impact-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
}

describe("traceImpact", () => {
  it("finds direct dependents at depth 1", () => {
    const fid = makeFile(db, "src/utils.ts");
    const fid2 = makeFile(db, "src/page.ts");
    const utilId = makeSymbol(db, fid, "doThing");
    const pageId = makeSymbol(db, fid2, "PageComponent");
    edgeQueries(db).insert({ sourceSymbolId: pageId, targetSymbolId: utilId, kind: "import", createdAt: NOW });

    const result = traceImpact(db, utilId, 3);
    expect(result.map((n) => n.name)).toContain("PageComponent");
  });

  it("finds transitive dependents at depth 2", () => {
    const fid = makeFile(db, "src/a.ts");
    const fid2 = makeFile(db, "src/b.ts");
    const fid3 = makeFile(db, "src/c.ts");
    const aId = makeSymbol(db, fid, "fnA");
    const bId = makeSymbol(db, fid2, "fnB");
    const cId = makeSymbol(db, fid3, "fnC");
    edgeQueries(db).insert({ sourceSymbolId: bId, targetSymbolId: aId, kind: "call", createdAt: NOW });
    edgeQueries(db).insert({ sourceSymbolId: cId, targetSymbolId: bId, kind: "call", createdAt: NOW });

    const result = traceImpact(db, aId, 3);
    const names = result.map((n) => n.name);
    expect(names).toContain("fnB");
    expect(names).toContain("fnC");
  });

  it("depth-2+ follows symbol-level edges: sibling in same file NOT included without edge", () => {
    // target: fnTarget in utils.ts
    // fnA in runner.ts imports fnTarget (depth-1 dependent)
    // fnB in runner.ts does NOT import fnTarget — should NOT appear at depth 2
    const utilsFileId = makeFile(db, "src/utils.ts");
    const runnerFileId = makeFile(db, "src/runner.ts");

    const fnTargetId = makeSymbol(db, utilsFileId, "fnTarget");
    const fnAId = makeSymbol(db, runnerFileId, "fnA");
    const fnBId = makeSymbol(db, runnerFileId, "fnB");

    // Only fnA depends on fnTarget — fnB has no edge
    edgeQueries(db).insert({ sourceSymbolId: fnAId, targetSymbolId: fnTargetId, kind: "import", createdAt: NOW });

    const result = traceImpact(db, fnTargetId, 3);
    const names = result.map((n) => n.name);

    expect(names).toContain("fnA");
    expect(names).not.toContain("fnB");
  });

  it("depth-2 traversal: consumer of fnA is included, but sibling in consumer file without edge is not", () => {
    const utilsFileId = makeFile(db, "src/utils.ts");
    const runnerFileId = makeFile(db, "src/runner.ts");
    const appFileId = makeFile(db, "src/app.ts");

    const fnTargetId = makeSymbol(db, utilsFileId, "evaluateRisk");
    const fnAId = makeSymbol(db, runnerFileId, "runPipeline");
    const fnBId = makeSymbol(db, runnerFileId, "readArrayTopPrice");
    const fnCId = makeSymbol(db, appFileId, "startApp");

    // runPipeline imports evaluateRisk (depth-1)
    edgeQueries(db).insert({ sourceSymbolId: fnAId, targetSymbolId: fnTargetId, kind: "import", createdAt: NOW });
    // startApp imports runPipeline (depth-2)
    edgeQueries(db).insert({ sourceSymbolId: fnCId, targetSymbolId: fnAId, kind: "call", createdAt: NOW });

    const result = traceImpact(db, fnTargetId, 3);
    const names = result.map((n) => n.name);

    expect(names).toContain("runPipeline");
    expect(names).toContain("startApp");
    expect(names).not.toContain("readArrayTopPrice");
  });

  it("does not exceed maxDepth", () => {
    const fid = makeFile(db, "src/deep.ts");
    const ids = Array.from({ length: 6 }, (_, i) => makeSymbol(db, fid, `fn${i}`));
    for (let i = 1; i < ids.length; i++) {
      edgeQueries(db).insert({ sourceSymbolId: ids[i]!, targetSymbolId: ids[i - 1]!, kind: "call", createdAt: NOW });
    }

    const result = traceImpact(db, ids[0]!, 2);
    const depths = result.map((n) => n.depth);
    expect(Math.max(...depths)).toBeLessThanOrEqual(2);
  });

  it("deduplicates when multiple pivots share a name (barrel re-export scenario)", () => {
    // Original symbol in implementation file
    const originalFileId = makeFile(db, "src/hooks/useDataLayer.ts");
    const barrelFileId = makeFile(db, "src/hooks/index.ts");
    const consumerFileId = makeFile(db, "src/components/EditPage.tsx");

    const originalId = makeSymbol(db, originalFileId, "useDataLayer", 0.8);
    const barrelId = makeSymbol(db, barrelFileId, "useDataLayer", 0.2);
    const editPageId = makeSymbol(db, consumerFileId, "EditPage");

    // Consumer imports via barrel (edge points to barrel, not original)
    edgeQueries(db).insert({ sourceSymbolId: editPageId, targetSymbolId: barrelId, kind: "import", createdAt: NOW });

    // Tracing the original symbol alone would miss EditPage
    const directResult = traceImpact(db, originalId, 3);
    expect(directResult.map((n) => n.name)).not.toContain("EditPage");

    // Tracing the barrel symbol finds EditPage
    const barrelResult = traceImpact(db, barrelId, 3);
    expect(barrelResult.map((n) => n.name)).toContain("EditPage");
  });

  it("follows same-directory barrel aliases for file:symbol targets in cw_impact", async () => {
    const originalFileId = makeFile(db, "src/hooks/useDataLayer.ts");
    const barrelFileId = makeFile(db, "src/hooks/index.ts");
    const consumerFileId = makeFile(db, "src/components/EditPage.tsx");

    const originalId = makeSymbol(db, originalFileId, "useDataLayer", 0.8);
    const barrelId = makeSymbol(db, barrelFileId, "useDataLayer", 0.2);
    const editPageId = makeSymbol(db, consumerFileId, "EditPage");

    edgeQueries(db).insert({ sourceSymbolId: editPageId, targetSymbolId: barrelId, kind: "import", createdAt: NOW });

    let handler:
      | ((args: { target: string; depth?: number }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>)
      | undefined;
    const fakeServer = {
      tool: (
        _name: string,
        _description: string,
        _schema: unknown,
        fn: (args: { target: string; depth?: number }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
      ) => {
        handler = fn;
      },
    };
    registerImpactTool(fakeServer as any, db);
    expect(handler).toBeDefined();

    const response = await handler!({
      target: "src/hooks/useDataLayer.ts:useDataLayer",
      depth: 3,
    });
    const text = response.content[0]?.text ?? "";
    expect(text).toContain("EditPage");
  });
});

describe("symbolQueries.getByFileAndName", () => {
  it("returns symbol by file ID and name", () => {
    const fid = makeFile(db, "src/types.ts");
    makeSymbol(db, fid, "SiteInterface");

    const result = symbolQueries(db).getByFileAndName(fid, "SiteInterface");
    expect(result).toBeDefined();
    expect(result?.name).toBe("SiteInterface");
  });

  it("returns undefined when name not in that file", () => {
    const fid = makeFile(db, "src/types.ts");
    makeSymbol(db, fid, "SiteInterface");
    const fid2 = makeFile(db, "src/other.ts");

    const result = symbolQueries(db).getByFileAndName(fid2, "SiteInterface");
    expect(result).toBeUndefined();
  });

  it("prefers highest centrality when multiple symbols share file+name", () => {
    const fid = makeFile(db, "src/utils.ts");
    makeSymbol(db, fid, "helper", 0.1);
    makeSymbol(db, fid, "helper", 0.9);

    const result = symbolQueries(db).getByFileAndName(fid, "helper");
    expect(result?.centrality).toBe(0.9);
  });
});

describe("fileQueries.getByPathSuffix", () => {
  it("finds file by exact path", () => {
    makeFile(db, "src/types.ts");
    const result = fileQueries(db).getByPathSuffix("src/types.ts");
    expect(result?.path).toBe("src/types.ts");
  });

  it("finds file by trailing path suffix", () => {
    makeFile(db, "src/hooks/useDataLayer.ts");
    const result = fileQueries(db).getByPathSuffix("useDataLayer.ts");
    expect(result?.path).toBe("src/hooks/useDataLayer.ts");
  });

  it("returns undefined when no file matches", () => {
    const result = fileQueries(db).getByPathSuffix("nonexistent.ts");
    expect(result).toBeUndefined();
  });

  it("prefers shorter path when multiple files match suffix", () => {
    makeFile(db, "src/types.ts");
    makeFile(db, "src/old/types.ts");
    const result = fileQueries(db).getByPathSuffix("types.ts");
    expect(result?.path).toBe("src/types.ts");
  });
});

describe("cw_impact class and callback tracing", () => {
  it("resolves qualified class methods when tracing callback-driven dependents", async () => {
    db.close();

    const root = makeTempProject();
    writeFileSync(
      join(root, "src", "Button.tsx"),
      `export function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Save</button>;
}
`
    );
    writeFileSync(
      join(root, "src", "ComposeModal.tsx"),
      `import { Button } from "./Button";

export class ComposeModal extends React.Component {
  handleSave() {
    return persistDraft();
  }

  render() {
    return <Button onClick={this.handleSave} />;
  }
}

export class CancelModal extends React.Component {
  handleSave() {
    return persistDiscard();
  }

  render() {
    return <Button onClick={this.handleSave} />;
  }
}

export function persistDraft() {
  return true;
}

export function persistDiscard() {
  return false;
}
`
    );

    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    await indexProject(db, root);

    let handler:
      | ((args: { target: string; depth?: number }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>)
      | undefined;
    const fakeServer = {
      tool: (
        _name: string,
        _description: string,
        _schema: unknown,
        fn: (args: { target: string; depth?: number }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
      ) => {
        handler = fn;
      },
    };
    registerImpactTool(fakeServer as any, db);

    const response = await handler!({
      target: "ComposeModal.handleSave",
      depth: 4,
    });
    const text = response.content[0]?.text ?? "";
    expect(text).toContain("ComposeModal.render");
    expect(text).not.toContain("CancelModal.render");
  });
});
