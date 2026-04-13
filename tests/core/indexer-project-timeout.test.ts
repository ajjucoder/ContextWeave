import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";

const { workerMockState } = vi.hoisted(() => ({
  workerMockState: {
    enabled: false,
    payloadByPath: {} as Record<string, unknown>,
  },
}));

vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();

  function Worker(...args: ConstructorParameters<typeof actual.Worker>) {
    if (!workerMockState.enabled) {
      return new actual.Worker(...args);
    }

    const [, options] = args;
    const filePaths = (options as { workerData?: { filePaths?: string[] } } | undefined)?.workerData?.filePaths ?? [];

    return {
      once(event: string, handler: (value: unknown) => void) {
        if (event === "message") {
          queueMicrotask(() => {
            handler(
              filePaths
                .map((filePath) => workerMockState.payloadByPath[filePath])
                .filter((entry): entry is NonNullable<typeof entry> => entry != null)
            );
          });
        }
        return this;
      },
    };
  }

  return {
    ...actual,
    Worker,
  };
});

describe("indexProject timeout handling", () => {
  let root: string;

  beforeEach(() => {
    vi.resetModules();
    workerMockState.enabled = false;
    workerMockState.payloadByPath = {};
    root = join(tmpdir(), `cw-project-timeout-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("continues indexing other files when a worker reports a timeout", async () => {
    const timeoutFile = join(root, "timeout.ts");
    const okFile = join(root, "ok.ts");
    writeFileSync(timeoutFile, "export const timeout = true;");
    writeFileSync(okFile, "export function ok() { return 1; }");

    workerMockState.enabled = true;
    workerMockState.payloadByPath = {
      [timeoutFile]: {
        filePath: timeoutFile,
        content: "export const timeout = true;",
        mtime: Date.now(),
        hash: "hash-timeout",
        language: "typescript",
        parsedAt: Date.now(),
        parseResult: {
          symbols: [],
          imports: [],
          calls: [],
          frameworkCalls: [],
          variableBindings: [],
          errors: [`Parse timed out for ${timeoutFile} after 5000ms`],
          timedOut: true,
        },
        error: null,
      },
      [okFile]: {
        filePath: okFile,
        content: "export function ok() { return 1; }",
        mtime: Date.now(),
        hash: "hash-ok",
        language: "typescript",
        parsedAt: Date.now(),
        parseResult: {
          symbols: [
            {
              name: "ok",
              kind: "function",
              startLine: 1,
              endLine: 1,
              signature: "export function ok()",
              fullSource: "export function ok() { return 1; }",
              bodyHash: "hash-ok",
              isExported: true,
              docComment: null,
            },
          ],
          imports: [],
          calls: [],
          frameworkCalls: [],
          variableBindings: [],
          errors: [],
        },
        error: null,
      },
    };

    const { indexProject } = await import("../../src/core/indexer.js");
    const db = new Database(":memory:");
    runMigrations(db);

    try {
      const result = await indexProject(db, root);

      expect(result.symbolsFound).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("Parse timed out")])
      );

      const files = db.prepare("SELECT path FROM files ORDER BY path").all() as Array<{ path: string }>;
      expect(files).toEqual([{ path: "ok.ts" }]);
    } finally {
      db.close();
    }
  });
});
