import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/core/graph.js", () => ({
  runPageRankInBackground: vi.fn(),
}));

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-cwignore-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), "export const x = 1;\n");
  return root;
}

describe(".cwignore template generation", () => {
  it("autoInit creates a .cwignore file with default patterns", async () => {
    const { autoInit } = await import("../../src/cli/commands/init.js");
    const root = makeTempRoot();

    await autoInit(root);

    const cwignorePath = resolve(root, ".cwignore");
    expect(existsSync(cwignorePath)).toBe(true);

    const content = readFileSync(cwignorePath, "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain("dist");
    expect(content).toContain(".git");
    expect(content).toContain("coverage");
  });

  it("runInit creates a .cwignore file with default patterns", async () => {
    const { runInit } = await import("../../src/cli/commands/init.js");
    const root = makeTempRoot();

    await runInit(root);

    const cwignorePath = resolve(root, ".cwignore");
    expect(existsSync(cwignorePath)).toBe(true);

    const content = readFileSync(cwignorePath, "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain("dist");
  });

  it("does not overwrite an existing .cwignore file", async () => {
    const { autoInit } = await import("../../src/cli/commands/init.js");
    const root = makeTempRoot();

    const cwignorePath = resolve(root, ".cwignore");
    writeFileSync(cwignorePath, "my-custom-pattern\n");

    await autoInit(root);

    const content = readFileSync(cwignorePath, "utf-8");
    expect(content).toBe("my-custom-pattern\n");
  });
});
