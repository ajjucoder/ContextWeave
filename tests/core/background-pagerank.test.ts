import { beforeEach, describe, expect, it, vi } from "vitest";

const workerInstances: MockWorker[] = [];

class MockWorker {
  private readonly handlers = new Map<string, (value: unknown) => void>();
  readonly unref = vi.fn();

  constructor(
    readonly script: string,
    readonly options: { workerData: { dbPath: string }; execArgv?: string[] }
  ) {
    workerInstances.push(this);
  }

  once(event: string, handler: (value: unknown) => void): this {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event: "error" | "exit", value: unknown): void {
    this.handlers.get(event)?.(value);
  }
}

describe("runPageRankInBackground", () => {
  beforeEach(() => {
    workerInstances.length = 0;
    vi.doUnmock("node:worker_threads");
    vi.resetModules();
  });

  it("exports the background worker launcher", async () => {
    const { runPageRankInBackground } = await import("../../src/core/graph.js");
    expect(typeof runPageRankInBackground).toBe("function");
  });

  it("deduplicates concurrent launches and reruns once after exit", async () => {
    vi.doMock("node:worker_threads", () => ({
      Worker: MockWorker,
    }));
    const { runPageRankInBackground } = await import("../../src/core/graph.js");

    runPageRankInBackground("/tmp/contextweave.db");
    runPageRankInBackground("/tmp/contextweave.db");

    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0]?.unref).toHaveBeenCalledTimes(1);

    workerInstances[0]?.emit("exit", 0);
    await Promise.resolve();

    expect(workerInstances).toHaveLength(2);
    expect(workerInstances[1]?.unref).toHaveBeenCalledTimes(1);
  });

  it("allows separate databases to run in parallel", async () => {
    vi.doMock("node:worker_threads", () => ({
      Worker: MockWorker,
    }));
    const { runPageRankInBackground } = await import("../../src/core/graph.js");

    runPageRankInBackground("/tmp/one.db");
    runPageRankInBackground("/tmp/two.db");

    expect(workerInstances).toHaveLength(2);
  });
});
