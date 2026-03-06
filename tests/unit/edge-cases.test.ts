import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { generateCapsule } from "../../src/capsule/generator.js";

const SESSION_ID = "edge-test";
const PROJECT_ROOT = "/tmp/edge";
const AGENT_ID = "claude-code";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  db.prepare(
    "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run(SESSION_ID, AGENT_ID, PROJECT_ROOT, Date.now());
  return db;
}

function populateGraph(db: Database.Database): void {
  const now = Date.now();
  const insertFile = db.prepare(
    `INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSymbol = db.prepare(
    `INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertEdge = db.prepare(
    `INSERT OR IGNORE INTO edges (source_symbol_id, target_symbol_id, kind, created_at)
     VALUES (?, ?, ?, ?)`
  );

  const files = [
    ["/tmp/edge/src/auth.ts", "auth.ts", "hash1", now, now, "typescript", 5],
    ["/tmp/edge/src/user.ts", "user.ts", "hash2", now, now, "typescript", 5],
    ["/tmp/edge/src/db.ts", "db.ts", "hash3", now, now, "typescript", 4],
    ["/tmp/edge/src/utils.ts", "utils.ts", "hash4", now, now, "typescript", 4],
    ["/tmp/edge/src/api.ts", "api.ts", "hash5", now, now, "typescript", 4],
  ] as const;

  const fileIds: number[] = [];
  for (const f of files) {
    const r = insertFile.run(...f);
    fileIds.push(r.lastInsertRowid as number);
  }

  const symbols = [
    [fileIds[0], "authenticate", "function", 1, 10, "function authenticate(token: string)", "bh1", "function authenticate(token: string) {}", 1, 0.8],
    [fileIds[0], "validateToken", "function", 12, 20, "function validateToken(t: string)", "bh2", "function validateToken(t: string) {}", 1, 0.6],
    [fileIds[0], "AuthService", "class", 22, 50, "class AuthService", "bh3", "class AuthService {}", 1, 0.9],
    [fileIds[0], "hashPassword", "function", 52, 60, "function hashPassword(pw: string)", "bh4", "function hashPassword(pw: string) {}", 0, 0.4],
    [fileIds[0], "parseJwt", "function", 62, 70, "function parseJwt(token: string)", "bh5", "function parseJwt(token: string) {}", 1, 0.5],
    [fileIds[1], "UserService", "class", 1, 40, "class UserService", "bh6", "class UserService {}", 1, 0.85],
    [fileIds[1], "createUser", "function", 42, 55, "function createUser(data: UserData)", "bh7", "function createUser(data: UserData) {}", 1, 0.7],
    [fileIds[1], "deleteUser", "function", 57, 70, "function deleteUser(id: string)", "bh8", "function deleteUser(id: string) {}", 1, 0.5],
    [fileIds[1], "UserData", "interface", 72, 80, "interface UserData", "bh9", "interface UserData {}", 1, 0.3],
    [fileIds[1], "updateUser", "function", 82, 95, "function updateUser(id: string, data: UserData)", "bh10", "function updateUser(id: string, data: UserData) {}", 1, 0.6],
    [fileIds[2], "getConnection", "function", 1, 15, "function getConnection()", "bh11", "function getConnection() {}", 1, 0.75],
    [fileIds[2], "runQuery", "function", 17, 30, "function runQuery(sql: string)", "bh12", "function runQuery(sql: string) {}", 1, 0.65],
    [fileIds[2], "closeConnection", "function", 32, 40, "function closeConnection()", "bh13", "function closeConnection() {}", 1, 0.4],
    [fileIds[2], "DbConfig", "interface", 42, 50, "interface DbConfig", "bh14", "interface DbConfig {}", 1, 0.3],
    [fileIds[3], "formatDate", "function", 1, 10, "function formatDate(d: Date)", "bh15", "function formatDate(d: Date) {}", 1, 0.45],
    [fileIds[3], "slugify", "function", 12, 20, "function slugify(s: string)", "bh16", "function slugify(s: string) {}", 1, 0.4],
    [fileIds[3], "debounce", "function", 22, 35, "function debounce(fn: Function)", "bh17", "function debounce(fn: Function) {}", 1, 0.35],
    [fileIds[3], "clamp", "function", 37, 45, "function clamp(n: number, min: number, max: number)", "bh18", "function clamp(n: number, min: number, max: number) {}", 1, 0.3],
    [fileIds[4], "handleRequest", "function", 1, 20, "function handleRequest(req: Request)", "bh19", "function handleRequest(req: Request) {}", 1, 0.8],
    [fileIds[4], "sendResponse", "function", 22, 35, "function sendResponse(res: Response)", "bh20", "function sendResponse(res: Response) {}", 1, 0.6],
  ] as const;

  const symIds: number[] = [];
  for (const s of symbols) {
    const r = insertSymbol.run(...s, now);
    symIds.push(r.lastInsertRowid as number);
  }

  const edges = [
    [symIds[2], symIds[0], "calls"],
    [symIds[2], symIds[1], "calls"],
    [symIds[5], symIds[6], "calls"],
    [symIds[5], symIds[7], "calls"],
    [symIds[5], symIds[9], "calls"],
    [symIds[18], symIds[5], "calls"],
    [symIds[18], symIds[10], "calls"],
    [symIds[0], symIds[3], "calls"],
    [symIds[1], symIds[4], "calls"],
    [symIds[10], symIds[11], "calls"],
  ] as const;

  for (const e of edges) {
    insertEdge.run(...e, now);
  }
}

describe("edge case: empty capsule generation", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = makeDb();
    populateGraph(db);
  });

  afterAll(() => {
    db.close();
  });

  it("returns metadata with symbolCount 0 for a query that matches nothing", () => {
    const result = generateCapsule(db, {
      query: "xyznonexistent123",
      tokenBudget: 2000,
      sessionId: SESSION_ID,
      projectRoot: PROJECT_ROOT,
    });
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.metadata.symbolCount).toBe(0);
    expect(result.metadata.query).toBe("xyznonexistent123");
  });
});

