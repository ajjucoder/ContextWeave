import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRipgrepSearch, isRipgrepAvailable, RipgrepMatch } from "../../src/mcp/tools/ripgrep.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cw-rg-"));
  tempDirs.push(dir);
  return dir;
}

describe("runRipgrepSearch", () => {
  it("finds literal text matches", async () => {
    if (!(await isRipgrepAvailable())) return;
    const dir = makeTempDir();
    writeFileSync(join(dir, "a.ts"), "export function fooBar() { return 1; }\n");

    const results = await runRipgrepSearch("fooBar", dir, { caseSensitive: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.line).toBe(1);
    expect(results[0]!.text).toContain("fooBar");
  });

  it("respects case-insensitive flag", async () => {
    if (!(await isRipgrepAvailable())) return;
    const dir = makeTempDir();
    writeFileSync(join(dir, "b.ts"), "const FOOBAR = 1;\n");

    const sensitive = await runRipgrepSearch("foobar", dir, { caseSensitive: true });
    const insensitive = await runRipgrepSearch("foobar", dir, { caseSensitive: false });

    expect(sensitive).toHaveLength(0);
    expect(insensitive.length).toBeGreaterThan(0);
  });

  it("returns empty array when no matches", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "c.ts"), "const x = 1;\n");

    const results = await runRipgrepSearch("nonexistent_xyz_abc", dir);
    expect(results).toHaveLength(0);
  });

  it("respects glob filter", async () => {
    if (!(await isRipgrepAvailable())) return;
    const dir = makeTempDir();
    writeFileSync(join(dir, "match.ts"), "function target() {}\n");
    writeFileSync(join(dir, "skip.py"), "def target(): pass\n");

    const results = await runRipgrepSearch("target", dir, { glob: "*.ts" });
    expect(results.every((r: RipgrepMatch) => r.path.endsWith(".ts"))).toBe(true);
    expect(results.some((r: RipgrepMatch) => r.path.endsWith(".py"))).toBe(false);
  });
});
