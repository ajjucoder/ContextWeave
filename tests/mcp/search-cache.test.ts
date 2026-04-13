import { describe, expect, it } from "vitest";
import { renderMatchOnlySnippet } from "../../src/mcp/tools/search.js";

describe("cw_grep fast snippet rendering", () => {
  it("formats a single ripgrep hit without needing file context", () => {
    expect(renderMatchOnlySnippet(12, "const token = createToken();   ")).toBe(
      "> 12 | const token = createToken();"
    );
  });
});
