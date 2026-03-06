import { describe, expect, it } from "vitest";
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
});
