import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-framework-edge-"));
  tempRoots.push(root);
  return root;
}

describe("framework_entry synthetic edges", () => {
  it("adds framework_entry edges from Next.js route handlers", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "app", "api", "users"), { recursive: true });
    mkdirSync(join(root, "src", "lib"), { recursive: true });

    writeFileSync(
      join(root, "src", "lib", "user-service.ts"),
      `export function getUser() {
  return { id: 1 };
}
`
    );

    writeFileSync(
      join(root, "src", "app", "api", "users", "route.ts"),
      `import { getUser } from "../../../lib/user-service";

export async function GET() {
  return getUser();
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const getHandler = symbols.getByName("GET").find((s) => s.kind === "function");
    const getUser = symbols.getByName("getUser").find((s) => s.kind === "function");
    expect(getHandler).toBeDefined();
    expect(getUser).toBeDefined();

    const handlerEdges = edges.getBySource(getHandler!.id);
    const frameworkEdges = handlerEdges.filter((edge) => edge.kind === "framework_entry");
    const frameworkTargets = new Set(frameworkEdges.map((edge) => edge.targetSymbolId));

    expect(frameworkTargets.has(getUser!.id)).toBe(true);
    db.close();
  });
});
