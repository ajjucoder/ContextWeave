import { describe, it, expect, beforeEach } from "vitest";
import {
  NullLspBridge,
  ActiveLspBridge,
  createLspBridge,
  formatLspStatus,
  detectAvailableLspServers,
  type DetectedLspServer,
  type LspBridge,
} from "../../src/core/lsp-bridge.js";

// ---------------------------------------------------------------------------
// NullLspBridge — graceful degradation baseline
// ---------------------------------------------------------------------------

describe("NullLspBridge", () => {
  let bridge: NullLspBridge;

  beforeEach(() => {
    bridge = new NullLspBridge();
  });

  it("reports as unavailable", () => {
    expect(bridge.isAvailable()).toBe(false);
  });

  it("resolves definitions without throwing, returning empty locations", async () => {
    const results = await bridge.resolveDefinitions(["parseFile", "generateCapsule"]);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.fromLsp).toBe(false);
      expect(r.locations).toHaveLength(0);
    }
  });

  it("returns correct symbolName in each definition result", async () => {
    const names = ["foo", "bar", "baz"];
    const results = await bridge.resolveDefinitions(names);
    expect(results.map((r) => r.symbolName)).toEqual(names);
  });

  it("getReferences returns empty locations without throwing", async () => {
    const ref = await bridge.getReferences("someSymbol");
    expect(ref.symbolName).toBe("someSymbol");
    expect(ref.fromLsp).toBe(false);
    expect(ref.locations).toHaveLength(0);
  });

  it("tracks fallback stats correctly", async () => {
    await bridge.resolveDefinitions(["a", "b"]);
    await bridge.getReferences("c");
    const stats = bridge.getStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.fallbacks).toBe(3);
    expect(stats.lspHits).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it("shutdown does not throw", () => {
    expect(() => bridge.shutdown()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ActiveLspBridge — with synthetic detected servers
// ---------------------------------------------------------------------------

describe("ActiveLspBridge", () => {
  const fakeServers: DetectedLspServer[] = [
    { language: "typescript", binary: "typescript-language-server" },
  ];

  let bridge: ActiveLspBridge;

  beforeEach(() => {
    bridge = new ActiveLspBridge(fakeServers);
  });

  it("reports as available when servers are provided", () => {
    expect(bridge.isAvailable()).toBe(true);
  });

  it("resolves an empty list without error", async () => {
    const results = await bridge.resolveDefinitions([]);
    expect(results).toHaveLength(0);
  });

  it("resolves definitions for a single symbol (falls back gracefully)", async () => {
    const results = await bridge.resolveDefinitions(["classifyQuery"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.symbolName).toBe("classifyQuery");
    expect(results[0]?.locations).toHaveLength(0);
  });

  it("handles batches larger than BATCH_SIZE=20 without error", async () => {
    const names = Array.from({ length: 45 }, (_, i) => `symbol_${i}`);
    const results = await bridge.resolveDefinitions(names);
    expect(results).toHaveLength(45);
    for (const r of results) {
      expect(r.fromLsp).toBe(false);
    }
  });

  it("getReferences returns empty locations (graceful fallback)", async () => {
    const ref = await bridge.getReferences("myFunction");
    expect(ref.symbolName).toBe("myFunction");
    expect(ref.fromLsp).toBe(false);
    expect(ref.locations).toHaveLength(0);
  });

  it("getStats returns consistent counts after mixed calls", async () => {
    await bridge.resolveDefinitions(["a", "b", "c"]);
    await bridge.getReferences("d");
    const stats = bridge.getStats();
    expect(stats.totalRequests).toBe(4);
    expect(stats.errors).toBe(0);
  });

  it("getStats lspHits + fallbacks + errors equals totalRequests (accounting completeness)", async () => {
    const b = new ActiveLspBridge([{ language: "typescript", binary: "typescript-language-server" }]);
    await b.resolveDefinitions(["x", "y", "z"]);
    await b.getReferences("w");
    const stats = b.getStats();
    expect(stats.lspHits + stats.fallbacks + stats.errors).toBe(stats.totalRequests);
    expect(stats.totalRequests).toBe(4);
    expect(stats.fallbacks).toBe(4);
    expect(stats.lspHits).toBe(0);
  });

  it("shutdown does not throw", () => {
    expect(() => bridge.shutdown()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ActiveLspBridge with no servers — behaves like null bridge
// ---------------------------------------------------------------------------

describe("ActiveLspBridge (empty server list)", () => {
  it("reports as unavailable", () => {
    const bridge = new ActiveLspBridge([]);
    expect(bridge.isAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createLspBridge — factory
// ---------------------------------------------------------------------------

describe("createLspBridge", () => {
  it("always returns an LspBridge (never throws)", () => {
    let bridge: LspBridge | undefined;
    expect(() => {
      bridge = createLspBridge("/tmp/fake-project");
    }).not.toThrow();
    expect(bridge).toBeDefined();
  });

  it("returned bridge supports all interface methods", async () => {
    const bridge = createLspBridge("/tmp/test");
    expect(typeof bridge.isAvailable).toBe("function");
    expect(typeof bridge.resolveDefinitions).toBe("function");
    expect(typeof bridge.getReferences).toBe("function");
    expect(typeof bridge.getStats).toBe("function");
    expect(typeof bridge.shutdown).toBe("function");
  });

  it("resolveDefinitions never rejects regardless of project root", async () => {
    const bridge = createLspBridge("/does/not/exist");
    await expect(bridge.resolveDefinitions(["foo"])).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// detectAvailableLspServers
// ---------------------------------------------------------------------------

describe("detectAvailableLspServers", () => {
  it("returns an array (possibly empty) without throwing", () => {
    let servers: DetectedLspServer[] | undefined;
    expect(() => {
      servers = detectAvailableLspServers();
    }).not.toThrow();
    expect(Array.isArray(servers)).toBe(true);
  });

  it("detected servers have language and binary fields", () => {
    const servers = detectAvailableLspServers();
    for (const s of servers) {
      expect(typeof s.language).toBe("string");
      expect(typeof s.binary).toBe("string");
      expect(s.language.length).toBeGreaterThan(0);
      expect(s.binary.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// formatLspStatus
// ---------------------------------------------------------------------------

describe("formatLspStatus", () => {
  it("mentions unavailable for NullLspBridge", () => {
    const bridge = new NullLspBridge();
    const lines = formatLspStatus(bridge);
    expect(lines.join("\n")).toContain("unavailable");
  });

  it("does not claim the bridge is active when it only has detected servers", () => {
    const bridge = new ActiveLspBridge([{ language: "go", binary: "gopls" }]);
    const lines = formatLspStatus(bridge);
    expect(lines.join("\n")).toContain("detected");
    expect(lines.join("\n")).toContain("fallback-only");
  });

  it("includes hit rate stats for ActiveLspBridge", async () => {
    const bridge = new ActiveLspBridge([{ language: "rust", binary: "rust-analyzer" }]);
    await bridge.resolveDefinitions(["sym1"]);
    const lines = formatLspStatus(bridge);
    const text = lines.join("\n");
    expect(text).toContain("LSP hits");
    expect(text).toContain("Fallbacks");
  });
});
