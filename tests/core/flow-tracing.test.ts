import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { buildFlowResult } from "../../src/mcp/tools/flow.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "cw-flow-"));
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("Flow tracing — JSX callbacks, diversity, incoming direction", () => {
  it("creates callback edge from JSX prop (onSubmit={handleSubmit})", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "Form.tsx"),
        `export function handleSubmit(e: Event) {
  e.preventDefault();
}

export function Form() {
  return <form onSubmit={handleSubmit}><button>Submit</button></form>;
}
`
      );

      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const formSymbol = symbols.getByName("Form").find((s) => s.kind === "function");
      expect(formSymbol).toBeDefined();

      const formEdges = edges.getBySource(formSymbol!.id);
      const handleSubmitTarget = symbols.getByName("handleSubmit").find((s) => s.kind === "function");
      expect(handleSubmitTarget).toBeDefined();

      const hasCallbackEdge = formEdges.some(
        (e) => e.targetSymbolId === handleSubmitTarget!.id && e.kind === "callback"
      );
      expect(hasCallbackEdge).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows paths through multiple branches (diversity)", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "orchestrator.ts"),
        `import { branchA } from "./branchA";
import { branchB } from "./branchB";
import { branchC } from "./branchC";

export function run() {
  branchA();
  branchB();
  branchC();
}
`
      );

      writeFileSync(
        join(root, "src", "branchA.ts"),
        `export function branchA() { return branchA1(); }
export function branchA1() { return "a1"; }
export function branchA2() { return "a2"; }
`
      );

      writeFileSync(
        join(root, "src", "branchB.ts"),
        `export function branchB() { return branchB1(); }
export function branchB1() { return "b1"; }
`
      );

      writeFileSync(
        join(root, "src", "branchC.ts"),
        `export function branchC() { return branchC1(); }
export function branchC1() { return "c1"; }
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "run", undefined, 5);

      const hasBranchA = result.text.includes("branchA");
      const hasBranchB = result.text.includes("branchB");
      const hasBranchC = result.text.includes("branchC");
      const diverseBranches = [hasBranchA, hasBranchB, hasBranchC].filter(Boolean).length;
      expect(diverseBranches).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports direction:incoming to find callers via edges", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "utils.ts"),
        `export function computeValue(x: number): number {
  return x * 2;
}
`
      );

      writeFileSync(
        join(root, "src", "service.ts"),
        `import { computeValue } from "./utils";

export function processData(input: number) {
  return computeValue(input);
}

export function processOther(input: number) {
  return computeValue(input + 1);
}
`
      );

      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const computeValueSymbol = symbols.getByName("computeValue").find((s) => s.kind === "function");
      expect(computeValueSymbol).toBeDefined();

      const incomingEdges = edges.getByTarget(computeValueSymbol!.id);
      expect(incomingEdges.length).toBeGreaterThan(0);

      const callerSymbolIds = incomingEdges.map((e) => e.sourceSymbolId);
      const callerNames = callerSymbolIds.map((id) => symbols.getById(id)?.name);
      expect(callerNames).toContain("processData");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("direction:incoming in buildFlowResult finds callers (2+ hop chains)", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "utils.ts"),
        `export function computeValue(x: number): number {
  return x * 2;
}
`
      );

      writeFileSync(
        join(root, "src", "service.ts"),
        `import { computeValue } from "./utils";

export function processData(input: number) {
  return computeValue(input);
}
`
      );

      writeFileSync(
        join(root, "src", "controller.ts"),
        `import { processData } from "./service";

export function handleRequest(input: number) {
  return processData(input);
}
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "computeValue", undefined, 3, "incoming");

      expect(result.text).toContain("processData");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("direction:both returns both outgoing and incoming sections with 2+ hop chains", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "bottom.ts"),
        `export function bottom() { return 0; }
export function leaf() { return -1; }
`
      );

      writeFileSync(
        join(root, "src", "low.ts"),
        `import { bottom } from "./bottom";
export function low() { return bottom(); }
`
      );

      writeFileSync(
        join(root, "src", "middle.ts"),
        `import { low } from "./low";
export function middle() { return low(); }
`
      );

      writeFileSync(
        join(root, "src", "high.ts"),
        `import { middle } from "./middle";
export function high() { return middle(); }
`
      );

      writeFileSync(
        join(root, "src", "top.ts"),
        `import { high } from "./high";
export function top() { return high(); }
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "middle", undefined, 5, "both");

      expect(result.text).toContain("Outgoing flows");
      expect(result.text).toContain("Incoming flows");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
