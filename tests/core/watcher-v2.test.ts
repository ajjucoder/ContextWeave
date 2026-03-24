import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWatch = vi.fn();
const mockIndexSingleFile = vi.fn();
const mockRemoveFile = vi.fn();
const mockIndexProject = vi.fn();
const mockCaptureFileChangeObservation = vi.fn();
const mockGetByPath = vi.fn();
const mockPropagateFromDiff = vi.fn();
const mockDetectLanguage = vi.fn((filePath: string) => (filePath.endsWith(".ts") ? "typescript" : null));

vi.mock("chokidar", () => ({
  watch: mockWatch,
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

vi.mock("../../src/core/parser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/parser.js")>();
  return {
    ...actual,
    detectLanguage: mockDetectLanguage,
  };
});

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

describe("watcher-v2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("debounces rapid file changes until 2 seconds after the latest event", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const close = vi.fn(async () => undefined);
    const watcher = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
        return watcher;
      },
      close,
    };
    mockWatch.mockReturnValue(watcher);
    mockIndexSingleFile.mockResolvedValue({ symbolCount: 3, errors: [], diff: null });

    const { startWatcher, stopWatcher } = await import("../../src/core/watcher-v2.js");
    const onReindex = vi.fn();
    const db = {} as never;

    await startWatcher({ projectRoot: "/repo", db, onReindex });

    handlers.get("all")?.("change", "/repo/src/file.ts");
    await vi.advanceTimersByTimeAsync(1500);
    handlers.get("all")?.("change", "/repo/src/file.ts");
    await vi.advanceTimersByTimeAsync(499);

    expect(mockIndexSingleFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1501);

    expect(mockIndexSingleFile).toHaveBeenCalledTimes(1);
    expect(mockIndexSingleFile).toHaveBeenCalledWith(
      db,
      "/repo/src/file.ts",
      "/repo",
      undefined,
      { embeddings: undefined }
    );
    expect(onReindex).toHaveBeenCalledWith("/repo/src/file.ts", 3);

    await stopWatcher("/repo");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("removes deleted files immediately from the index", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const watcher = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
        return watcher;
      },
      close: vi.fn(async () => undefined),
    };
    mockWatch.mockReturnValue(watcher);

    const { startWatcher } = await import("../../src/core/watcher-v2.js");
    const onRemove = vi.fn();
    const db = {} as never;

    await startWatcher({ projectRoot: "/repo", db, onRemove });
    handlers.get("all")?.("unlink", "/repo/src/file.ts");

    expect(mockRemoveFile).toHaveBeenCalledWith(db, "/repo/src/file.ts", "/repo");
    expect(onRemove).toHaveBeenCalledWith("/repo/src/file.ts");
  });

  it("does not suppress deletes even when the same file was just reindexed", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const watcher = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
        return watcher;
      },
      close: vi.fn(async () => undefined),
    };
    mockWatch.mockReturnValue(watcher);
    mockIndexSingleFile.mockResolvedValue({ symbolCount: 2, errors: [], diff: null });

    const { startWatcher } = await import("../../src/core/watcher-v2.js");
    const db = {} as never;

    await startWatcher({ projectRoot: "/repo", db });
    handlers.get("all")?.("change", "/repo/src/file.ts");
    await vi.advanceTimersByTimeAsync(2000);
    handlers.get("all")?.("unlink", "/repo/src/file.ts");

    expect(mockIndexSingleFile).toHaveBeenCalledTimes(1);
    expect(mockRemoveFile).toHaveBeenCalledWith(db, "/repo/src/file.ts", "/repo");
  });

  it("suppresses duplicate processing for 10 seconds after a file is reindexed", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const watcher = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
        return watcher;
      },
      close: vi.fn(async () => undefined),
    };
    mockWatch.mockReturnValue(watcher);
    mockIndexSingleFile.mockResolvedValue({ symbolCount: 2, errors: [], diff: null });

    const { startWatcher } = await import("../../src/core/watcher-v2.js");
    await startWatcher({ projectRoot: "/repo", db: {} as never });

    handlers.get("all")?.("change", "/repo/src/file.ts");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockIndexSingleFile).toHaveBeenCalledTimes(1);

    handlers.get("all")?.("change", "/repo/src/file.ts");
    await vi.advanceTimersByTimeAsync(2500);
    expect(mockIndexSingleFile).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(7500);
    handlers.get("all")?.("change", "/repo/src/file.ts");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockIndexSingleFile).toHaveBeenCalledTimes(2);
  });

  it("propagates diffs after debounced reindexing", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const watcher = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
        return watcher;
      },
      close: vi.fn(async () => undefined),
    };
    mockWatch.mockReturnValue(watcher);

    const diff = {
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
      unchanged: [],
    };
    mockIndexSingleFile.mockResolvedValue({ symbolCount: 1, errors: [], diff });
    mockGetByPath.mockReturnValue({ id: 42 });

    const { startWatcher } = await import("../../src/core/watcher-v2.js");
    const onDiff = vi.fn();
    const db = {} as never;

    await startWatcher({
      projectRoot: "/repo",
      db,
      sessionId: "session-x",
      onDiff,
    });

    handlers.get("all")?.("change", "/repo/src/file.ts");
    await vi.advanceTimersByTimeAsync(2000);

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
});
