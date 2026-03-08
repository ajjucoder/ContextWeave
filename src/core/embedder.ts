import { env, pipeline } from "@huggingface/transformers";

export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_EMBEDDING_DTYPE = "q8";
export const DEFAULT_EMBEDDING_DEVICE = "auto";
export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;

interface ExtractorTensor {
  data: ArrayLike<number> | ArrayLike<bigint>;
  dims: number[];
}

interface EmbeddingExtractor {
  (input: string | string[], options: { pooling: "mean"; normalize: true }): Promise<ExtractorTensor>;
  dispose?: () => Promise<void>;
}

export interface EmbedderOptions {
  modelName?: string;
  dimensions?: number;
  dtype?: "q8" | "auto" | "fp32" | "fp16" | "int8" | "uint8" | "q4" | "bnb4" | "q4f16";
  batchSize?: number;
  device?:
    | "auto"
    | "gpu"
    | "cpu"
    | "wasm"
    | "webgpu"
    | "cuda"
    | "dml"
    | "webnn"
    | "webnn-npu"
    | "webnn-gpu"
    | "webnn-cpu";
  cacheDir?: string;
  localFilesOnly?: boolean;
  pipelineFactory?: (
    task: "feature-extraction",
    modelName: string,
    options: Record<string, unknown>
  ) => Promise<EmbeddingExtractor>;
}

interface ResolvedEmbedderOptions {
  modelName: string;
  dimensions: number;
  dtype: NonNullable<EmbedderOptions["dtype"]>;
  batchSize: number;
  device: NonNullable<EmbedderOptions["device"]>;
  cacheDir?: string;
  localFilesOnly?: boolean;
}

function resolveOptions(options: EmbedderOptions = {}): ResolvedEmbedderOptions {
  return {
    modelName: options.modelName ?? DEFAULT_EMBEDDING_MODEL,
    dimensions: options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
    dtype: options.dtype ?? DEFAULT_EMBEDDING_DTYPE,
    batchSize: Math.max(1, options.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE),
    device: options.device ?? DEFAULT_EMBEDDING_DEVICE,
    cacheDir: options.cacheDir,
    localFilesOnly: options.localFilesOnly,
  };
}

function cloneVector(values: ArrayLike<number> | ArrayLike<bigint>, start: number, end: number): Float32Array {
  if (values instanceof Float32Array) {
    return values.slice(start, end);
  }
  const vector = new Float32Array(end - start);
  for (let index = start; index < end; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw new Error("Extractor returned an incomplete embedding tensor");
    }
    if (typeof value === "bigint") {
      throw new Error("Expected numeric embedding output, received bigint tensor values");
    }
    vector[index - start] = value;
  }
  return vector;
}

export class LocalEmbedder {
  private constructor(
    private readonly extractor: EmbeddingExtractor,
    private readonly options: ResolvedEmbedderOptions
  ) {}

  static async create(options: EmbedderOptions = {}): Promise<LocalEmbedder> {
    const resolved = resolveOptions(options);
    const pipelineFactory = options.pipelineFactory ?? pipeline;

    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    if (resolved.cacheDir) {
      env.cacheDir = resolved.cacheDir;
    }

    const extractor = await pipelineFactory(
      "feature-extraction",
      resolved.modelName,
      {
        dtype: resolved.dtype,
        device: resolved.device,
        local_files_only: resolved.localFilesOnly,
      }
    ) as unknown as EmbeddingExtractor;

    return new LocalEmbedder(extractor, resolved);
  }

  async embed(text: string): Promise<Float32Array> {
    const tensor = await this.extractor(text, { pooling: "mean", normalize: true });
    return this.extractRows(tensor, 1)[0]!;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const output: Float32Array[] = [];
    for (let index = 0; index < texts.length; index += this.options.batchSize) {
      const batch = texts.slice(index, index + this.options.batchSize);
      const tensor = await this.extractor(batch, { pooling: "mean", normalize: true });
      output.push(...this.extractRows(tensor, batch.length));
    }
    return output;
  }

  async dispose(): Promise<void> {
    await this.extractor.dispose?.();
  }

  private extractRows(tensor: ExtractorTensor, expectedRows: number): Float32Array[] {
    const dims = Array.isArray(tensor.dims) ? tensor.dims : [];
    const rank = dims.length;
    const columns = rank === 1 ? dims[0] : dims[rank - 1];
    const rows = rank <= 1 ? 1 : dims[0];

    if (!Number.isInteger(columns) || columns !== this.options.dimensions) {
      throw new Error(
        `Expected ${this.options.dimensions}-dimensional embeddings, received ${String(columns)}`
      );
    }
    if (!Number.isInteger(rows) || rows !== expectedRows) {
      throw new Error(`Expected ${expectedRows} embedding row(s), received ${String(rows)}`);
    }

    const totalValues = rows * columns;
    if (tensor.data.length !== totalValues) {
      throw new Error(`Expected ${totalValues} embedding values, received ${tensor.data.length}`);
    }

    const vectors: Float32Array[] = [];
    for (let row = 0; row < rows; row += 1) {
      const start = row * columns;
      vectors.push(cloneVector(tensor.data, start, start + columns));
    }
    return vectors;
  }
}