describe("edge case: single file codebase", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run(SESSION_ID, AGENT_ID, PROJECT_ROOT, Date.now());

    const now = Date.now();
    const fileId = (
      db.prepare(
        "INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("/tmp/edge/solo.ts", "solo.ts", "hashsolo", now, now, "typescript", 1)
    ).lastInsertRowid as number;

    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fileId, "soloFunction", "function", 1, 10, "function soloFunction()", "bhsolo", "function soloFunction() {}", 1, 0.5, now);
  });

  afterAll(() => {
    db.close();
  });

  it("returns a valid capsule with a single file and symbol", () => {
    const result = generateCapsule(db, {
      query: "soloFunction",
      tokenBudget: 2000,
      sessionId: SESSION_ID,
      projectRoot: PROJECT_ROOT,
    });
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.metadata).toBeDefined();
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(0);
  });
});

describe("edge case: unicode symbol names", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = makeDb();
    populateGraph(db);

    const now = Date.now();
    const fileId = (
      db.prepare(
        "INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("/tmp/edge/src/unicode.ts", "unicode.ts", "hashunicode", now, now, "typescript", 1)
    ).lastInsertRowid as number;

    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fileId, "计算函数", "function", 1, 5, "function 计算函数()", "bhunicode", "function 计算函数() {}", 1, 0.5, now);
  });

  afterAll(() => {
    db.close();
  });

  it("can retrieve a symbol with unicode name", () => {
    const rows = db.prepare("SELECT name FROM symbols WHERE name = ?").all("计算函数") as { name: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("计算函数");
  });

  it("generateCapsule does not crash with unicode query", () => {
    expect(() => {
      generateCapsule(db, {
        query: "计算函数",
        tokenBudget: 2000,
        sessionId: SESSION_ID,
        projectRoot: PROJECT_ROOT,
      });
    }).not.toThrow();
  });
});

describe("edge case: very long query", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = makeDb();
    populateGraph(db);
  });

  afterAll(() => {
    db.close();
  });

  it("does not crash with a 500-character query", () => {
    const base = "authenticate user token validate ";
    const longQuery = (base.repeat(Math.ceil(500 / base.length))).slice(0, 500);
    expect(longQuery.length).toBe(500);

    let result: ReturnType<typeof generateCapsule> | undefined;
    expect(() => {
      result = generateCapsule(db, {
        query: longQuery,
        tokenBudget: 2000,
        sessionId: SESSION_ID,
        projectRoot: PROJECT_ROOT,
      });
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(result!.content.length).toBeGreaterThan(0);
  });
});

describe("edge case: zero token budget (minimum 100)", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = makeDb();
    populateGraph(db);
  });

  afterAll(() => {
    db.close();
  });

  it("returns a non-empty result with tokenBudget: 100", () => {
    const result = generateCapsule(db, {
      query: "authenticate",
      tokenBudget: 100,
      sessionId: SESSION_ID,
      projectRoot: PROJECT_ROOT,
    });

    expect(result).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeLessThanOrEqual(100);
  });
});

describe("edge case: capsule with nonexistent path restriction", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = makeDb();
    populateGraph(db);
  });

  afterAll(() => {
    db.close();
  });

  it("handles path filter matching no files gracefully", () => {
    let result: ReturnType<typeof generateCapsule> | undefined;
    expect(() => {
      result = generateCapsule(db, {
        query: "authenticate",
        tokenBudget: 2000,
        path: "src/nonexistent",
        sessionId: SESSION_ID,
        projectRoot: PROJECT_ROOT,
      });
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(result!.content.length).toBeGreaterThan(0);
    expect(result!.metadata.symbolCount).toBe(0);
  });
});

describe("edge case: concurrent capsule generation", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = makeDb();
    populateGraph(db);
  });

  afterAll(() => {
    db.close();
  });

  it("generates 3 capsules in parallel with all valid results", async () => {
    const queries = ["authenticate", "UserService", "getConnection"];

    const results = await Promise.all(
      queries.map((query) =>
        Promise.resolve(
          generateCapsule(db, {
            query,
            tokenBudget: 2000,
            sessionId: SESSION_ID,
            projectRoot: PROJECT_ROOT,
          })
        )
      )
    );

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(0);
      expect(result.metadata.tokensUsed).toBeLessThanOrEqual(2000);
    }
  });
});
