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
  return mkdtempSync(join(tmpdir(), "cw-flow-div-"));
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("Flow diversity — JSX callback prop edge creation", () => {
  it("creates callback edge for onClick={handler} identifier prop", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "Widget.tsx"),
        `export function handleClick() {
  console.log("clicked");
}

export function Widget() {
  return <button onClick={handleClick}>Click</button>;
}
`
      );

      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const widgetSym = symbols.getByName("Widget").find((s) => s.kind === "function");
      expect(widgetSym).toBeDefined();

      const handleClickSym = symbols.getByName("handleClick").find((s) => s.kind === "function");
      expect(handleClickSym).toBeDefined();

      const outgoingEdges = edges.getBySource(widgetSym!.id);
      const callbackEdge = outgoingEdges.find(
        (e) => e.targetSymbolId === handleClickSym!.id && e.kind === "callback"
      );
      expect(callbackEdge).toBeDefined();
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates callback edge for onChange={handler} identifier prop", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "Input.tsx"),
        `export function handleChange(e: Event) {
  return (e.target as HTMLInputElement).value;
}

export function Input() {
  return <input onChange={handleChange} />;
}
`
      );

      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const inputSym = symbols.getByName("Input").find((s) => s.kind === "function");
      expect(inputSym).toBeDefined();

      const handleChangeSym = symbols.getByName("handleChange").find((s) => s.kind === "function");
      expect(handleChangeSym).toBeDefined();

      const outgoingEdges = edges.getBySource(inputSym!.id);
      const callbackEdge = outgoingEdges.find(
        (e) => e.targetSymbolId === handleChangeSym!.id && e.kind === "callback"
      );
      expect(callbackEdge).toBeDefined();
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates callback edge for onSubmit={handler} identifier prop", async () => {
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
  return <form onSubmit={handleSubmit}><button>Go</button></form>;
}
`
      );

      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const formSym = symbols.getByName("Form").find((s) => s.kind === "function");
      expect(formSym).toBeDefined();

      const handleSubmitSym = symbols.getByName("handleSubmit").find((s) => s.kind === "function");
      expect(handleSubmitSym).toBeDefined();

      const outgoingEdges = edges.getBySource(formSym!.id);
      const callbackEdge = outgoingEdges.find(
        (e) => e.targetSymbolId === handleSubmitSym!.id && e.kind === "callback"
      );
      expect(callbackEdge).toBeDefined();
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("JSX callback edge appears in cw_flow outgoing output", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "Panel.tsx"),
        `export function onClose() {
  return null;
}

export function Panel() {
  return <div onClick={onClose}>Close</div>;
}
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "Panel", undefined, 3);

      expect(result.isLimited).toBe(false);
      expect(result.text).toContain("onClose");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Flow diversity — path bucketing across first hops", () => {
  it("returns paths covering at least 2 distinct first-hop branches", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "alpha.ts"),
        `export function alpha() { return alphaLeaf(); }
export function alphaLeaf() { return "alpha"; }
`
      );

      writeFileSync(
        join(root, "src", "beta.ts"),
        `export function beta() { return betaLeaf(); }
export function betaLeaf() { return "beta"; }
`
      );

      writeFileSync(
        join(root, "src", "gamma.ts"),
        `export function gamma() { return gammaLeaf(); }
export function gammaLeaf() { return "gamma"; }
`
      );

      writeFileSync(
        join(root, "src", "hub.ts"),
        `import { alpha } from "./alpha";
import { beta } from "./beta";
import { gamma } from "./gamma";

export function hub() {
  alpha();
  beta();
  gamma();
}
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "hub", undefined, 4);

      const mentionsAlpha = result.text.includes("alpha");
      const mentionsBeta = result.text.includes("beta");
      const mentionsGamma = result.text.includes("gamma");
      const branchCount = [mentionsAlpha, mentionsBeta, mentionsGamma].filter(Boolean).length;

      expect(branchCount).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not exhaust the path budget on a single branch when others exist", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "deepA.ts"),
        `export function a1() { return a2(); }
export function a2() { return a3(); }
export function a3() { return a4(); }
export function a4() { return a5(); }
export function a5() { return "deep"; }
`
      );

      writeFileSync(
        join(root, "src", "shallowB.ts"),
        `export function b1() { return "shallow"; }
`
      );

      writeFileSync(
        join(root, "src", "dispatcher.ts"),
        `import { a1 } from "./deepA";
import { b1 } from "./shallowB";

export function dispatch() {
  a1();
  b1();
}
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "dispatch", undefined, 6);

      expect(result.text).toContain("b1");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Flow diversity — import-only path filtering", () => {
  it("import-only paths are excluded when call paths exist", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "util.ts"),
        `export function utilFn() { return 42; }
export type UtilType = { value: number };
`
      );

      writeFileSync(
        join(root, "src", "service.ts"),
        `import { utilFn } from "./util";

export function service() {
  return utilFn();
}
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "service", undefined, 3);

      expect(result.isLimited).toBe(false);
      const hasCallEdge = result.text.includes("call") || result.text.includes("utilFn");
      expect(hasCallEdge).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports isLimited when only import edges exist with no callable targets", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "types.ts"),
        `export type Config = { host: string; port: number };
export type Logger = { log: (msg: string) => void };
`
      );

      writeFileSync(
        join(root, "src", "entrypoint.ts"),
        `import type { Config } from "./types";

export const defaultConfig: Config = { host: "localhost", port: 3000 };
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "defaultConfig", undefined, 3);

      expect(typeof result.isLimited).toBe("boolean");
      expect(typeof result.text).toBe("string");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("multi-branch function produces paths with non-import edge kinds", async () => {
    const root = makeRoot();
    const db = makeDb();
    try {
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "logger.ts"),
        `export function logInfo(msg: string) { console.log(msg); }
export function logError(msg: string) { console.error(msg); }
`
      );

      writeFileSync(
        join(root, "src", "processor.ts"),
        `import { logInfo, logError } from "./logger";

export function process(data: string) {
  if (data) {
    logInfo(data);
  } else {
    logError("no data");
  }
}
`
      );

      await indexProject(db, root);

      const result = buildFlowResult(db, "process", undefined, 3);

      expect(result.isLimited).toBe(false);
      const hasLog = result.text.includes("logInfo") || result.text.includes("logError");
      expect(hasLog).toBe(true);
      const hasCallEdge = result.text.includes("[call]");
      expect(hasCallEdge).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
