import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";

const workerCtor = vi.fn();

class MockWorker {
  private readonly handlers = new Map<string, (value: unknown) => void>();

  constructor(
    readonly script: string,
    readonly options: { workerData: { filePaths: string[] }; execArgv?: string[] }
  ) {
    workerCtor(script, options);
    queueMicrotask(() => {
      const now = Date.now();
      const results = options.workerData.filePaths.map((filePath, index) => ({
        filePath,
        content: `export function fn${index}() { return ${index}; }`,
        mtime: now,
        hash: `hash-${index}`,
        language: "typescript",
        parsedAt: now,
        parseResult: {
          symbols: [{
            name: `fn${index}`,
            kind: "function",
            startLine: 1,
            endLine: 1,
            signature: `function fn${index}(): number`,
            fullSource: `export function fn${index}() { return ${index}; }`,
            bodyHash: `body-${index}`,
            isExported: true,
            docComment: null,
          }],
          imports: [],
          calls: [],
          frameworkCalls: [],
          variableBindings: [],
          errors: [],
        },
        error: null,
      }));
      this.handlers.get("message")?.(results);
    });
  }

  once(event: string, handler: (value: unknown) => void): this {
    this.handlers.set(event, handler);
    return this;
  }
}

describe("parallel indexProject", () => {
  beforeEach(() => {
    workerCtor.mockReset();
    vi.doUnmock("node:worker_threads");
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("node:worker_threads");
  });

  it("indexes multiple files with worker-thread parsing", async () => {
    const dir = join(tmpdir(), `cw-par-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `file${i}.ts`), `export function fn${i}() { return ${i}; }`);
    }

    const db = new Database(":memory:");
    runMigrations(db);

    const { indexProject } = await import("../../src/core/indexer.js");
    const result = await indexProject(db, dir);
    expect(result.filesIndexed).toBe(5);
    expect(result.symbolsFound).toBeGreaterThanOrEqual(5);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses parser workers even when running from source", async () => {
    vi.doMock("node:worker_threads", () => ({
      Worker: MockWorker,
    }));
    const dir = join(tmpdir(), `cw-worker-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    for (let i = 0; i < 2; i++) {
      writeFileSync(join(dir, `worker${i}.ts`), `export function worker${i}() { return ${i}; }`);
    }

    const db = new Database(":memory:");
    runMigrations(db);

    const { indexProject: workerIndexProject } = await import("../../src/core/indexer.js");
    const result = await workerIndexProject(db, dir);

    expect(result.filesIndexed).toBe(2);
    expect(workerCtor).toHaveBeenCalled();
    expect(String(workerCtor.mock.calls[0]?.[0])).toContain("parser-worker-source.js");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
