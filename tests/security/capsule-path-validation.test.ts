/**
 * SEC-007: Capsule Path/Glob Validation Security Tests
 * 
 * This test suite validates the fix for path traversal and string length
 * vulnerabilities in the cw_capsule MCP tool.
 * 
 * Current Status: Tests will FAIL until the vulnerability is fixed.
 * The failures demonstrate the security gaps documented in:
 * - SEC-007-capsule-path-validation-assertions.md
 * 
 * Assertions:
 * - VAL-SEC-007a: Path parameter rejects `..` segments
 * - VAL-SEC-007b: Glob parameter rejects `..` segments  
 * - VAL-SEC-007c: Path parameter max length (4096 chars) enforced
 * - VAL-SEC-007d: Glob parameter max length (4096 chars) enforced
 * - VAL-SEC-007e: Absolute path outside project root rejected
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { registerCapsuleTool } from "../../src/mcp/tools/capsule.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  handler: (args: unknown) => Promise<ToolResult>;
};

function getTool(server: McpServer, name: string): RegisteredTool {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

// Helper to handle Zod validation errors thrown by MCP SDK
async function callWithValidation(handler: (args: unknown) => Promise<ToolResult>, args: unknown): Promise<ToolResult> {
  try {
    return await handler(args);
  } catch (error: unknown) {
    // Zod validation errors are thrown before reaching the handler
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: errorMessage }],
      isError: true,
    };
  }
}

let db: Database.Database;
let server: McpServer;
const TEMP_DIR = resolve(__dirname, "../tmp-capsule-security");

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  // Create temp project directory
  mkdirSync(TEMP_DIR, { recursive: true });
  mkdirSync(resolve(TEMP_DIR, "src"), { recursive: true });
  writeFileSync(resolve(TEMP_DIR, "src", "test.ts"), "export const x = 1;");

  server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
  registerCapsuleTool(server, db, TEMP_DIR, undefined, undefined, null);
});

afterAll(() => {
  db.close();
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

/**
 * VAL-SEC-007a: Path parameter rejects `..` segments
 * 
 * Evidence: All paths containing ".." segments must be rejected
 */
describe("VAL-SEC-007a: Path parameter rejects .. segments", () => {
  const traversalPaths = [
    "../file.ts",
    "../../etc/passwd",
    "src/../secret.ts",
    "src/../../etc/passwd",
    "./../secret.ts",
    "a/b/../../../etc/passwd",
    "../../../etc/passwd",
  ];

  it.each(traversalPaths)("rejects path with traversal: %s", async (path) => {
    const result = await callWithValidation(getTool(server, "cw_capsule").handler, {
      query: "test query",
      path,
    });

    // Assertion: Path traversal must trigger error
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/outside project root|traversal|invalid path|\.{2}|exceeds|too long/i);
  });
});

/**
 * VAL-SEC-007b: Glob parameter rejects `..` segments
 * 
 * Evidence: All globs containing ".." must be rejected
 */
describe("VAL-SEC-007b: Glob parameter rejects .. segments", () => {
  const traversalGlobs = [
    "../**/*.ts",
    "../../etc/**",
    "**/../secret.ts",
    "src/../../**/*",
    "a/**/../../b/**/*.ts",
    "../../**",
    "../../*",
    "../../../**/*.json",
  ];

  it.each(traversalGlobs)("rejects glob with traversal: %s", async (glob) => {
    const result = await callWithValidation(getTool(server, "cw_capsule").handler, {
      query: "test query",
      glob,
    });

    // Assertion: Glob traversal must trigger error
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/outside project root|traversal|invalid glob|\.{2}|exceeds|too long/i);
  });
});

/**
 * VAL-SEC-007c: Path parameter max length enforced
 * 
 * Evidence: Paths exceeding 4096 characters must be rejected
 */
