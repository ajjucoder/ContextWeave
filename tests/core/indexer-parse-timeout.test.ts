import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import type { ParseResult } from "../../src/core/types.js";

const {
  mockParseFile,
  mockDetectLanguage,
  mockSetTimeoutMicros,
  mockWarn,
} = vi.hoisted(() => ({
  mockParseFile: vi.fn(),
  mockDetectLanguage: vi.fn((filePath: string) => filePath.endsWith(".ts") ? "typescript" : null),
  mockSetTimeoutMicros: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock("../../src/core/parser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/parser.js")>();
  return {
    ...actual,
    detectLanguage: mockDetectLanguage,
    initParser: vi.fn(() => ({
      setTimeoutMicros: mockSetTimeoutMicros,
      getTimeoutMicros: vi.fn(() => 0),
    })),
    parseFile: mockParseFile,
  };
});

vi.mock("../../src/utils/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/logger.js")>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mockWarn,
      error: vi.fn(),
    })),
  };
});

function timedOutParseResult(filePath: string): ParseResult {
  return {
    symbols: [],
    imports: [],
    calls: [],
    frameworkCalls: [],
    variableBindings: [],
    errors: [`Parse timed out for ${filePath} after 5000ms`],
    timedOut: true,
  };
}

function successfulParseResult(): ParseResult {
  return {
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
  };
}

describe("indexer parse timeouts", () => {
  let root: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    root = join(tmpdir(), `cw-index-timeout-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("skips timed-out files during single-file indexing", async () => {
    const timeoutFile = join(root, "timeout.ts");
    writeFileSync(timeoutFile, "export const timeout = true;");
    mockParseFile.mockReturnValue(timedOutParseResult(timeoutFile));

    const { indexSingleFile } = await import("../../src/core/indexer.js");
    const db = new Database(":memory:");
    runMigrations(db);

    try {
      const result = await indexSingleFile(db, timeoutFile, root);

      expect(result.symbolCount).toBe(0);
      expect(result.errors).toEqual([`Parse timed out for ${timeoutFile} after 5000ms`]);
      expect(mockSetTimeoutMicros.mock.calls).toEqual(
        expect.arrayContaining([[5_000_000], [0]])
      );
      expect(mockWarn).toHaveBeenCalledWith(
        "skipping file after parse timeout",
        expect.objectContaining({
          filePath: timeoutFile,
          timeoutMs: 5000,
        })
      );
      const fileCount = db.prepare("SELECT COUNT(*) as count FROM files").get() as { count: number };
      expect(fileCount.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
