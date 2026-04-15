import { describe, expect, it } from "vitest";

import {
  PRODUCT_THRESHOLDS,
  buildCloneCommand,
  evaluateProductBench,
  type ProductBenchProjectSummary,
} from "../../bench/cross-project-qa";
import { DEFAULT_EVAL_THRESHOLDS } from "../eval/eval-runner";

function makeProject(project: string, successStates: boolean[]): ProductBenchProjectSummary {
  return {
    project,
    summaries: successStates.map((success) => ({
      success,
      firstPassSuccess: success,
      correction: false,
      tokensToSuccess: success ? 300 : 700,
      avgConfidence: success ? 0.4 : 0.32,
    })),
  };
}

describe("buildCloneCommand", () => {
  it("uses a full clone when a pinned commit must be checked out", () => {
    expect(buildCloneCommand("https://github.com/expressjs/express.git", "6c4249feec8ab40631817c8e7001baf2ed022224", "/tmp/express"))
      .toBe('git clone https://github.com/expressjs/express.git "/tmp/express"');
  });

  it("keeps shallow clones for head-only benchmark repos", () => {
    expect(buildCloneCommand("https://github.com/example/repo.git", undefined, "/tmp/repo"))
      .toBe('git clone --depth 1 https://github.com/example/repo.git "/tmp/repo"');
  });
});

describe("PRODUCT_THRESHOLDS", () => {
  it("keeps the product-bench confidence floor aligned with the eval gate", () => {
    expect(PRODUCT_THRESHOLDS.avgConfidenceMin).toBe(DEFAULT_EVAL_THRESHOLDS.confidenceMin);
  });
});

describe("evaluateProductBench", () => {
  it("fails when any benchmark project has zero successful tasks even if aggregate metrics pass", () => {
    const result = evaluateProductBench([
      makeProject("express", [true, true, true]),
      makeProject("fastify", [true, true]),
      makeProject("zod", [false]),
      makeProject("polyglot-monorepo", [true, true, true, true]),
    ], 4);

    expect(result.passed).toBe(false);
    expect(result.failures).toContain("project zod had zero successful tasks");
  });

  it("fails when not all configured benchmark projects ran", () => {
    const result = evaluateProductBench([
      makeProject("express", [true, true, true]),
      makeProject("fastify", [true, true]),
      makeProject("zod", [true]),
    ], 4);

    expect(result.passed).toBe(false);
    expect(result.failures).toContain("only 3/4 benchmark projects produced results");
  });
});
