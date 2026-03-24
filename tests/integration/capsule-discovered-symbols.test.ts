import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { createCapsuleContext } from "../../src/capsule/pipeline/types.js";
import { resolvePivots } from "../../src/capsule/pipeline/pivot-resolver.js";
import { expandGraph } from "../../src/capsule/pipeline/graph-expander.js";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();

  const authFileId = files.insert({
    path: "src/auth/controller.ts",
    hash: "auth",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
  const serviceFileId = files.insert({
    path: "src/users/service.ts",
    hash: "service",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
  const tokenFileId = files.insert({
    path: "src/users/token.ts",
    hash: "token",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });

  const authControllerId = symbols.insert({
    fileId: authFileId,
    name: "AuthController",
    kind: "class",
    startLine: 1,
    endLine: 20,
    signature: "class AuthController handles login flows",
    bodyHash: "auth-controller",
    fullSource: "export class AuthController { login() { return userService.issueToken(); } }",
    isExported: true,
    docComment: null,
    centrality: 2,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: "AuthController",
    visibility: "public",
  });
  const userServiceId = symbols.insert({
    fileId: serviceFileId,
    name: "UserService",
    kind: "class",
    startLine: 1,
    endLine: 20,
    signature: "class UserService",
    bodyHash: "user-service",
    fullSource: "export class UserService { issueToken() { return new TokenIssuer(); } }",
    isExported: true,
    docComment: null,
    centrality: 1,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: "UserService",
    visibility: "public",
  });
  const tokenIssuerId = symbols.insert({
    fileId: tokenFileId,
    name: "TokenIssuer",
    kind: "class",
    startLine: 1,
    endLine: 20,
    signature: "class TokenIssuer",
    bodyHash: "token-issuer",
    fullSource: "export class TokenIssuer { create() { return 'token'; } }",
    isExported: true,
    docComment: null,
    centrality: 1,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: "TokenIssuer",
    visibility: "public",
  });

  edges.insert({ sourceSymbolId: authControllerId, targetSymbolId: userServiceId, kind: "call", createdAt: now });
  edges.insert({ sourceSymbolId: userServiceId, targetSymbolId: tokenIssuerId, kind: "call", createdAt: now });
});

afterAll(() => {
  db.close();
});

describe("generateCapsule discoveredSymbols", () => {
  it("surfaces discovered symbols that can be fed back as anchor_symbols for richer capsules", () => {
    const first = generateCapsule(db, {
      query: "login",
      tokenBudget: 1600,
    });

    expect(first.structured).toBeDefined();
    expect(first.structured!.discoveredSymbols).toContain("AuthController");
    expect(first.structured!.discoveredSymbols).toContain("UserService");

    const anchoredContext = createCapsuleContext(db, {
      query: "login",
      tokenBudget: 1600,
      anchorSymbols: first.structured!.discoveredSymbols,
    });
    const anchoredPivot = resolvePivots(anchoredContext);
    const anchoredGraph = expandGraph(anchoredContext, anchoredPivot);
    const symbols = symbolQueries(db);
    const userServiceId = symbols.getByName("UserService")[0]!.id;
    const tokenIssuerId = symbols.getByName("TokenIssuer")[0]!.id;

    expect(anchoredPivot.anchorPivotIds.has(userServiceId)).toBe(true);
    expect(anchoredGraph.visited.get(userServiceId)).toBe(0);
    expect(anchoredGraph.visited.has(tokenIssuerId)).toBe(true);
  });
});
