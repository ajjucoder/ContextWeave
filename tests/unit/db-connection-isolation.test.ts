import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, getDb } from "../../src/db/connection.js";

const tempRoots: string[] = [];

afterEach(() => {
  closeDb();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("db connection isolation", () => {
  it("returns distinct DB handles for distinct database paths", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-db-iso-"));
    tempRoots.push(root);

    const first = getDb(join(root, "one.db"));
    const second = getDb(join(root, "two.db"));

    expect(first).not.toBe(second);
  });
});
