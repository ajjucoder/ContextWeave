import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createSyntheticProject,
  removeSyntheticProject,
  type SyntheticProjectManifest,
} from "../../src/bench/synthetic-project.js";

function makeTempDir(prefix: string): string {
  return mkdtempSync(resolve(tmpdir(), `${prefix}-`));
}

function cleanup(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best-effort cleanup for temp paths
  }
}

describe("synthetic 100k project generator", () => {
  it("creates deterministic fixtures with exact LOC accounting", () => {
    const rootA = makeTempDir("cw-synth-a");
    const rootB = makeTempDir("cw-synth-b");

    let manifestA: SyntheticProjectManifest | null = null;
    let manifestB: SyntheticProjectManifest | null = null;

    try {
      manifestA = createSyntheticProject({
        rootDir: rootA,
        targetLoc: 1_000,
        fileCount: 10,
        moduleCount: 2,
      });
      manifestB = createSyntheticProject({
        rootDir: rootB,
        targetLoc: 1_000,
        fileCount: 10,
        moduleCount: 2,
      });

      expect(manifestA.actualLoc).toBe(1_000);
      expect(manifestA.fileCount).toBe(10);
      expect(manifestA.files.length).toBe(10);

      const firstRelativePath = manifestA.files[0]!;
      const fileA = readFileSync(resolve(rootA, firstRelativePath), "utf-8");
      const fileB = readFileSync(resolve(rootB, firstRelativePath), "utf-8");
      expect(fileA).toBe(fileB);

      expect(manifestA.queryCases).toEqual(manifestB.queryCases);
      expect(manifestA.queryCases.some((q) => q.kind === "narrow")).toBe(true);
      expect(manifestA.queryCases.some((q) => q.kind === "broad")).toBe(true);
      expect(manifestA.queryCases.some((q) => q.kind === "task")).toBe(true);
    } finally {
      if (manifestA) removeSyntheticProject(manifestA.rootDir);
      if (manifestB) removeSyntheticProject(manifestB.rootDir);
      cleanup(rootA);
      cleanup(rootB);
    }
  });

  it("rejects impossible LOC/file configurations", () => {
    const root = makeTempDir("cw-synth-invalid");

    try {
      expect(() =>
        createSyntheticProject({
          rootDir: root,
          targetLoc: 10,
          fileCount: 4,
          moduleCount: 2,
        })
      ).toThrow(/targetLoc/i);
    } finally {
      cleanup(root);
    }
  });
});
