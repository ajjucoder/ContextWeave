import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectProfile, formatProjectProfile } from "../../src/utils/project-profile.js";

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-utils-profile-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("project profile utilities", () => {
  it("builds profile summaries with language counts, roots, exclusions, and suspicious dirs", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".contextweave"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "vendor"), { recursive: true });
    mkdirSync(join(root, ".venv"), { recursive: true });
    mkdirSync(join(root, "demo"), { recursive: true });
    writeFileSync(join(root, ".contextweave", "config.json"), JSON.stringify({ ignore: ["vendor"] }), "utf8");
    writeFileSync(join(root, ".gitignore"), "dist/\n", "utf8");
    writeFileSync(join(root, ".cwignore"), ".venv/\n", "utf8");

    const profile = buildProjectProfile(root, [
      { path: join(root, "src", "index.ts"), language: "typescript" },
      { path: join(root, "src", "worker.ts"), language: "typescript" },
      { path: join(root, "scripts", "job.py"), language: "python" },
      { path: "packages/shared/src/index.ts", language: "typescript" },
    ]);

    expect(profile.languages).toEqual([
      { name: "typescript", count: 3 },
      { name: "python", count: 1 },
    ]);
    expect(profile.activeRoots).toEqual([
      { path: "src", count: 2 },
      { path: "packages", count: 1 },
      { path: "scripts", count: 1 },
    ]);
    expect(profile.excludedRoots).toEqual(
      expect.arrayContaining([
        { path: "vendor", source: "config" },
        { path: ".venv", source: ".cwignore" },
        { path: "dist", source: ".gitignore" },
        { path: "node_modules", source: "built-in" },
      ])
    );
    expect(profile.suspiciousDirs).toEqual(
      expect.arrayContaining([
        { path: ".venv", excluded: true },
        { path: "demo", excluded: false },
        { path: "vendor", excluded: true },
      ])
    );
    expect(profile.ignoreNotes).toEqual([
      "JS/TS defaults exclude node_modules, dist, build, .next, and coverage.",
      "Python defaults exclude __pycache__, venv/.venv, and .tox.",
      "Mixed repos merge config.ignore, config.exclude, config.excludePatterns, .gitignore, and .cwignore.",
    ]);
  });

  it("formats profile sections into human-readable lines", () => {
    const lines = formatProjectProfile({
      languages: [
        { name: "typescript", count: 2 },
        { name: "python", count: 1 },
      ],
      activeRoots: [
        { path: "src", count: 2 },
        { path: "scripts", count: 1 },
      ],
      excludedRoots: [
        { path: "vendor", source: "config" },
        { path: "dist", source: "built-in" },
      ],
      suspiciousDirs: [{ path: "demo", excluded: false }],
      ignoreNotes: ["Mixed repos merge config.ignore, config.exclude, config.excludePatterns, .gitignore, and .cwignore."],
    });

    expect(lines).toEqual([
      "Project Profile",
      "Languages: typescript (2), python (1)",
      "Active roots: src (2), scripts (1)",
      "Excluded roots: vendor [config], dist [built-in]",
      "Suspicious dirs: demo (present)",
      "Ignore defaults: Mixed repos merge config.ignore, config.exclude, config.excludePatterns, .gitignore, and .cwignore.",
    ]);
  });
});
