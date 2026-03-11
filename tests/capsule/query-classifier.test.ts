import { describe, it, expect } from "vitest";
import {
  classifyQuery,
  applyNegativeFilters,
  getStrategy,
  type QueryIntent,
} from "../../src/capsule/query-classifier.js";

describe("classifyQuery — intent classification", () => {
  it("classifies single camelCase token as symbol_lookup", () => {
    const result = classifyQuery("generateCapsule");
    expect(result.intent).toBe("symbol_lookup");
  });

  it("classifies single PascalCase token as symbol_lookup", () => {
    const result = classifyQuery("ObservationStore");
    expect(result.intent).toBe("symbol_lookup");
  });

  it("classifies bare identifier as symbol_lookup", () => {
    expect(classifyQuery("parseFile").intent).toBe("symbol_lookup");
  });

  it("classifies flow trace queries", () => {
    expect(classifyQuery("trace the capsule generation pipeline").intent).toBe("flow_trace");
    expect(classifyQuery("how does auth token flow propagate").intent).toBe("flow_trace");
    expect(classifyQuery("call chain from handleRequest").intent).toBe("flow_trace");
  });

  it("classifies architectural queries", () => {
    expect(classifyQuery("system architecture for auth module").intent).toBe("architectural");
    expect(classifyQuery("module boundaries and dependency coupling").intent).toBe("architectural");
    expect(classifyQuery("overall system design and topology").intent).toBe("architectural");
  });

  it("classifies implementation queries", () => {
    expect(classifyQuery("implement rate limiting middleware").intent).toBe("implementation");
    expect(classifyQuery("add error handling to auth service").intent).toBe("implementation");
    expect(classifyQuery("refactor the database query layer").intent).toBe("implementation");
  });

  it("classifies short conceptual queries", () => {
    expect(classifyQuery("what is capsule").intent).toBe("conceptual");
    expect(classifyQuery("explain BFS traversal").intent).toBe("conceptual");
  });

  it("classifies broad queries for long multi-term natural language", () => {
    const result = classifyQuery("capsule generation scoring compression formatting");
    expect(result.intent).toBe("broad");
  });
});

describe("classifyQuery — normalizedTerms", () => {
  it("strips stop words and deduplicates", () => {
    const result = classifyQuery("the capsule and the pipeline");
    expect(result.normalizedTerms).not.toContain("the");
    expect(result.normalizedTerms).not.toContain("and");
    expect(result.normalizedTerms).toContain("capsule");
    expect(result.normalizedTerms).toContain("pipeline");
  });

  it("strips question words from normalizedTerms", () => {
    const result = classifyQuery("how does authentication work");
    expect(result.normalizedTerms).not.toContain("how");
    expect(result.normalizedTerms).not.toContain("does");
  });
});

describe("classifyQuery — focusTerms", () => {
  it("selects signal tokens (long or cased) as focus terms", () => {
    const result = classifyQuery("implement authentication middleware session");
    // "authentication", "middleware", "session" are all 8+ chars → signal tokens
    expect(result.focusTerms.length).toBeGreaterThan(0);
    expect(result.focusTerms).toContain("authentication");
  });
});

describe("classifyQuery — code pattern detection", () => {
  it("detects error_handling pattern", () => {
    const result = classifyQuery("error handling and exception recovery");
    expect(result.codePatterns).toContain("error_handling");
  });

  it("detects auth pattern", () => {
    const result = classifyQuery("authentication token session jwt flow");
    expect(result.codePatterns).toContain("auth");
  });

  it("detects rate_limiting pattern", () => {
    const result = classifyQuery("throttle and rate limit backoff");
    expect(result.codePatterns).toContain("rate_limiting");
  });

  it("detects caching pattern", () => {
    const result = classifyQuery("cache invalidation ttl evict strategy");
    expect(result.codePatterns).toContain("caching");
  });

  it("detects middleware pattern", () => {
    const result = classifyQuery("middleware guard interceptor chain");
    expect(result.codePatterns).toContain("middleware");
  });

  it("detects validation pattern", () => {
    const result = classifyQuery("validate schema and sanitize input");
    expect(result.codePatterns).toContain("validation");
  });

  it("detects multiple patterns simultaneously", () => {
    const result = classifyQuery("auth middleware validation error handling");
    expect(result.codePatterns).toContain("auth");
    expect(result.codePatterns).toContain("middleware");
    expect(result.codePatterns).toContain("validation");
    expect(result.codePatterns).toContain("error_handling");
  });

  it("returns empty patterns for generic queries", () => {
    const result = classifyQuery("generateCapsule");
    expect(result.codePatterns).toHaveLength(0);
  });
});

