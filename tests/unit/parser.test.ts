import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFile, detectLanguage } from "../../src/core/parser.js";

const FIXTURE_PATH = resolve(__dirname, "../fixtures/sample.ts");
const FIXTURE_CONTENT = readFileSync(FIXTURE_PATH, "utf-8");

const languageFixtures = [
  { language: "go", fileName: "sample.go", extProbe: "foo.go" },
  { language: "rust", fileName: "sample.rs", extProbe: "foo.rs" },
  { language: "typescript", fileName: "sample.ts", extProbe: "foo.mts" },
  { language: "typescript", fileName: "sample.ts", extProbe: "foo.cts" },
  { language: "java", fileName: "sample.java", extProbe: "Foo.java" },
  { language: "c", fileName: "sample.c", extProbe: "foo.c" },
  { language: "c", fileName: "sample.c", extProbe: "foo.h" },
  { language: "cpp", fileName: "sample.cpp", extProbe: "foo.cpp" },
  { language: "cpp", fileName: "sample.cpp", extProbe: "foo.hxx" },
  { language: "csharp", fileName: "sample.cs", extProbe: "foo.cs" },
  { language: "ruby", fileName: "sample.rb", extProbe: "foo.rb" },
  { language: "ruby", fileName: "sample.rb", extProbe: "Rakefile.rake" },
  { language: "bash", fileName: "sample.sh", extProbe: "run.sh" },
  { language: "bash", fileName: "sample.sh", extProbe: "run.bash" },
  { language: "php", fileName: "sample.php", extProbe: "foo.php" },
  { language: "python", fileName: "sample.py", extProbe: "foo.py" },
];

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript");
  });

  it("detects TSX", () => {
    expect(detectLanguage("component.tsx")).toBe("tsx");
  });

  it("detects JavaScript", () => {
    expect(detectLanguage("foo.js")).toBe("javascript");
  });

  it("detects Python", () => {
    expect(detectLanguage("foo.py")).toBe("python");
  });

  it("detects all added language extensions", () => {
    for (const fixture of languageFixtures) {
      expect(detectLanguage(fixture.extProbe)).toBe(fixture.language);
    }
  });

  it("returns null for unknown extensions", () => {
    expect(detectLanguage("foo.kt")).toBeNull();
    expect(detectLanguage("foo.swift")).toBeNull();
    expect(detectLanguage("foo.elm")).toBeNull();
  });
});

