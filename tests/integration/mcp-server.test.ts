import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConnect = vi.fn();
const mockStartWatcher = vi.fn();
const mockStopWatcher = vi.fn();
const mockSyncBootstrapObservations = vi.fn();
const mockRunMigrations = vi.fn();
const mockGetDb = vi.fn(() => ({ mocked: true }));
const mockFileQueriesCount = vi.fn(() => 0);
const mockFileQueries = vi.fn(() => ({ count: mockFileQueriesCount }));
const mockCloseDb = vi.fn();
const mockBackfillSummariesIfNeeded = vi.fn();
const mockBackfillClustersIfNeeded = vi.fn();
const mockAcquireServerSessionLock = vi.fn();
const mockReleaseServerSessionLock = vi.fn();
const mockRandomUUID = vi.fn(() => "server-session");

const registeredToolsByServer: string[][] = [];

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    _registeredTools: Record<string, unknown> = {};

    tool(name: string, _description: string, inputSchema: unknown, handler: unknown): void {
      this._registeredTools[name] = { inputSchema, handler };
      const bucket = registeredToolsByServer[registeredToolsByServer.length - 1];
      bucket?.push(name);
    }

    connect = mockConnect;

    constructor(_options: unknown) {
      registeredToolsByServer.push([]);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

vi.mock("node:crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../../src/db/connection.js", () => ({
  getDb: mockGetDb,
  closeDb: mockCloseDb,
}));

vi.mock("../../src/db/migrations.js", () => ({
  runMigrations: mockRunMigrations,
}));

vi.mock("../../src/core/watcher-v2.js", () => ({
  startWatcher: mockStartWatcher,
  stopWatcher: mockStopWatcher,
}));

vi.mock("../../src/core/file-summaries.js", () => ({
  backfillSummariesIfNeeded: mockBackfillSummariesIfNeeded,
}));

vi.mock("../../src/core/clusters.js", () => ({
  backfillClustersIfNeeded: mockBackfillClustersIfNeeded,
}));

vi.mock("../../src/mcp/session-lock.js", () => ({
  acquireServerSessionLock: mockAcquireServerSessionLock,
  releaseServerSessionLock: mockReleaseServerSessionLock,
}));

vi.mock("../../src/memory/bootstrap.js", () => ({
  syncBootstrapObservations: mockSyncBootstrapObservations,
}));

vi.mock("../../src/db/queries/files.js", () => ({
  fileQueries: mockFileQueries,
}));

describe("startMcpServer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    registeredToolsByServer.length = 0;
    mockAcquireServerSessionLock.mockReturnValue({ mode: "primary", lockPath: "/tmp/contextweave.lock" });
    mockConnect.mockResolvedValue(undefined);
    mockStartWatcher.mockResolvedValue(undefined);
    mockStopWatcher.mockResolvedValue(undefined);
    mockBackfillSummariesIfNeeded.mockReturnValue(false);
    mockBackfillClustersIfNeeded.mockReturnValue(false);
    vi.spyOn(process, "once").mockImplementation(((..._args: unknown[]) => process) as typeof process.once);
    vi.spyOn(process, "on").mockImplementation(((..._args: unknown[]) => process) as typeof process.on);
  });

  it("registers the full primary toolset and starts the watcher", async () => {
    const { startMcpServer } = await import("../../src/mcp/server.js");

    await startMcpServer("/repo", { version: 1, ignore: ["coverage"], tokenBudget: 4000, defaultMode: "feature", stalenessDepth: 2, confidenceDecay: 0.1, gcThreshold: 0.1 });

    expect(mockGetDb).toHaveBeenCalledWith("/repo/.contextweave/contextweave.db", { scheduleMaintenance: true });
    expect(mockRunMigrations).toHaveBeenCalled();
    expect(mockBackfillSummariesIfNeeded).toHaveBeenCalledWith({ mocked: true });
    expect(mockBackfillClustersIfNeeded).toHaveBeenCalledWith({ mocked: true }, "/repo");
    expect(mockSyncBootstrapObservations).toHaveBeenCalled();
    expect(mockStartWatcher).toHaveBeenCalledWith({
      projectRoot: "/repo",
      db: { mocked: true },
      embeddingRuntime: null,
      ignore: ["coverage"],
      sessionId: "server-session",
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(registeredToolsByServer[0]).toEqual(expect.arrayContaining([
      "cw_capsule",
      "cw_status",
      "cw_snapshot",
      "cw_stats",
      "cw_remember",
      "cw_reindex",
    ]));
  });

  it("skips write-heavy tools and watcher startup in secondary mode", async () => {
    mockAcquireServerSessionLock.mockReturnValue({ mode: "secondary", lockPath: "/tmp/contextweave.lock" });
    const { startMcpServer } = await import("../../src/mcp/server.js");

    await startMcpServer("/repo");

    expect(mockGetDb).toHaveBeenCalledWith("/repo/.contextweave/contextweave.db", { scheduleMaintenance: false });
    expect(mockStartWatcher).not.toHaveBeenCalled();
    expect(registeredToolsByServer[0]).toEqual(expect.arrayContaining([
      "cw_capsule",
      "cw_status",
      "cw_snapshot",
      "cw_stats",
      "cw_reindex",
    ]));
    expect(registeredToolsByServer[0]).not.toContain("cw_remember");
  });

  it("cleans up watcher, db, and lock when startup fails after watcher init", async () => {
    mockConnect.mockRejectedValue(new Error("startup failed"));
    const { startMcpServer } = await import("../../src/mcp/server.js");

    await expect(startMcpServer("/repo")).rejects.toThrow("startup failed");

    expect(mockStopWatcher).toHaveBeenCalledWith("/repo");
    expect(mockCloseDb).toHaveBeenCalled();
    expect(mockReleaseServerSessionLock).toHaveBeenCalledTimes(1);
  });
});
