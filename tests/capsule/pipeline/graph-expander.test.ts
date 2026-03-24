import { describe, expect, it } from "vitest";
import { resolvePivots } from "../../../src/capsule/pipeline/pivot-resolver.js";
import { expandGraph } from "../../../src/capsule/pipeline/graph-expander.js";
import { usePipelineFixture } from "./test-helpers.js";

const fixture = usePipelineFixture();

describe("expandGraph", () => {
  it("expands pivot seeds into a scored candidate pool without running the full generator", () => {
    const context = fixture.createContext("capsule generation pipeline scoring compression", {
      tokenBudget: 5000,
    });
    const pivots = resolvePivots(context);
    const graphState = expandGraph(context, pivots);

    expect(graphState.visited.size).toBeGreaterThanOrEqual(pivots.pivotSymbolIds.size);
    expect(graphState.candidates.length).toBeGreaterThan(0);
    expect(graphState.ranked.length).toBeGreaterThan(0);
    expect(graphState.batchDegrees.size).toBeGreaterThan(0);
  });
});
