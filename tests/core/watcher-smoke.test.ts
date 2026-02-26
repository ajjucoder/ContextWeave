import { describe, expect, it } from "vitest";

describe("watcher module", () => {
  it("can import startWatcher without error", async () => {
    const mod = await import("../../src/core/watcher.js");
    expect(typeof mod.startWatcher).toBe("function");
    expect(typeof mod.stopWatcher).toBe("function");
  });
});
