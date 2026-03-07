import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSubscribe = vi.fn();
const mockIndexSingleFile = vi.fn();
const mockRemoveFile = vi.fn();
const mockIndexProject = vi.fn();
const mockCaptureFileChangeObservation = vi.fn();
const mockGetByPath = vi.fn();
const mockPropagateFromDiff = vi.fn();
const mockDetectLanguage = vi.fn((filePath: string) => (filePath.endsWith(".ts") ? "typescript" : null));

vi.mock("@parcel/watcher", () => ({
  subscribe: mockSubscribe,
}));

vi.mock("../../src/core/indexer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/indexer.js")>();
  return {
    ...actual,
    BUILTIN_IGNORE_PATTERNS: ["node_modules", "dist", "build"],
    indexSingleFile: mockIndexSingleFile,
    removeFile: mockRemoveFile,
    indexProject: mockIndexProject,
  };
});

vi.mock("../../src/core/parser.js", () => ({
  detectLanguage: mockDetectLanguage,
}));

vi.mock("../../src/memory/staleness.js", () => ({
  StalenessEngine: class {
    propagateFromDiff = mockPropagateFromDiff;
  },
}));

vi.mock("../../src/db/queries/files.js", () => ({
  fileQueries: () => ({
    getByPath: mockGetByPath,
  }),
}));

vi.mock("../../src/memory/passive.js", () => ({
  captureFileChangeObservation: mockCaptureFileChangeObservation,
}));

describe("watcher behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reindexes changed files and removes deleted files", async () => {
    let callback: ((err: unknown, events: Array<{ type: string; path: string }>) => void) | undefined;
    const unsubscribe = vi.fn(async () => undefined);

    mockSubscribe.mockImplementation(async (_root: string, cb: typeof callback) => {
      callback = cb;
      return { unsubscribe };
    });

    mockIndexSingleFile.mockReturnValue({ symbolCount: 3, errors: [], diff: null });

    const { startWatcher, stopWatcher } = await import("../../src/core/watcher.js");
    const onReindex = vi.fn();
    const onRemove = vi.fn();
    const onError = vi.fn();
    const db = {} as never;

    await startWatcher({
      projectRoot: "/repo",
      db,
      onReindex,
      onRemove,
      onError,
    });

    callback?.(null, [{ type: "update", path: "/repo/src/file.ts" }]);
    callback?.(null, [{ type: "delete", path: "/repo/src/file.ts" }]);

    expect(mockIndexSingleFile).toHaveBeenCalledWith(db, "/repo/src/file.ts", "/repo", undefined);
    expect(onReindex).toHaveBeenCalledWith("/repo/src/file.ts", 3);
    expect(mockRemoveFile).toHaveBeenCalledWith(db, "/repo/src/file.ts");
    expect(onRemove).toHaveBeenCalledWith("/repo/src/file.ts");
    expect(onError).not.toHaveBeenCalled();

    await stopWatcher("/repo");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("triggers full reindex when .gitignore or .cwignore changes", async () => {
    let callback: ((err: unknown, events: Array<{ type: string; path: string }>) => void) | undefined;
    mockSubscribe.mockImplementation(async (_root: string, cb: typeof callback) => {
      callback = cb;
      return { unsubscribe: vi.fn(async () => undefined) };
    });

    mockIndexProject.mockResolvedValue({ filesIndexed: 4, symbolsFound: 9, errors: [] });

    const { startWatcher } = await import("../../src/core/watcher.js");
    const db = {} as never;
    await startWatcher({
      projectRoot: "/repo",
      db,
      ignore: ["coverage"],
    });

    callback?.(null, [{ type: "update", path: "/repo/.gitignore" }]);
    callback?.(null, [{ type: "update", path: "/repo/.cwignore" }]);

    await Promise.resolve();
    await Promise.resolve();

    expect(mockIndexProject).toHaveBeenCalledWith(db, "/repo", ["coverage"]);
    expect(mockIndexProject).toHaveBeenCalledTimes(2);
  });

  it("propagates diff callbacks for changed files", async () => {
    let callback: ((err: unknown, events: Array<{ type: string; path: string }>) => void) | undefined;
    mockSubscribe.mockImplementation(async (_root: string, cb: typeof callback) => {
      callback = cb;
      return { unsubscribe: vi.fn(async () => undefined) };
    });

    const diff = {
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
      unchanged: [],
    };
    mockIndexSingleFile.mockReturnValue({ symbolCount: 1, errors: [], diff });
    mockGetByPath.mockReturnValue({ id: 42 });

    const { startWatcher } = await import("../../src/core/watcher.js");
    const onDiff = vi.fn();
    const db = {} as never;

    await startWatcher({
      projectRoot: "/repo",
      db,
      sessionId: "session-x",
      onDiff,
    });

    callback?.(null, [{ type: "update", path: "/repo/src/file.ts" }]);

    expect(mockPropagateFromDiff).toHaveBeenCalledWith(diff, 42);
    expect(mockCaptureFileChangeObservation).toHaveBeenCalledWith(
      db,
      "/repo/src/file.ts",
      diff,
      42,
      "session-x",
      "/repo"
    );
    expect(onDiff).toHaveBeenCalledWith("/repo/src/file.ts", diff, 42);
  });

  it("skips changed files that become ignored after .gitignore updates", async () => {
    let callback: ((err: unknown, events: Array<{ type: string; path: string }>) => void) | undefined;
    mockSubscribe.mockImplementation(async (_root: string, cb: typeof callback) => {
      callback = cb;
      return { unsubscribe: vi.fn(async () => undefined) };
    });

    mockIndexProject.mockResolvedValue({ filesIndexed: 2, symbolsFound: 4, errors: [] });
    mockIndexSingleFile.mockReturnValue({ symbolCount: 1, errors: [], diff: null });

    const root = mkdtempSync(join(tmpdir(), "cw-watcher-ignore-"));
    writeFileSync(join(root, ".gitignore"), "");

    const { startWatcher } = await import("../../src/core/watcher.js");
    await startWatcher({
      projectRoot: root,
      db: {} as never,
      ignore: [],
    });

    writeFileSync(join(root, ".gitignore"), "generated/\n");
    callback?.(null, [{ type: "update", path: join(root, ".gitignore") }]);

    await Promise.resolve();
    await Promise.resolve();

    callback?.(null, [{ type: "update", path: join(root, "generated", "ignored.ts") }]);

    expect(mockIndexProject).toHaveBeenCalledWith({} as never, root, []);
    expect(mockIndexSingleFile).not.toHaveBeenCalled();
  });
});
