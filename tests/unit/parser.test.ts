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
  { language: "markdown", fileName: "sample.ts", extProbe: "README.md" },
  { language: "yaml", fileName: "sample.ts", extProbe: "config.yml" },
  { language: "json", fileName: "sample.ts", extProbe: "config.json" },
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

  it("extracts js-like import/re-export aliases and export-star declarations", () => {
    const content = `
import { add as sum } from "./math";
export { add as plus } from "./math";
export * from "./shared";
`;
    const parsed = parseFile("module.ts", content, "typescript");

    const aliasedImport = parsed.imports.find((imp) => imp.source === "./math" && !imp.isReExport);
    expect(aliasedImport).toBeDefined();
    expect(aliasedImport?.names).toContain("sum");
    expect(aliasedImport?.specifiers).toEqual([{ localName: "sum", importedName: "add" }]);

    const reExportAlias = parsed.imports.find((imp) => imp.source === "./math" && imp.isReExport);
    expect(reExportAlias).toBeDefined();
    expect(reExportAlias?.specifiers).toEqual([{ localName: "plus", importedName: "add" }]);

    const exportAll = parsed.imports.find((imp) => imp.source === "./shared" && imp.isReExport);
    expect(exportAll).toBeDefined();
    expect(exportAll?.exportAll).toBe(true);
  });

  it("parses CommonJS require imports and exported object-literal handler methods", () => {
    const content = `
const {
  exchangeCode,
  persistProviderToken,
} = require("../services/oauth-service");

const oauthController = {
  handleOAuthCallback: async (req, res) => {
    const token = await exchangeCode(req.query.code);
    await persistProviderToken(token);
    return res.json({ ok: true });
  },
};

module.exports = { oauthController };
`;
    const parsed = parseFile("oauth-controller.js", content, "javascript");
    const names = parsed.symbols.map((symbol) => symbol.name);
    const handleOAuthCallback = parsed.symbols.find((symbol) => symbol.name === "handleOAuthCallback");
    const serviceImport = parsed.imports.find((imp) => imp.source === "../services/oauth-service");

    expect(parsed.errors).toHaveLength(0);
    expect(serviceImport).toBeDefined();
    expect(serviceImport?.names).toEqual(["exchangeCode", "persistProviderToken"]);
    expect(names).toContain("oauthController");
    expect(names).toContain("handleOAuthCallback");
    expect(handleOAuthCallback?.kind).toBe("arrow");
    expect(handleOAuthCallback?.isExported).toBe(true);
    expect(parsed.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callerSymbol: "handleOAuthCallback", calleeName: "exchangeCode" }),
        expect.objectContaining({ callerSymbol: "handleOAuthCallback", calleeName: "persistProviderToken" }),
      ])
    );
  });

  it("treats CommonJS require aliases as default module imports", () => {
    const content = `
const proto = require("./application");

function createApplication() {
  return proto.init();
}
`;
    const parsed = parseFile("express.js", content, "javascript");
    const moduleImport = parsed.imports.find((imp) => imp.source === "./application");

    expect(parsed.errors).toHaveLength(0);
    expect(moduleImport).toBeDefined();
    expect(moduleImport?.kind).toBe("default");
    expect(moduleImport?.specifiers).toEqual([{ localName: "proto", importedName: "default" }]);
  });

  it("marks browser-global assignments and IIFE wrappers as exported JS entrypoints", () => {
    const content = `
const startServer = () => bootKernel();
const publicApi = (() => {
  function boot() {
    return startServer();
  }

  return { boot };
})();

globalThis.publicApi = publicApi;
window.startServer = startServer;
`;
    const parsed = parseFile("browser-entry.js", content, "javascript");
    const publicApi = parsed.symbols.find((symbol) => symbol.name === "publicApi");
    const startServer = parsed.symbols.find((symbol) => symbol.name === "startServer");
    const boot = parsed.symbols.find((symbol) => symbol.name === "boot");

    expect(parsed.errors).toHaveLength(0);
    expect(publicApi?.isExported).toBe(true);
    expect(startServer?.isExported).toBe(true);
    expect(boot).toBeDefined();
    expect(parsed.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callerSymbol: "boot", calleeName: "startServer" }),
      ])
    );
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

  it("tolerates benign TSX JSX text parse warnings caused by ampersands", () => {
    const content = `
      export function TermsPage() {
        return <p>Terms & Conditions &amp; Privacy</p>;
      }
    `;
    const parsed = parseFile("terms.tsx", content, "tsx");
    const termsPage = parsed.symbols.find((symbol) => symbol.name === "TermsPage");

    expect(parsed.errors).toHaveLength(0);
    expect(termsPage).toBeDefined();
    expect(termsPage?.kind).toBe("function");
  });

  it("keeps real TSX syntax errors when the failure is outside benign JSX text", () => {
    const content = `
      export function BrokenTermsPage() {
        const value = ;
        return <p>Terms & Conditions</p>;
      }
    `;
    const parsed = parseFile("broken-terms.tsx", content, "tsx");

    expect(parsed.errors.some((error) => error.includes("Syntax errors detected"))).toBe(true);
  });

  it("accepts replacement-character input from non-utf8 sources", () => {
    const content = Buffer.from([0xff, 0xfe, 0xfd, 0x61]).toString("utf-8");
    const parsed = parseFile("binary.ts", content, "typescript");
    expect(Array.isArray(parsed.errors)).toBe(true);
  });

  it("creates searchable document symbols for markdown and yaml files", () => {
    const markdown = parseFile(
      "docs/partner-policy.md",
      "# Partner Policy\n\nDistrict approval is required before auto-enrollment.\n",
      "markdown"
    );
    const yaml = parseFile(
      "config/program-rules.yaml",
      "requireDistrictApproval: true\napprovalSource: district-reviewer\n",
      "yaml"
    );

    expect(markdown.errors).toHaveLength(0);
    expect(markdown.symbols).toHaveLength(1);
    expect(markdown.symbols[0]?.name.toLowerCase()).toContain("partner policy");
    expect(markdown.symbols[0]?.fullSource).toContain("District approval");

    expect(yaml.errors).toHaveLength(0);
    expect(yaml.symbols).toHaveLength(1);
    expect(yaml.symbols[0]?.name.toLowerCase()).toContain("district");
    expect(yaml.symbols[0]?.fullSource).toContain("approvalSource");
  });

  it("parses markdown headings into documentation symbols with paragraph bodies", () => {
    const markdown = parseFile(
      "ADR/ADR-001-auth-tokens.md",
      [
        "# ADR-001: Auth Tokens",
        "",
        "Use refresh tokens for session continuity.",
        "",
        "## Decision",
        "",
        "Store refresh tokens in HttpOnly cookies.",
        "",
        "## Consequences",
        "",
        "Rotate tokens after refresh and revoke on logout.",
        "",
      ].join("\n"),
      "markdown"
    );

    expect(markdown.errors).toHaveLength(0);
    expect(markdown.symbols).toHaveLength(3);
    expect(markdown.symbols.map((symbol) => symbol.kind)).toEqual([
      "documentation",
      "documentation",
      "documentation",
    ]);
    expect(markdown.symbols[0]?.name).toContain("ADR-001");
    expect(markdown.symbols[1]?.name).toContain("Decision");
    expect(markdown.symbols[1]?.fullSource).toContain("HttpOnly cookies");
    expect(markdown.symbols[2]?.fullSource).toContain("revoke on logout");
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

  it("creates a synthetic __main__ entrypoint symbol for python CLI files", () => {
    const content = `
def main():
    return run()

if __name__ == "__main__":
    main()
`;
    const parsed = parseFile("cli.py", content, "python");
    const entrypoint = parsed.symbols.find((symbol) => symbol.name === "__main__");

    expect(parsed.errors).toHaveLength(0);
    expect(entrypoint).toBeDefined();
    expect(entrypoint?.signature).toContain(`__main__`);
    expect(parsed.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callerSymbol: "__main__", calleeName: "main" }),
      ])
    );
  });

  it("honors python __all__ for module-level export detection", () => {
    const content = `
__all__ = ["public_api"]

def public_api():
  return 1

def _internal():
  return 2

class Service:
  def method(self):
    return 3
`;
    const parsed = parseFile("exports.py", content, "python");
    const byName = new Map(parsed.symbols.map((symbol) => [symbol.name, symbol]));

    expect(byName.get("public_api")?.isExported).toBe(true);
    expect(byName.get("_internal")?.isExported).toBe(false);
    expect(byName.get("method")?.isExported).toBe(false);
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

  it("detects symbol visibility across supported language conventions", () => {
    const tsParsed = parseFile(
      "visibility.ts",
      `
class Service {
  public greet() {
    return "hi";
  }

  private secret() {
    return "hidden";
  }

  protected hydrate() {
    return true;
  }
}
`,
      "typescript"
    );
    const pyParsed = parseFile(
      "visibility.py",
      `
class Service:
  def __secret(self):
    return 1

  def _hydrate(self):
    return 2
`,
      "python"
    );
    const rustParsed = parseFile(
      "visibility.rs",
      `
pub(crate) fn register_service() {}
fn private_helper() {}
`,
      "rust"
    );

    const tsByName = new Map(tsParsed.symbols.map((symbol) => [symbol.name, symbol.visibility]));
    const pyByName = new Map(pyParsed.symbols.map((symbol) => [symbol.name, symbol.visibility]));
    const rustByName = new Map(rustParsed.symbols.map((symbol) => [symbol.name, symbol.visibility]));

    expect(tsByName.get("greet")).toBe("public");
    expect(tsByName.get("secret")).toBe("private");
    expect(tsByName.get("hydrate")).toBe("protected");
    expect(pyByName.get("__secret")).toBe("private");
    expect(pyByName.get("_hydrate")).toBe("protected");
    expect(rustByName.get("register_service")).toBe("internal");
    expect(rustByName.get("private_helper")).toBe("private");
  });

  it("parses rust macro invocation contexts without parse failures", () => {
    const path = resolve(__dirname, "../fixtures/sample.rs");
    const content = readFileSync(path, "utf-8");
    const parsed = parseFile(path, content, "rust");
    const names = parsed.symbols.map((symbol) => symbol.name);

    expect(parsed.errors).toHaveLength(0);
    expect(names).toContain("new_service");
  });

  it("detects server-action edges for file-level 'use server' directive with exported functions", () => {
    const content = `
'use server';

export async function createUser(data: FormData) {
  return { id: 1, name: data.get("name") };
}

export async function deleteUser(id: number) {
  return { deleted: id };
}

function internalHelper() {
  return true;
}
`;
    const parsed = parseFile("actions.ts", content, "typescript");
    const serverActionEdges = parsed.calls.filter((call) => call.edgeKind === "server-action");

    expect(parsed.errors).toHaveLength(0);
    expect(serverActionEdges.length).toBeGreaterThanOrEqual(1);
    expect(serverActionEdges.some((edge) => edge.callerSymbol === "createUser")).toBe(true);
    expect(serverActionEdges.some((edge) => edge.callerSymbol === "deleteUser")).toBe(true);
    expect(serverActionEdges.every((edge) => edge.calleeName === edge.callerSymbol)).toBe(true);
    expect(serverActionEdges.some((edge) => edge.callerSymbol === "internalHelper")).toBe(false);
  });

  it("detects server-action edges for inline 'use server' directive inside a function body", () => {
    const content = `
export async function submitForm(data: FormData) {
  'use server';
  return { ok: true, value: data.get("field") };
}

export function clientComponent() {
  return null;
}
`;
    const parsed = parseFile("mixed.tsx", content, "tsx");
    const serverActionEdges = parsed.calls.filter((call) => call.edgeKind === "server-action");

    expect(parsed.errors).toHaveLength(0);
    expect(serverActionEdges.some((edge) => edge.callerSymbol === "submitForm")).toBe(true);
    expect(serverActionEdges.some((edge) => edge.callerSymbol === "clientComponent")).toBe(false);
  });

  it("parses all language fixtures with symbols and language-appropriate graph metadata", () => {
    for (const fixture of languageFixtures) {
      const path = resolve(__dirname, `../fixtures/${fixture.fileName}`);
      const content = readFileSync(path, "utf-8");
      const parsed = parseFile(path, content, fixture.language);

      expect(parsed.errors).toHaveLength(0);
      expect(parsed.symbols.length).toBeGreaterThan(0);
      if (fixture.language === "markdown" || fixture.language === "yaml" || fixture.language === "json") {
        expect(parsed.imports).toHaveLength(0);
        expect(parsed.calls).toHaveLength(0);
        expect(parsed.frameworkCalls).toHaveLength(0);
      } else {
        expect(parsed.imports.length).toBeGreaterThan(0);
        expect(parsed.calls.length).toBeGreaterThan(0);
      }
    }
  });
});
