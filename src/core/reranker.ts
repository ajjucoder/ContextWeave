import { env, pipeline } from "@huggingface/transformers";
import { createLogger } from "../utils/logger.js";

const log = createLogger("reranker");

export const DEFAULT_RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";

interface ClassificationOutput {
  label: string;
  score: number;
}

type TextClassificationPipeline = (
  input: { text: string; text_pair: string } | Array<{ text: string; text_pair: string }>,
  options?: { topk?: number }
) => Promise<ClassificationOutput | ClassificationOutput[] | ClassificationOutput[][]>;

export interface RerankerOptions {
  modelName?: string;
  cacheDir?: string;
  topK?: number;
}

export interface RerankResult {
  index: number;
  score: number;
}

export class CrossEncoderReranker {
  private pipeline: TextClassificationPipeline | null = null;
  private loading: Promise<TextClassificationPipeline> | null = null;
  private readonly modelName: string;
  private readonly topK: number;

  constructor(options: RerankerOptions = {}) {
    this.modelName = options.modelName ?? DEFAULT_RERANKER_MODEL;
    this.topK = options.topK ?? 20;
    if (options.cacheDir) {
      env.cacheDir = options.cacheDir;
    }
  }

  private async load(): Promise<TextClassificationPipeline> {
    if (this.pipeline) return this.pipeline;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      log.info("loading cross-encoder model", { model: this.modelName });
      const start = Date.now();

      const pipe = await pipeline("text-classification", this.modelName, {
        dtype: "q8",
        device: "cpu",
      });

      log.info("cross-encoder model loaded", { ms: Date.now() - start });
      this.pipeline = pipe as unknown as TextClassificationPipeline;
      return this.pipeline;
    })();

    return this.loading;
  }

  async rerank(
    query: string,
    documents: string[]
  ): Promise<RerankResult[]> {
    if (documents.length === 0) return [];

    try {
      const pipe = await this.load();
      const start = Date.now();

      const inputs = documents.map((doc) => ({
        text: query,
        text_pair: doc.slice(0, 512),
      }));

      const batchSize = 16;
      const allScores: RerankResult[] = [];

      for (let i = 0; i < inputs.length; i += batchSize) {
        const batch = inputs.slice(i, i + batchSize);
        const results = await pipe(batch, { topk: 1 });
        const flat = Array.isArray(results)
          ? (results as Array<ClassificationOutput | ClassificationOutput[]>).map((r) =>
            Array.isArray(r) ? r[0]! : r
          )
          : [results as ClassificationOutput];

        for (let j = 0; j < flat.length; j++) {
          allScores.push({
            index: i + j,
            score: flat[j]?.score ?? 0,
          });
        }
      }

      allScores.sort((a, b) => b.score - a.score);

      log.info("reranking complete", {
        candidates: documents.length,
        ms: Date.now() - start,
        topScore: allScores[0]?.score ?? 0,
      });

      return allScores.slice(0, this.topK);
    } catch (err) {
      log.warn("reranking failed, returning original order", {
        error: err instanceof Error ? err.message : String(err),
      });
      return documents.map((_, i) => ({ index: i, score: 1 - i * 0.01 }));
    }
  }

  async dispose(): Promise<void> {
    this.pipeline = null;
    this.loading = null;
  }
}
