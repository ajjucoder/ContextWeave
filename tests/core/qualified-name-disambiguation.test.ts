import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";

function makeTempProject(suffix: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), `cw-qname-disambig-${suffix}-`));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("qualified name disambiguation in edge resolution", () => {
  it("prefers the correct class method when multiple classes have same method name", async () => {
    const { root, cleanup } = makeTempProject("multi-class");
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "services.ts"),
        `export class UserService {
  process(data: string) {
    return data;
  }
}

export class OrderService {
  process(order: string) {
    return order;
  }
}
`
      );

      writeFileSync(
        join(root, "src", "handler.ts"),
        `import { UserService } from "./services";

export class UserHandler {
  private service = new UserService();

  handle() {
    return this.service.process("user data");
  }
}
`
      );

      const db = new Database(":memory:");
      runMigrations(db);
      await indexProject(db, root);

      const syms = symbolQueries(db);
      const edges = edgeQueries(db);

      const userProcess = syms.getByQualifiedName("UserService.process");
      const orderProcess = syms.getByQualifiedName("OrderService.process");

      expect(userProcess.length).toBeGreaterThan(0);
      expect(orderProcess.length).toBeGreaterThan(0);
      expect(userProcess[0]!.id).not.toBe(orderProcess[0]!.id);

      const handleMethod = syms.getByQualifiedName("UserHandler.handle");
      expect(handleMethod.length).toBeGreaterThan(0);

      const outEdges = edges.getBySource(handleMethod[0]!.id);
      const targetIds = outEdges.map((e) => e.targetSymbolId);
      expect(targetIds.length).toBeGreaterThan(0);

      const targetsOrderProcess = targetIds.includes(orderProcess[0]!.id);
      expect(targetsOrderProcess).toBe(false);

      db.close();
    } finally {
      cleanup();
    }
  });

  it("flow tool resolves qualified names with dot notation", async () => {
    const { root, cleanup } = makeTempProject("flow-qname");
    try {
      writeFileSync(
        join(root, "app.ts"),
        `export class Authenticator {
  verify(token: string) {
    return token.length > 0;
  }
  hash(data: string) {
    return data;
  }
}
`
      );

      const db = new Database(":memory:");
      runMigrations(db);
      await indexProject(db, root);

      const syms = symbolQueries(db);

      const byQualified = syms.getByQualifiedName("Authenticator.verify");
      expect(byQualified.length).toBeGreaterThan(0);
      expect(byQualified[0]!.name).toBe("verify");
      expect(byQualified[0]!.qualifiedName).toBe("Authenticator.verify");

      const byQualifiedHash = syms.getByQualifiedName("Authenticator.hash");
      expect(byQualifiedHash.length).toBeGreaterThan(0);
      expect(byQualifiedHash[0]!.name).toBe("hash");

      db.close();
    } finally {
      cleanup();
    }
  });

  it("top-level function qualified_name equals its simple name", async () => {
    const { root, cleanup } = makeTempProject("top-level");
    try {
      writeFileSync(
        join(root, "utils.ts"),
        `export function parseDate(s: string) {
  return new Date(s);
}

export class Parser {
  parseDate(s: string) {
    return new Date(s);
  }
}
`
      );

      const db = new Database(":memory:");
      runMigrations(db);
      await indexProject(db, root);

      const syms = symbolQueries(db);

      const topLevel = syms.getByName("parseDate").find((s) => s.parentSymbolId === null);
      expect(topLevel).toBeDefined();
      expect(topLevel!.qualifiedName).toBe("parseDate");

      const classMethod = syms.getByQualifiedName("Parser.parseDate");
      expect(classMethod.length).toBeGreaterThan(0);
      expect(classMethod[0]!.parentSymbolId).not.toBeNull();

      const allParseDates = syms.getByName("parseDate");
      expect(allParseDates.length).toBe(2);

      db.close();
    } finally {
      cleanup();
    }
  });
});
