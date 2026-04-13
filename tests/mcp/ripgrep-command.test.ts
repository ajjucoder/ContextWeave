import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
const execFileAsyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:util", () => ({
  promisify: () => execFileAsyncMock,
}));

describe("runRipgrepSearch command limits", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileAsyncMock.mockReset();
    vi.resetModules();
  });

  it("passes max-count to ripgrep to bound stdout before buffering", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });

    const { runRipgrepSearch } = await import("../../src/mcp/tools/ripgrep.js");
    await runRipgrepSearch("target", "/tmp/project", { maxResults: 5 });

    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
    const args = execFileAsyncMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--max-count");
    expect(args[args.indexOf("--max-count") + 1]).toBe("5");
  });
});