describe("parseFile", () => {
  const result = parseFile(FIXTURE_PATH, FIXTURE_CONTENT, "typescript");

  it("extracts symbols from TypeScript file", () => {
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  it("finds interface declarations", () => {
    const user = result.symbols.find((s) => s.name === "User");
    expect(user).toBeDefined();
    expect(user?.kind).toBe("interface");
    expect(user?.isExported).toBe(true);
  });

  it("finds type alias declarations", () => {
    const role = result.symbols.find((s) => s.name === "UserRole");
    expect(role).toBeDefined();
    expect(role?.kind).toBe("type");
  });

  it("finds function declarations", () => {
    const validate = result.symbols.find((s) => s.name === "validateEmail");
    expect(validate).toBeDefined();
    expect(validate?.kind).toBe("function");
    expect(validate?.isExported).toBe(true);
  });

  it("finds async function declarations", () => {
    const load = result.symbols.find((s) => s.name === "loadUser");
    expect(load).toBeDefined();
    expect(load?.kind).toBe("function");
  });

  it("finds class declarations", () => {
    const service = result.symbols.find((s) => s.name === "UserService");
    expect(service).toBeDefined();
    expect(service?.kind).toBe("class");
  });

  it("finds arrow functions", () => {
    const arrow = result.symbols.find((s) => s.name === "getDefaultRole");
    expect(arrow).toBeDefined();
    expect(arrow?.kind).toBe("arrow");
  });

  it("extracts imports", () => {
    expect(result.imports.length).toBeGreaterThan(0);
    const fsImport = result.imports.find((i) => i.source === "node:fs/promises");
    expect(fsImport).toBeDefined();
    expect(fsImport?.names).toContain("readFile");
  });

  it("extracts call references", () => {
    expect(result.calls.length).toBeGreaterThan(0);
  });

  it("computes body hashes", () => {
    for (const symbol of result.symbols) {
      expect(symbol.bodyHash).toBeTruthy();
      expect(symbol.bodyHash.length).toBeGreaterThan(0);
    }
  });

  it("returns no errors for valid file", () => {
    expect(result.errors).toHaveLength(0);
  });

  it("filters single-line local variable declarations in function scope", () => {
    const inlineContent = `
      export function outer(input: number): number {
        const local = input + 1;
        const helper = (value: number) => {
          return value + local;
        };
        const localObject = {
          value: helper(input),
        };
        return localObject.value;
      }

      const topLevel = 42;
    `;
    const inlineResult = parseFile("inline.ts", inlineContent, "typescript");
    const names = inlineResult.symbols.map((s) => s.name);

    expect(names).not.toContain("local");
    expect(names).toContain("helper");
    expect(names).toContain("localObject");
    expect(names).toContain("topLevel");
  });

  it("handles empty files without parser crashes", () => {
    const parsed = parseFile("empty.ts", "", "typescript");
    expect(parsed.symbols).toHaveLength(0);
    expect(parsed.imports).toHaveLength(0);
    expect(parsed.calls).toHaveLength(0);
    expect(Array.isArray(parsed.errors)).toBe(true);
  });

  it("surfaces syntax errors for malformed source", () => {
    const malformed = parseFile("broken.ts", "export function broken( {", "typescript");
    expect(malformed.errors.length).toBeGreaterThan(0);
    expect(malformed.errors.some((error) => error.includes("Syntax errors detected"))).toBe(true);
  });

  it("accepts replacement-character input from non-utf8 sources", () => {
    const content = Buffer.from([0xff, 0xfe, 0xfd, 0x61]).toString("utf-8");
    const parsed = parseFile("binary.ts", content, "typescript");
    expect(Array.isArray(parsed.errors)).toBe(true);
  });

  it("parses python decorators without dropping class and method symbols", () => {
    const path = resolve(__dirname, "../fixtures/sample.py");
    const content = readFileSync(path, "utf-8");
    const parsed = parseFile(path, content, "python");
    const names = parsed.symbols.map((symbol) => symbol.name);

    expect(parsed.errors).toHaveLength(0);
    expect(names).toContain("UserService");
    expect(names).toContain("greet");
    expect(names).toContain("build_service");
  });

  it("parses go interface embedding constructs", () => {
    const path = resolve(__dirname, "../fixtures/sample.go");
    const content = readFileSync(path, "utf-8");
    const parsed = parseFile(path, content, "go");
    const names = parsed.symbols.map((symbol) => symbol.name);

    expect(parsed.errors).toHaveLength(0);
    expect(names).toContain("ReadCloser");
    expect(names).toContain("NewUserService");
  });

  it("parses rust macro invocation contexts without parse failures", () => {
    const path = resolve(__dirname, "../fixtures/sample.rs");
    const content = readFileSync(path, "utf-8");
    const parsed = parseFile(path, content, "rust");
    const names = parsed.symbols.map((symbol) => symbol.name);

    expect(parsed.errors).toHaveLength(0);
    expect(names).toContain("new_service");
  });

  it("parses all language fixtures with symbols, imports, and calls", () => {
    for (const fixture of languageFixtures) {
      const path = resolve(__dirname, `../fixtures/${fixture.fileName}`);
      const content = readFileSync(path, "utf-8");
      const parsed = parseFile(path, content, fixture.language);

      expect(parsed.errors).toHaveLength(0);
      expect(parsed.symbols.length).toBeGreaterThan(0);
      expect(parsed.imports.length).toBeGreaterThan(0);
      expect(parsed.calls.length).toBeGreaterThan(0);
    }
  });
});
