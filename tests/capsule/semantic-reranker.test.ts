import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { applySemanticRerank, type SemanticRerankItem } from "../../src/capsule/semantic-reranker.js";

interface CandidateShape {
  label: string;
}

function candidate(
  id: number,
  label: string,
  baseScore: number,
  options: Partial<Omit<SemanticRerankItem<CandidateShape>, "item" | "id" | "baseScore">> = {}
): SemanticRerankItem<CandidateShape> {
  return {
    item: { label },
    id,
    name: options.name ?? label,
    signature: options.signature ?? "",
    filePath: options.filePath ?? `src/${label}.ts`,
    docComment: options.docComment ?? null,
    baseScore,
    isPivot: options.isPivot ?? false,
  };
}

describe("semantic reranker", () => {
  it("improves semantic recall within the local rerank window", () => {
    const ranked = applySemanticRerank(
      [
        candidate(1, "PartnerHeroCard", 1.01, { filePath: "src/components/PartnerHeroCard.tsx" }),
        candidate(2, "districtApprovalRules", 1.0, {
          filePath: "config/program-rules.yaml",
          docComment: "Eligibility approval policy for partner districts",
        }),
      ],
      {
        queryTerms: ["eligibility", "policy"],
        expandedTerms: ["eligibility", "policy"],
      }
    );

    expect(ranked.applied).toBe(true);
    expect(ranked.ranked[0]?.item.label).toBe("districtApprovalRules");
  });

  it("does not move pivots during semantic reranking", () => {
    const ranked = applySemanticRerank(
      [
        candidate(1, "submitInquiry", 3, { isPivot: true, filePath: "src/lib/client/submitInquiry.ts" }),
        candidate(2, "InquiryHeroCard", 1.2, { filePath: "src/components/InquiryHeroCard.tsx" }),
        candidate(3, "createInquiry", 1.1, {
          filePath: "src/lib/server/createInquiry.ts",
          docComment: "Creates and persists a new inquiry record",
        }),
      ],
      {
        queryTerms: ["lead", "capture", "lifecycle"],
        expandedTerms: ["lead", "capture", "lifecycle"],
      }
    );

    expect(ranked.ranked[0]?.item.label).toBe("submitInquiry");
  });

  it("does not let candidates jump across rerank windows", () => {
    const ranked = applySemanticRerank(
      [
        candidate(1, "alpha0", 10),
        candidate(2, "alpha1", 9.8),
        candidate(3, "alpha2", 9.6),
        candidate(4, "alpha3", 9.4),
        candidate(5, "alpha4", 9.2),
        candidate(6, "alpha5", 9),
        candidate(7, "alpha6", 8.8),
        candidate(8, "alpha7", 8.6),
        candidate(9, "semanticWinner", 7.5, {
          filePath: "config/program-rules.yaml",
          docComment: "Eligibility approval policy for partner districts",
        }),
      ],
      {
        queryTerms: ["eligibility", "policy"],
        expandedTerms: ["eligibility", "policy"],
        windowSize: 8,
      }
    );

    expect(ranked.ranked[0]?.item.label).toBe("alpha0");
    expect(ranked.ranked[8]?.item.label).toBe("semanticWinner");
  });

  it("keeps semantic reranking deterministic across repeated runs", () => {
    const items = [
      candidate(1, "ordersRoute", 1.04, { filePath: "packages/api/src/routes/orders.ts" }),
      candidate(2, "enforceRetentionPolicy", 1.02, {
        filePath: "packages/shared/src/policy.ts",
        docComment: "Retention obligations and policy enforcement workflow",
      }),
      candidate(3, "retentionGuide", 1.01, {
        filePath: "docs/policies/data-retention.md",
        docComment: "Retention obligations and policy workflow",
      }),
    ];

    const first = applySemanticRerank(items, {
      queryTerms: ["retention", "obligations", "workflow"],
      expandedTerms: ["retention", "obligations", "workflow"],
    });
    const second = applySemanticRerank(items, {
      queryTerms: ["retention", "obligations", "workflow"],
      expandedTerms: ["retention", "obligations", "workflow"],
    });

    expect(first.ranked.map((entry) => entry.id)).toEqual(second.ranked.map((entry) => entry.id));
  });

  it("improves a conceptual policy prompt over a noisy UI-first match", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-semantic-rerank-"));
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);

    try {
      mkdirSync(join(root, "src", "ui"), { recursive: true });
      mkdirSync(join(root, "src", "core"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(
        join(root, "src", "ui", "RetentionWorkflowPanel.tsx"),
        `export function RetentionWorkflowPanel() {
  return <div>retention obligations compliance workflow</div>;
}
`
      );
      writeFileSync(
        join(root, "src", "core", "rules-engine.ts"),
        `/** governance obligations compliance policy engine */
export function runRulesEngine() {
  return enforceRetentionPolicy();
}

export function enforceRetentionPolicy() {
  return "ok";
}
`
      );
      writeFileSync(
        join(root, "docs", "retention-obligations.md"),
        "Retention obligations compliance workflow guide. Runtime enforcement happens in the rules engine."
      );

      await indexProject(db, root);
      updateCentralityScores(db);

      const off = generateCapsule(db, {
        query: "retention obligations compliance workflow",
        tokenBudget: 120,
        projectRoot: root,
        sessionId: "semantic-off",
      });
      const on = generateCapsule(db, {
        query: "retention obligations compliance workflow",
        tokenBudget: 120,
        projectRoot: root,
        sessionId: "semantic-on",
        semanticRerank: true,
      });

      const expected = [
        "src/core/rules-engine.ts",
        "docs/retention-obligations.md",
      ];
      const offHits = expected.filter((fragment) => off.content.includes(fragment)).length;
      const onHits = expected.filter((fragment) => on.content.includes(fragment)).length;

      expect(onHits).toBeGreaterThanOrEqual(offHits);
      expect(off.content).toContain("src/ui/RetentionWorkflowPanel.tsx");
      expect(on.content).not.toContain("src/ui/RetentionWorkflowPanel.tsx");
      expect(on.content).toContain("docs/retention-obligations.md");
      expect(on.metadata.strategy?.semanticRerank?.enabled).toBe(true);
      expect(on.metadata.strategy?.semanticRerank?.applied).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