describe("classifyQuery — negative patterns", () => {
  it("generates negative patterns for error_handling to exclude click handlers", () => {
    const result = classifyQuery("error handling");
    const excluded = ["handleTimestampClick", "handleMouseClick", "onClick", "onPress"];
    for (const name of excluded) {
      const filtered = applyNegativeFilters([name], result.negativePatterns);
      expect(filtered).toHaveLength(0);
    }
  });

  it("does NOT exclude relevant names", () => {
    const result = classifyQuery("error handling");
    const kept = ["handleError", "catchException", "errorMiddleware"];
    const filtered = applyNegativeFilters(kept, result.negativePatterns);
    expect(filtered).toEqual(kept);
  });

  it("passes all names through when no patterns active", () => {
    const result = classifyQuery("capsule generation");
    const names = ["generateCapsule", "packResult", "formatOutput"];
    expect(applyNegativeFilters(names, result.negativePatterns)).toEqual(names);
  });
});

describe("applyNegativeFilters", () => {
  it("removes names matching any pattern", () => {
    const patterns = [/onClick/i, /onPress/i];
    const result = applyNegativeFilters(
      ["handleError", "onClick", "onPressSubmit", "parseFile"],
      patterns
    );
    expect(result).toEqual(["handleError", "parseFile"]);
  });

  it("returns original list when patterns is empty", () => {
    const names = ["a", "b", "c"];
    expect(applyNegativeFilters(names, [])).toEqual(names);
  });
});

describe("getStrategy — retrieval weights per intent", () => {
  const intents: QueryIntent[] = [
    "symbol_lookup", "flow_trace", "architectural",
    "conceptual", "implementation", "broad",
  ];

  for (const intent of intents) {
    it(`returns a valid strategy for ${intent}`, () => {
      const strategy = getStrategy(intent);
      expect(strategy.intent).toBe(intent);
      expect(strategy.centralityWeight).toBeGreaterThanOrEqual(0);
      expect(strategy.textMatchWeight).toBeGreaterThanOrEqual(0);
      expect(strategy.callChainWeight).toBeGreaterThanOrEqual(0);
      expect(strategy.maxBfsDepth).toBeGreaterThanOrEqual(1);
      expect(strategy.budgetMultiplier).toBeGreaterThan(0);
    });
  }

  it("symbol_lookup has highest textMatchWeight among concrete intents", () => {
    const sym = getStrategy("symbol_lookup");
    const flow = getStrategy("flow_trace");
    expect(sym.textMatchWeight).toBeGreaterThan(flow.textMatchWeight);
  });

  it("flow_trace has highest callChainWeight", () => {
    const flow = getStrategy("flow_trace");
    const arch = getStrategy("architectural");
    expect(flow.callChainWeight).toBeGreaterThan(arch.callChainWeight);
  });

  it("architectural has highest centralityWeight", () => {
    const arch = getStrategy("architectural");
    const impl = getStrategy("implementation");
    expect(arch.centralityWeight).toBeGreaterThan(impl.centralityWeight);
  });

  it("broad has largest budgetMultiplier", () => {
    const broad = getStrategy("broad");
    const lookup = getStrategy("symbol_lookup");
    expect(broad.budgetMultiplier).toBeGreaterThan(lookup.budgetMultiplier);
  });

  it("symbol_lookup does not apply negative patterns", () => {
    expect(getStrategy("symbol_lookup").applyNegativePatterns).toBe(false);
  });

  it("architectural expands synonyms", () => {
    expect(getStrategy("architectural").expandSynonyms).toBe(true);
  });

  it("symbol_lookup does not expand synonyms", () => {
    expect(getStrategy("symbol_lookup").expandSynonyms).toBe(false);
  });
});
