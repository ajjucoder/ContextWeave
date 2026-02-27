import { describe, it, expect } from "vitest";
import { renderFileSummary } from "../../src/capsule/compressor.js";

describe("renderFileSummary", () => {
  it("renders a single-line file summary", () => {
    const summary = renderFileSummary("src/db/queries/edges.ts", [
      { name: "insert", kind: "method" },
      { name: "getBySource", kind: "method" },
      { name: "getByTarget", kind: "method" },
      { name: "deleteBySymbol", kind: "method" },
      { name: "mapRow", kind: "function" },
      { name: "edgeQueries", kind: "function" },
    ]);

    expect(summary).toContain("src/db/queries/edges.ts");
    expect(summary).toContain("6 symbols");
    expect(summary).toContain("insert");
    expect(summary).toContain("edgeQueries");
  });

  it("truncates long symbol lists to keep summary short", () => {
    const symbols = Array.from({ length: 20 }, (_, i) => ({ name: `symbol${i}`, kind: "function" }));
    const summary = renderFileSummary("src/big-file.ts", symbols);
    expect(summary).toContain("20 symbols");
    expect(summary.length).toBeLessThan(200);
  });

  it("handles empty symbol list", () => {
    const summary = renderFileSummary("src/empty.ts", []);
    expect(summary).toContain("src/empty.ts");
    expect(summary).toContain("0 symbols");
  });
});
