import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";

function makeFixture(): { root: string; db: Database.Database } {
  const root = mkdtempSync(join(tmpdir(), "cw-jsx-"));
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(
    join(root, "src", "Button.tsx"),
    `export function Button({ onClick, label }: { onClick: () => void; label: string }) {
  return <button onClick={onClick}>{label}</button>;
}
`
  );

  writeFileSync(
    join(root, "src", "Modal.tsx"),
    `export function Modal({ children }: { children: React.ReactNode }) {
  return <div className="modal">{children}</div>;
}
`
  );

  writeFileSync(
    join(root, "src", "App.tsx"),
    `import { Button } from "./Button";
import { Modal } from "./Modal";

function handleClick() {
  console.log("clicked");
}

export function App() {
  return (
    <Modal>
      <Button onClick={handleClick} label="Click me" />
    </Modal>
  );
}
`
  );

  const db = new Database(":memory:");
  runMigrations(db);
  return { root, db };
}

describe("JSX component usage edges", () => {
  it("creates jsx_render edges for component references in JSX", async () => {
    const { root, db } = makeFixture();
    try {
      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const appSymbol = symbols.getByName("App").find((s) => s.kind === "function");
      expect(appSymbol).toBeDefined();

      const appEdges = edges.getBySource(appSymbol!.id);
      const jsxEdges = appEdges.filter((e) => e.kind === "jsx_render");

      const targetNames = jsxEdges.map((e) => {
        const target = symbols.getById(e.targetSymbolId);
        return target?.name;
      });

      expect(targetNames).toContain("Button");
      expect(targetNames).toContain("Modal");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates call edges for JSX prop callback references", async () => {
    const { root, db } = makeFixture();
    try {
      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const appSymbol = symbols.getByName("App").find((s) => s.kind === "function");
      expect(appSymbol).toBeDefined();

      const appEdges = edges.getBySource(appSymbol!.id);

      const handleClickTarget = symbols.getByName("handleClick").find((s) => s.kind === "function");
      expect(handleClickTarget).toBeDefined();

      const hasCallEdge = appEdges.some(
        (e) => e.targetSymbolId === handleClickTarget!.id && (e.kind === "call" || e.kind === "jsx_render" || e.kind === "callback")
      );
      expect(hasCallEdge).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates jsx_render edge for self-closing JSX elements", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-jsx-self-"));
    mkdirSync(join(root, "src"), { recursive: true });

    writeFileSync(
      join(root, "src", "Icon.tsx"),
      `export function Icon({ name }: { name: string }) {
  return <svg>{name}</svg>;
}
`
    );

    writeFileSync(
      join(root, "src", "Header.tsx"),
      `import { Icon } from "./Icon";

export function Header() {
  return <div><Icon name="menu" /></div>;
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);

    try {
      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const headerSymbol = symbols.getByName("Header").find((s) => s.kind === "function");
      expect(headerSymbol).toBeDefined();

      const headerEdges = edges.getBySource(headerSymbol!.id);
      const jsxEdges = headerEdges.filter((e) => e.kind === "jsx_render");
      const targetNames = jsxEdges.map((e) => symbols.getById(e.targetSymbolId)?.name);

      expect(targetNames).toContain("Icon");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("JSX callback prop edge coverage", () => {
  const CALLBACK_PROPS = ["onClick", "onChange", "onSubmit", "onPress", "onError", "onSuccess"] as const;

  for (const prop of CALLBACK_PROPS) {
    it(`creates callback edge for ${prop}={handler} in .tsx`, async () => {
      const root = mkdtempSync(join(tmpdir(), `cw-jsx-prop-`));
      mkdirSync(join(root, "src"), { recursive: true });

      writeFileSync(
        join(root, "src", "Widget.tsx"),
        `export function handler() {}
export function Widget() {
  return <div ${prop}={handler} />;
}
`
      );

      const db = new Database(":memory:");
      runMigrations(db);

      try {
        await indexProject(db, root);

        const symbols = symbolQueries(db);
        const edges = edgeQueries(db);

        const widgetSym = symbols.getByName("Widget").find((s) => s.kind === "function");
        expect(widgetSym).toBeDefined();

        const handlerSym = symbols.getByName("handler").find((s) => s.kind === "function");
        expect(handlerSym).toBeDefined();

        const outgoing = edges.getBySource(widgetSym!.id);
        const hasCallback = outgoing.some(
          (e) => e.targetSymbolId === handlerSym!.id && e.kind === "callback"
        );
        expect(hasCallback).toBe(true);
      } finally {
        db.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("creates callback edge for onClick={() => handler()} arrow wrapper in .tsx", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-jsx-arrow-"));
    mkdirSync(join(root, "src"), { recursive: true });

    writeFileSync(
      join(root, "src", "Widget.tsx"),
      `export function handler() {}
export function Widget() {
  return <div onClick={() => handler()} />;
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);

    try {
      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const widgetSym = symbols.getByName("Widget").find((s) => s.kind === "function");
      expect(widgetSym).toBeDefined();

      const handlerSym = symbols.getByName("handler").find((s) => s.kind === "function");
      expect(handlerSym).toBeDefined();

      const outgoing = edges.getBySource(widgetSym!.id);
      const hasEdge = outgoing.some(
        (e) => e.targetSymbolId === handlerSym!.id && (e.kind === "callback" || e.kind === "call")
      );
      expect(hasEdge).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates callback edge for onSubmit={handler} in .jsx file", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-jsx-jsxfile-"));
    mkdirSync(join(root, "src"), { recursive: true });

    writeFileSync(
      join(root, "src", "Form.jsx"),
      `export function handleSubmit(e) { e.preventDefault(); }
export function Form() {
  return <form onSubmit={handleSubmit}><button>Submit</button></form>;
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);

    try {
      await indexProject(db, root);

      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);

      const formSym = symbols.getByName("Form").find((s) => s.kind === "function");
      expect(formSym).toBeDefined();

      const handleSubmitSym = symbols.getByName("handleSubmit").find((s) => s.kind === "function");
      expect(handleSubmitSym).toBeDefined();

      const outgoing = edges.getBySource(formSym!.id);
      const hasCallback = outgoing.some(
        (e) => e.targetSymbolId === handleSubmitSym!.id && e.kind === "callback"
      );
      expect(hasCallback).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
