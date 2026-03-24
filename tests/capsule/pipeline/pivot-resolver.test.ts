import { describe, expect, it } from "vitest";
import { resolvePivots } from "../../../src/capsule/pipeline/pivot-resolver.js";
import { usePipelineFixture } from "./test-helpers.js";

const fixture = usePipelineFixture();

describe("resolvePivots", () => {
  it("builds ranked pivots from a CapsuleContext fixture", () => {
    const context = fixture.createContext("generateCapsule", { tokenBudget: 4000 });
    const pivotState = resolvePivots(context);

    expect(pivotState.intent).toBe("symbol-lookup");
    expect(pivotState.rawPivotIds.size).toBeGreaterThan(0);
    expect(pivotState.pivotSymbolIds.size).toBeGreaterThan(0);
    expect(pivotState.rankedPivots.size).toBeGreaterThan(0);
    expect([...pivotState.pivotCandidates].some((candidate) => candidate.name === "generateCapsule")).toBe(true);
    expect(pivotState.exactPivotIds.size).toBeGreaterThan(0);
  });
});
