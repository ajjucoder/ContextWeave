import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

function makeTempProject(suffix: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), `cw-parent-${suffix}-`));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function indexAndGetSymbols(root: string) {
  const db = new Database(":memory:");
  runMigrations(db);
  await indexProject(db, root);
  const syms = symbolQueries(db);
  return { db, syms };
}

describe("parent tracking — TypeScript", () => {
  it("assigns parentName and qualified_name to class methods", async () => {
    const { root, cleanup } = makeTempProject("ts");
    try {
      writeFileSync(
        join(root, "service.ts"),
        `export class UserService {
  getUser(id: string) {
    return { id };
  }
  createUser(name: string) {
    return { name };
  }
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const getUser = syms.getByName("getUser")[0];
      expect(getUser).toBeDefined();
      expect(getUser!.qualifiedName).toBe("UserService.getUser");
      expect(getUser!.parentSymbolId).not.toBeNull();

      const parentSym = syms.getById(getUser!.parentSymbolId!);
      expect(parentSym?.name).toBe("UserService");

      const createUser = syms.getByName("createUser")[0];
      expect(createUser).toBeDefined();
      expect(createUser!.qualifiedName).toBe("UserService.createUser");

      db.close();
    } finally {
      cleanup();
    }
  });

  it("assigns qualified_name as just the name for top-level functions", async () => {
    const { root, cleanup } = makeTempProject("ts-top");
    try {
      writeFileSync(
        join(root, "utils.ts"),
        `export function topLevelHelper() {
  return 42;
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const fn = syms.getByName("topLevelHelper")[0];
      expect(fn).toBeDefined();
      expect(fn!.qualifiedName).toBe("topLevelHelper");
      expect(fn!.parentSymbolId).toBeNull();

      db.close();
    } finally {
      cleanup();
    }
  });
});

describe("parent tracking — Python", () => {
  it("assigns parentName to methods inside a class", async () => {
    const { root, cleanup } = makeTempProject("py");
    try {
      writeFileSync(
        join(root, "service.py"),
        `class DataService:
    def fetch(self, url):
        return url

    def process(self, data):
        return data

def standalone():
    pass
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const fetch = syms.getByName("fetch")[0];
      expect(fetch).toBeDefined();
      expect(fetch!.qualifiedName).toBe("DataService.fetch");
      expect(fetch!.parentSymbolId).not.toBeNull();

      const process = syms.getByName("process")[0];
      expect(process).toBeDefined();
      expect(process!.qualifiedName).toBe("DataService.process");

      const standalone = syms.getByName("standalone")[0];
      expect(standalone).toBeDefined();
      expect(standalone!.qualifiedName).toBe("standalone");
      expect(standalone!.parentSymbolId).toBeNull();

      db.close();
    } finally {
      cleanup();
    }
  });
});

describe("parent tracking — Go", () => {
  it("assigns parentName from receiver type for methods", async () => {
    const { root, cleanup } = makeTempProject("go");
    try {
      writeFileSync(
        join(root, "server.go"),
        `package main

type Server struct {
  host string
}

func (s *Server) Start() error {
  return nil
}

func (s Server) Stop() {
}

func standalone() int {
  return 0
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const start = syms.getByName("Start")[0];
      expect(start).toBeDefined();
      expect(start!.qualifiedName).toBe("Server.Start");

      const stop = syms.getByName("Stop")[0];
      expect(stop).toBeDefined();
      expect(stop!.qualifiedName).toBe("Server.Stop");

      const standalone = syms.getByName("standalone")[0];
      expect(standalone).toBeDefined();
      expect(standalone!.qualifiedName).toBe("standalone");
      expect(standalone!.parentSymbolId).toBeNull();

      db.close();
    } finally {
      cleanup();
    }
  });
});

describe("parent tracking — Rust", () => {
  it("assigns parentName for methods in impl blocks", async () => {
    const { root, cleanup } = makeTempProject("rs");
    try {
      writeFileSync(
        join(root, "lib.rs"),
        `pub struct Calculator {
    value: i32,
}

impl Calculator {
    pub fn new(value: i32) -> Self {
        Calculator { value }
    }

    pub fn add(&self, n: i32) -> i32 {
        self.value + n
    }
}

pub fn standalone_fn() -> bool {
    true
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const add = syms.getByName("add")[0];
      expect(add).toBeDefined();
      expect(add!.qualifiedName).toBe("Calculator.add");

      const standalone = syms.getByName("standalone_fn")[0];
      expect(standalone).toBeDefined();
      expect(standalone!.qualifiedName).toBe("standalone_fn");
      expect(standalone!.parentSymbolId).toBeNull();

      db.close();
    } finally {
      cleanup();
    }
  });
});

describe("parent tracking — Java", () => {
  it("assigns parentName to methods inside a class", async () => {
    const { root, cleanup } = makeTempProject("java");
    try {
      writeFileSync(
        join(root, "Service.java"),
        `public class UserRepository {
    public String findById(String id) {
        return id;
    }

    public boolean save(String data) {
        return true;
    }
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const findById = syms.getByName("findById")[0];
      expect(findById).toBeDefined();
      expect(findById!.qualifiedName).toBe("UserRepository.findById");
      expect(findById!.parentSymbolId).not.toBeNull();

      const save = syms.getByName("save")[0];
      expect(save).toBeDefined();
      expect(save!.qualifiedName).toBe("UserRepository.save");

      db.close();
    } finally {
      cleanup();
    }
  });
});

describe("parent tracking — C#", () => {
  it("assigns parentName to methods inside a class", async () => {
    const { root, cleanup } = makeTempProject("cs");
    try {
      writeFileSync(
        join(root, "Service.cs"),
        `public class OrderService {
    public string GetOrder(int id) {
        return id.ToString();
    }

    public bool Cancel(int id) {
        return true;
    }
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const getOrder = syms.getByName("GetOrder")[0];
      expect(getOrder).toBeDefined();
      expect(getOrder!.qualifiedName).toBe("OrderService.GetOrder");
      expect(getOrder!.parentSymbolId).not.toBeNull();

      const cancel = syms.getByName("Cancel")[0];
      expect(cancel).toBeDefined();
      expect(cancel!.qualifiedName).toBe("OrderService.Cancel");

      db.close();
    } finally {
      cleanup();
    }
  });
});

describe("getByQualifiedName query", () => {
  it("resolves a method by its qualified name", async () => {
    const { root, cleanup } = makeTempProject("qname");
    try {
      writeFileSync(
        join(root, "app.ts"),
        `export class AuthService {
  login(email: string) {
    return email;
  }
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const results = syms.getByQualifiedName("AuthService.login");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name).toBe("login");

      db.close();
    } finally {
      cleanup();
    }
  });

  it("getByParent returns all children of a class", async () => {
    const { root, cleanup } = makeTempProject("by-parent");
    try {
      writeFileSync(
        join(root, "repo.ts"),
        `export class ProductRepo {
  find() { return []; }
  create() { return {}; }
  delete() { return true; }
}
`
      );

      const { db, syms } = await indexAndGetSymbols(root);

      const parentSym = syms.getByName("ProductRepo")[0];
      expect(parentSym).toBeDefined();

      const children = syms.getByParent(parentSym!.id);
      const childNames = children.map((c) => c.name);
      expect(childNames).toContain("find");
      expect(childNames).toContain("create");
      expect(childNames).toContain("delete");

      db.close();
    } finally {
      cleanup();
    }
  });
});
