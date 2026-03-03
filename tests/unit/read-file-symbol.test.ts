import { describe, it, expect } from "vitest";
import { parseSymbolTarget } from "../../src/mcp/tools/read.js";

describe("parseSymbolTarget", () => {
  it("parses file:symbol format", () => {
    const result = parseSymbolTarget("types.ts:Site");
    expect(result).toEqual({ fileSuffix: "types.ts", symbolName: "Site" });
  });

  it("returns null for plain symbol name", () => {
    const result = parseSymbolTarget("Site");
    expect(result).toBeNull();
  });

  it("handles path with multiple segments", () => {
    const result = parseSymbolTarget("src/types.ts:Site");
    expect(result).toEqual({ fileSuffix: "src/types.ts", symbolName: "Site" });
  });

  it("returns null when no file extension before colon", () => {
    const result = parseSymbolTarget("noextension:Site");
    expect(result).toBeNull();
  });

  it("handles deeply nested path", () => {
    const result = parseSymbolTarget("src/core/types.ts:CapsuleOutput");
    expect(result).toEqual({ fileSuffix: "src/core/types.ts", symbolName: "CapsuleOutput" });
  });
});
