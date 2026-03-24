import type Database from "better-sqlite3";
import type { CapsuleOutput, EmbeddingRuntime } from "../core/types.js";
import { classifyQueryIntent } from "./intent-classifier.js";
import { hybridSearch } from "../core/hybrid-ranker.js";
import { isNaturalLanguageQuery, expandToHypothetical } from "./hyde.js";
import { createLogger } from "../utils/logger.js";
import { createCapsuleContext, type CapsuleParams } from "./pipeline/types.js";
import { computeTermIDF, resolvePivots } from "./pipeline/pivot-resolver.js";
import { expandGraph } from "./pipeline/graph-expander.js";
import { scoreCandidates } from "./pipeline/candidate-scorer.js";
import { fillBudgetAndFinalize } from "./pipeline/budget-filler.js";

const logger = createLogger("generator");

export { computeCoverageConfidence } from "./pipeline/budget-filler.js";
export { computeTermIDF } from "./pipeline/pivot-resolver.js";

export function generateCapsule(db: Database.Database, params: CapsuleParams): CapsuleOutput {
  const context = createCapsuleContext(db, params);
  const pivotState = resolvePivots(context);
  const graphState = expandGraph(context, pivotState);
  const scoringState = scoreCandidates(context, pivotState, graphState);
  return fillBudgetAndFinalize(context, pivotState, graphState, scoringState);
}

export async function generateCapsuleWithRuntime(
  db: Database.Database,
  params: CapsuleParams,
  embeddingRuntime: EmbeddingRuntime | null | undefined
): Promise<CapsuleOutput> {
  if (!embeddingRuntime) {
    return generateCapsule(db, params);
  }

  try {
    const classified = classifyQueryIntent(params.query);
    const queryTerms =
      classified.focusTerms.length > 0
        ? classified.focusTerms
        : classified.normalizedTerms.length > 0
          ? classified.normalizedTerms
          : params.query.split(/\s+/).filter((term) => term.length > 1);
    const hydeText = isNaturalLanguageQuery(params.query)
      ? expandToHypothetical(params.query)
      : params.query;
    const queryEmbedding = await embeddingRuntime.embedder.embed(hydeText);
    const hybridSearchResults = await hybridSearch(db, embeddingRuntime, {
      query: params.query,
      queryTerms,
      idfWeights: computeTermIDF(db, queryTerms),
      queryEmbedding,
      projectRoot: params.projectRoot,
      pathRestriction: params.path,
      glob: params.glob,
      limit: 36,
    });

    if (embeddingRuntime.reranker && hybridSearchResults.length > 5) {
      try {
        const documents = hybridSearchResults.map((result) => `${result.scopeChain.join(".")} ${result.kind} ${result.filePath}:${result.startLine}`);
        const reranked = await embeddingRuntime.reranker.rerank(params.query, documents);
        const rerankedResults = reranked.map((entry) => hybridSearchResults[entry.index]!);
        const rerankedSet = new Set(reranked.map((entry) => entry.index));
        for (let index = 0; index < hybridSearchResults.length; index++) {
          if (!rerankedSet.has(index)) rerankedResults.push(hybridSearchResults[index]!);
        }
        hybridSearchResults.length = 0;
        hybridSearchResults.push(...rerankedResults);
      } catch (error) {
        logger.debug("cross-encoder reranking skipped", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return generateCapsule(db, { ...params, hybridSearchResults });
  } catch (error) {
    logger.warn("hybrid runtime unavailable during capsule generation; falling back to lexical retrieval", {
      error: error instanceof Error ? error.message : String(error),
    });
    return generateCapsule(db, params);
  }
}
