import { describe, expect, it } from "vitest";
import { resolvePivots } from "../../../src/capsule/pipeline/pivot-resolver.js";
import { expandGraph } from "../../../src/capsule/pipeline/graph-expander.js";
import { scoreCandidates } from "../../../src/capsule/pipeline/candidate-scorer.js";
import { fillBudgetAndFinalize } from "../../../src/capsule/pipeline/budget-filler.js";
import {
  DEEP_EXPAND_THRESHOLD,
  MULTI_PASS_FILL_THRESHOLD,
  POOL_EXTRAS_THRESHOLD,
} from "../../../src/capsule/generator.js";
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
    const result = fillBudgetAndFinalize(context, pivots, graphState, scoring, {
      multiPassFillThreshold: MULTI_PASS_FILL_THRESHOLD,
      deepExpandThreshold: DEEP_EXPAND_THRESHOLD,
      poolExtrasThreshold: POOL_EXTRAS_THRESHOLD,
    });

    expect(result.content).toContain("Strategy:");
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBe(pivots.rawPivotIds.size);
    expect(result.metadata.quality.retrieval.stageBSelectedCount).toBe(scoring.selected.length);
  });

  it("adds top git commits to capsule observations for temporal queries", () => {
    fixture.db.prepare("DELETE FROM git_commit_files").run();
    fixture.db.prepare("DELETE FROM git_commits").run();
    fixture.db.prepare(`
      INSERT INTO git_commits (hash, author, timestamp, message, summary, files_changed)
      VALUES
        ('aaa1111', 'Ada', 1704067200000, 'fix(auth): patch session invalidation', '[fix] Changed invalidateSession in src/memory/search.ts — fix(auth): patch session invalidation', '["src/memory/search.ts"]'),
        ('bbb2222', 'Bea', 1704153600000, 'feat(auth): introduce login tracing', '[feat] Changed search in src/memory/observations.ts — feat(auth): introduce login tracing', '["src/memory/observations.ts"]'),
        ('ccc3333', 'Cy', 1704240000000, 'refactor(auth): simplify remember flow', '[refactor] Changed create in src/mcp/tools/remember.ts — refactor(auth): simplify remember flow', '["src/mcp/tools/remember.ts"]'),
        ('ddd4444', 'Dee', 1704326400000, 'fix(payments): retry charge failures', '[fix] Changed chargeCard in src/core/indexer.ts — fix(payments): retry charge failures', '["src/core/indexer.ts"]')
    `).run();

    const context = fixture.createContext("why was auth changed", {
      tokenBudget: 5000,
      mode: "feature",
    });
    const pivots = resolvePivots(context);
    const graphState = expandGraph(context, pivots);
    const scoring = scoreCandidates(context, pivots, graphState);
    const result = fillBudgetAndFinalize(context, pivots, graphState, scoring, {
      multiPassFillThreshold: MULTI_PASS_FILL_THRESHOLD,
      deepExpandThreshold: DEEP_EXPAND_THRESHOLD,
      poolExtrasThreshold: POOL_EXTRAS_THRESHOLD,
    });

    expect(pivots.observations.filter((observation) => observation.scope === "history")).toHaveLength(3);
    expect(result.content).toContain("Commit bbb2222");
    expect(result.content).toContain("Commit aaa1111");
    expect(result.structured?.observations.some((observation) => observation.includes("[history] Commit bbb2222"))).toBe(true);
  });
});
