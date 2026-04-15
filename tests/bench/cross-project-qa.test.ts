import { describe, expect, it } from "vitest";

import { PRODUCT_THRESHOLDS, buildCloneCommand } from "../../bench/cross-project-qa";
import { DEFAULT_EVAL_THRESHOLDS } from "../eval/eval-runner";

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
