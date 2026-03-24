import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProjectRoots } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeWorkspaceFixture() {
  const workspace = mkdtempSync(join(tmpdir(), "cw-multi-repo-"));
  tempRoots.push(workspace);

  const primaryRoot = join(workspace, "host");
  const serviceA = join(workspace, "service-a");
  const serviceB = join(workspace, "service-b");

  mkdirSync(primaryRoot, { recursive: true });
  mkdirSync(join(serviceA, "src"), { recursive: true });
  mkdirSync(join(serviceB, "src"), { recursive: true });

  writeFileSync(
    join(serviceB, "src", "shared.ts"),
    [
      "export function sharedThing(): string {",
      "  return 'shared';",
      "}",
      "",
    ].join("\n")
  );

  writeFileSync(
    join(serviceA, "src", "consumer.ts"),
    [
      "import { sharedThing } from '../../service-b/src/shared';",
      "",
      "export function consumeShared(): string {",
      "  return sharedThing();",
      "}",
      "",
    ].join("\n")
  );

  return { primaryRoot, serviceA, serviceB };
}

describe("multi-repo indexing", () => {
  it("indexes multiple roots, records repo source, and resolves cross-repo imports", async () => {
    const { primaryRoot, serviceA, serviceB } = makeWorkspaceFixture();
    const db = new Database(":memory:");
    runMigrations(db);

    try {
      await indexProjectRoots(db, primaryRoot, [serviceA, serviceB]);

      const files = fileQueries(db);
      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const consumerFile = files.getByPath("../service-a/src/consumer.ts");
      const sharedFile = files.getByPath("../service-b/src/shared.ts");

      expect(consumerFile?.repo).toBe("../service-a");
      expect(sharedFile?.repo).toBe("../service-b");

      const consumerSymbol = symbols.getByFileId(consumerFile!.id).find((symbol) => symbol.name === "consumeShared");
      const sharedSymbol = symbols.getByFileId(sharedFile!.id).find((symbol) => symbol.name === "sharedThing");

      expect(consumerSymbol).toBeDefined();
      expect(sharedSymbol).toBeDefined();

      const outgoing = edges.getBySource(consumerSymbol!.id);
      expect(outgoing.some((edge) => edge.kind === "call" && edge.targetSymbolId === sharedSymbol!.id)).toBe(true);
      expect(outgoing.some((edge) => edge.kind === "import" && edge.targetSymbolId === sharedSymbol!.id)).toBe(true);
    } finally {
      db.close();
    }
  });
});
