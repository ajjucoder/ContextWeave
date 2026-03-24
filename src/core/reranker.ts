import { env, pipeline } from "@xenova/transformers";
import { createLogger } from "../utils/logger.js";

const log = createLogger("reranker");

export const DEFAULT_RERANKER_MODEL = "none";
export const DEFAULT_RERANKER_ALPHA = 0.4;
export const DEFAULT_RERANKER_MAX_CANDIDATES = 80;

interface ClassificationOutput {
  label: string;
  score: number;
}

type TextClassificationInput = { text: string; text_pair: string };

type TextClassificationPipeline = (
  input: TextClassificationInput | TextClassificationInput[],
  options?: { topk?: number }
) => Promise<ClassificationOutput | ClassificationOutput[] | ClassificationOutput[][]>;

export interface DisabledRerankerModelSpec {
  configuredName: string;
  kind: "disabled";
}

export interface LocalRerankerModelSpec {
  configuredName: string;
  kind: "local";
  huggingFaceModelId: string;
  maxCandidates: number;
  alpha: number;
}

export type RerankerModelSpec = DisabledRerankerModelSpec | LocalRerankerModelSpec;

export interface RerankerOptions {
  modelName?: string;
  cacheDir?: string;
  maxCandidates?: number;
  alpha?: number;
  pipelineFactory?: (
    task: "text-classification",
    modelName: string,
    options: Record<string, unknown>
  ) => Promise<unknown>;
}

export interface RerankResult {
  index: number;
  score: number;
}

const LOCAL_MODEL_SPECS: Record<string, Pick<LocalRerankerModelSpec, "huggingFaceModelId">> = {
  "local:bge-reranker-base": {
    huggingFaceModelId: "Xenova/bge-reranker-base",
  },
};

export function resolveRerankerModel(modelName?: string | null): RerankerModelSpec {
  const configuredName = modelName?.trim() || DEFAULT_RERANKER_MODEL;
  if (configuredName === "none") {
    return {
      configuredName,
      kind: "disabled",
    };
  }

  const local = LOCAL_MODEL_SPECS[configuredName];
  if (local) {
    return {
      configuredName,
      kind: "local",
      huggingFaceModelId: local.huggingFaceModelId,
      maxCandidates: DEFAULT_RERANKER_MAX_CANDIDATES,
      alpha: DEFAULT_RERANKER_ALPHA,
    };
  }

  if (configuredName.startsWith("local:")) {
    return {
      configuredName,
      kind: "local",
      huggingFaceModelId: configuredName.slice("local:".length),
      maxCandidates: DEFAULT_RERANKER_MAX_CANDIDATES,
      alpha: DEFAULT_RERANKER_ALPHA,
    };
  }

  return {
    configuredName,
    kind: "disabled",
  };
}

export function blendRerankerScore(stageAScore: number, crossEncoderScore: number, alpha: number): number {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return clampedAlpha * stageAScore + (1 - clampedAlpha) * crossEncoderScore;
}

export class CrossEncoderReranker {
  private pipeline: TextClassificationPipeline | null = null;
  private loading: Promise<TextClassificationPipeline> | null = null;
  readonly modelName: string;
  readonly maxCandidates: number;
  readonly alpha: number;
  private readonly pipelineFactory: NonNullable<RerankerOptions["pipelineFactory"]>;

  constructor(options: RerankerOptions = {}) {
    this.modelName = options.modelName ?? "Xenova/bge-reranker-base";
    this.maxCandidates = Math.max(1, options.maxCandidates ?? DEFAULT_RERANKER_MAX_CANDIDATES);
    this.alpha = Math.max(0, Math.min(1, options.alpha ?? DEFAULT_RERANKER_ALPHA));
    this.pipelineFactory = options.pipelineFactory ?? pipeline;
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

      const pipe = await this.pipelineFactory("text-classification", this.modelName, {
        dtype: "q8",
        device: "cpu",
      }) as TextClassificationPipeline;

      log.info("cross-encoder model loaded", { ms: Date.now() - start, model: this.modelName });
      this.pipeline = pipe;
      return pipe;
    })();

    return this.loading;
  }

  async rerank(query: string, documents: string[]): Promise<RerankResult[]> {
    if (documents.length === 0) return [];

    const truncatedDocuments = documents.slice(0, this.maxCandidates);

    try {
      const pipe = await this.load();
      const start = Date.now();
      const inputs = truncatedDocuments.map((document) => ({
        text: query,
        text_pair: document.slice(0, 512),
      }));
      const batchSize = 8;
      const scored: RerankResult[] = [];

      for (let offset = 0; offset < inputs.length; offset += batchSize) {
        const batch = inputs.slice(offset, offset + batchSize);
        const output = await pipe(batch, { topk: 1 });
        const rows = Array.isArray(output)
          ? (output as Array<ClassificationOutput | ClassificationOutput[]>).map((entry) =>
              Array.isArray(entry) ? entry[0] : entry
            )
          : [output as ClassificationOutput];

        for (let index = 0; index < rows.length; index += 1) {
          scored.push({
            index: offset + index,
            score: rows[index]?.score ?? 0,
          });
        }
      }

      scored.sort((left, right) => right.score - left.score);
      log.info("reranking complete", {
        candidates: truncatedDocuments.length,
        ms: Date.now() - start,
        alpha: this.alpha,
        topScore: scored[0]?.score ?? 0,
      });
      return scored;
    } catch (error) {
      log.warn("reranking failed, returning original order", {
        error: error instanceof Error ? error.message : String(error),
        model: this.modelName,
      });
      return truncatedDocuments.map((_, index) => ({
        index,
        score: 1 - index / Math.max(1, truncatedDocuments.length),
      }));
    }
  }

  async dispose(): Promise<void> {
    this.pipeline = null;
    this.loading = null;
  }
}
