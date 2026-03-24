import { describe, expect, it } from "vitest";
import { resolvePivots } from "../../../src/capsule/pipeline/pivot-resolver.js";
import { expandGraph } from "../../../src/capsule/pipeline/graph-expander.js";
import { scoreCandidates } from "../../../src/capsule/pipeline/candidate-scorer.js";
import { fillBudgetAndFinalize } from "../../../src/capsule/pipeline/budget-filler.js";
import { usePipelineFixture } from "./test-helpers.js";

const fixture = usePipelineFixture();

describe("fillBudgetAndFinalize", () => {
  it("produces a capsule from stage outputs without re-entering generateCapsule", () => {
    const context = fixture.createContext("how does the capsule pipeline score candidates", {
      tokenBudget: 5000,
      mode: "feature",
    });
    const pivots = resolvePivots(context);
    const graphState = expandGraph(context, pivots);
    const scoring = scoreCandidates(context, pivots, graphState);
    const result = fillBudgetAndFinalize(context, pivots, graphState, scoring);

    expect(result.content).toContain("Strategy:");
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBe(pivots.rawPivotIds.size);
    expect(result.metadata.quality.retrieval.stageBSelectedCount).toBe(scoring.selected.length);
  });
});
