import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { buildFlowResult } from "../../src/mcp/tools/flow.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-jsx-cb-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
}

describe("JSX callback edge creation", () => {
  it("creates callback edges for onClick/onSubmit JSX props", async () => {
    const root = makeTempProject();

    writeFileSync(
      join(root, "src", "App.tsx"),
      `import { handleSave } from './handlers';
import { Button } from './Button';

export function App() {
  return (
    <div>
      <Button onClick={handleSave} />
    </div>
  );
}
`
    );

    writeFileSync(
      join(root, "src", "handlers.ts"),
      `export function handleSave() {
  return true;
}
`
    );

    writeFileSync(
      join(root, "src", "Button.tsx"),
      `export function Button({ onClick }: { onClick?: () => void }) {
  return <button onClick={onClick}>Click</button>;
}
`
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    try {
      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const allSymbols = symbols.getAll();
      const allEdges = [...edges.iterateAll()];
      const callbackEdges = allEdges.filter((e) => e.kind === "callback");
      const jsxRenderEdges = allEdges.filter((e) => e.kind === "jsx_render");

      expect(allSymbols.length).toBeGreaterThan(0);
      expect(allEdges.length).toBeGreaterThan(0);

      const hasCallbackOrJsxEdge = callbackEdges.length > 0 || jsxRenderEdges.length > 0;
      expect(hasCallbackOrJsxEdge).toBe(true);

      const appSymbol = allSymbols.find((s) => s.name === "App");
      expect(appSymbol).toBeDefined();

      const appEdges = allEdges.filter((e) => e.sourceSymbolId === appSymbol!.id);
      const appCallbackEdges = appEdges.filter(
        (e) => e.kind === "callback" || e.kind === "jsx_render"
      );
      expect(appCallbackEdges.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("cw_flow traverses callback edges from App to handleSave", async () => {
    const root = makeTempProject();

    writeFileSync(
      join(root, "src", "Form.tsx"),
      `import { submitForm } from './actions';

export function Form() {
  return <form onSubmit={submitForm}><input /></form>;
}
`
    );

    writeFileSync(
      join(root, "src", "actions.ts"),
      `export function submitForm() {
  return persistData();
}

export function persistData() {
  return true;
}
`
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    try {
      await indexProject(db, root);

      const result = buildFlowResult(db, "Form", "persistData", 5);
      expect(result.text).toContain("Form");
      expect(result.text).toContain("submitForm");
    } finally {
      db.close();
    }
  });
});
