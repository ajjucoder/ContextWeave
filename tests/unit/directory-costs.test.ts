import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDirectoryWeight } from "../../src/utils/directory-weights.js";

describe("getDirectoryWeight", () => {
  it("heavily penalizes legacy directories", () => {
    expect(getDirectoryWeight("sitecraft_legacy/App.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("sitecraft_demo_AIStudio/App.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("old/components/Button.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("archive/v1/types.ts")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("prototype/experiments.ts")).toBeLessThanOrEqual(0.2);
  });

  it("does not penalize active src directories", () => {
    expect(getDirectoryWeight("src/components/Button.tsx")).toBeGreaterThanOrEqual(0.9);
    expect(getDirectoryWeight("app/api/route.ts")).toBeGreaterThanOrEqual(0.9);
  });

  it("penalizes vendor and external directories", () => {
    expect(getDirectoryWeight("vendor/lodash/index.js")).toBeLessThan(0.5);
    expect(getDirectoryWeight("third_party/lib/utils.ts")).toBeLessThan(0.5);
  });

  it("penalizes demo and examples directories", () => {
    expect(getDirectoryWeight("examples/basic/index.ts")).toBeLessThan(0.5);
    expect(getDirectoryWeight("demo/app/main.ts")).toBeLessThan(0.5);
  });

  it("penalizes static assets and build outputs", () => {
    expect(getDirectoryWeight("src/main/resources/static/app.js")).toBe(0.2);
    expect(getDirectoryWeight("assets/logo.svg")).toBe(0.3);
    expect(getDirectoryWeight("public/robots.txt")).toBe(0.3);
    expect(getDirectoryWeight("dist/index.js")).toBe(0.1);
    expect(getDirectoryWeight("build/server.js")).toBe(0.1);
    expect(getDirectoryWeight("out/chunks/app.js")).toBe(0.1);
    expect(getDirectoryWeight(".next/server/app.js")).toBe(0.1);
  });

  it("upweights primary source directories", () => {
    expect(getDirectoryWeight("src/main/java/com/example/UserController.java")).toBe(1.15);
    expect(getDirectoryWeight("src/app/dashboard/page.tsx")).toBe(1.15);
    expect(getDirectoryWeight("src/lib/auth.ts")).toBe(1.15);
    expect(getDirectoryWeight("src/core/indexer.ts")).toBe(1.15);
    expect(getDirectoryWeight("packages/sdk/src/index.ts")).toBe(1.15);
    expect(getDirectoryWeight("libs/shared/src/index.ts")).toBe(1.15);
  });

  it("applies config-driven primary and archive directory overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-dir-weight-"));
    try {
      mkdirSync(join(root, ".contextweave"), { recursive: true });
      writeFileSync(
        join(root, ".contextweave", "config.json"),
        JSON.stringify({
          primaryDirs: ["services/api", "apps/web/src/server"],
          archiveDirs: ["attic", "src/legacy-app"],
        })
      );

      expect(getDirectoryWeight("services/api/routes/users.ts", root)).toBe(1.15);
      expect(getDirectoryWeight("apps/web/src/server/loaders.ts", root)).toBe(1.15);
      expect(getDirectoryWeight("attic/old-script.ts", root)).toBe(0.1);
      expect(getDirectoryWeight("src/legacy-app/index.ts", root)).toBe(0.1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