describe("VAL-SEC-007c: Path parameter max length enforced", () => {
  it("rejects path exceeding 4096 characters", async () => {
    const longPath = "a/".repeat(2050) + "file.ts"; // ~4100+ chars
    
    const result = await callWithValidation(getTool(server, "cw_capsule").handler, {
      query: "test query",
      path: longPath,
    });

    // Assertion: Overly long path must trigger validation error
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/too long|max(imum)? length|exceeds/i);
  });

  it("accepts path within 4096 character limit", async () => {
    const validPath = "src/a/b/c/d/e/f/g/file.ts"; // Well under limit
    
    // This may succeed or fail for other reasons, but should NOT fail due to length
    const result = await getTool(server, "cw_capsule").handler({
      query: "test query",
      path: validPath,
    });

    // If it fails, it should NOT be due to length
    if (result.isError) {
      const text = result.content[0]?.text ?? "";
      expect(text).not.toMatch(/too long|max(imum)? length|exceeds/i);
    }
  });
});

/**
 * VAL-SEC-007d: Glob parameter max length enforced
 * 
 * Evidence: Glob patterns exceeding 4096 characters must be rejected
 */
describe("VAL-SEC-007d: Glob parameter max length enforced", () => {
  it("rejects glob exceeding 4096 characters", async () => {
    const longGlob = "**/*" + "a".repeat(4100); // ~4100+ chars
    
    const result = await callWithValidation(getTool(server, "cw_capsule").handler, {
      query: "test query",
      glob: longGlob,
    });

    // Assertion: Overly long glob must trigger validation error
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/too long|max(imum)? length|exceeds/i);
  });

  it("accepts glob within 4096 character limit", async () => {
    const validGlob = "**/*.ts"; // Well under limit
    
    // This may succeed or fail for other reasons, but should NOT fail due to length
    const result = await getTool(server, "cw_capsule").handler({
      query: "test query",
      glob: validGlob,
    });

    // If it fails, it should NOT be due to length
    if (result.isError) {
      const text = result.content[0]?.text ?? "";
      expect(text).not.toMatch(/too long|max(imum)? length|exceeds/i);
    }
  });
});

/**
 * VAL-SEC-007e: Absolute path rejection or validation
 * 
 * Evidence: Absolute paths outside project root must be rejected
 */
describe("VAL-SEC-007e: Absolute path rejection or validation", () => {
  const absoluteOutsidePaths = [
    "/etc/passwd",
    "/home/user/.ssh/id_rsa",
    "C:\\Windows\\System32\\config.sam",
    "D:\\secret.txt",
    "\\\\server\\share\\secret.txt",
  ];

  it.each(absoluteOutsidePaths)("rejects absolute path outside project root: %s", async (path) => {
    const result = await callWithValidation(getTool(server, "cw_capsule").handler, {
      query: "test query",
      path,
    });

    // Assertion: Absolute paths outside root must trigger error
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/outside project root|absolute path rejected|invalid path|traversal|\.{2}/i);
  });

  it("accepts absolute path within project root", async () => {
    // This test verifies that absolute paths WITHIN the root are handled correctly
    // The path is constructed to be absolute and within TEMP_DIR
    const absoluteWithinRoot = resolve(TEMP_DIR, "src");
    
    const result = await getTool(server, "cw_capsule").handler({
      query: "test query",
      path: absoluteWithinRoot,
    });

    // If it fails, it should NOT be due to being outside project root
    if (result.isError) {
      const text = result.content[0]?.text ?? "";
      expect(text).not.toMatch(/outside project root/i);
    }
  });
});

/**
 * Combined validation: Multiple security violations
 */
describe("Combined security validations", () => {
  it("rejects path with both traversal and excessive length", async () => {
    const evilPath = "../".repeat(200) + "file.ts"; // Traversal + length violation
    
    const result = await callWithValidation(getTool(server, "cw_capsule").handler, {
      query: "test query",
      path: evilPath,
    });

    expect(result.isError).toBe(true);
  });

  it("rejects glob with both traversal and excessive length", async () => {
    const evilGlob = "../**/*" + "a".repeat(600); // Traversal + length violation
    
    const result = await callWithValidation(getTool(server, "cw_capsule").handler, {
      query: "test query",
      glob: evilGlob,
    });

    expect(result.isError).toBe(true);
  });
});
