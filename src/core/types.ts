import type { CapsuleDiagnostic } from "../capsule/diagnostics.js";
import type { QueryIntent } from "../capsule/intent-classifier.js";

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "documentation"
  | "enum"
  | "method"
  | "arrow";

export type EdgeKind =
  | "import"
  | "call"
  | "dynamic_dispatch"
  | "reexport"
  | "reference"
  | "type_usage"
  | "inheritance"
  | "implements"
  | "jsx_render"
  | "framework_entry"
  | "callback"
  | "server-action"
  | "route-handler"
  | "event";

export type ParsedCallEdgeKind = Exclude<EdgeKind, "import" | "reexport" | "reference" | "event">;

export type CompressionLevel = 0 | 1 | 2 | 3;

export type SymbolVisibility = "public" | "private" | "protected" | "internal";

export type CapsuleMode = "debug" | "refactor" | "feature" | "review";

export interface FileRecord {
  id: number;
  path: string;
  hash: string;
  lastIndexed: number;
  mtime: number;
  language: string;
  symbolCount: number;
  error: string | null;
}

export interface SymbolRecord {
  id: number;
  fileId: number;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
  bodyHash: string;
  fullSource: string;
  isExported: boolean;
  docComment: string | null;
  centrality: number;
  lastSeen: number;
  parentSymbolId: number | null;
  qualifiedName: string | null;
  visibility?: SymbolVisibility;
}

export interface LightSymbolRecord {
  id: number;
  fileId: number;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
  bodyHash: string;
  isExported: boolean;
  docComment: string | null;
  centrality: number;
  lastSeen: number;
  parentSymbolId: number | null;
  qualifiedName: string | null;
  visibility?: SymbolVisibility;
}

export interface EdgeRecord {
  id: number;
  sourceSymbolId: number;
  targetSymbolId: number;
  kind: EdgeKind;
  createdAt: number;
}

export interface ChunkRecord {
  id: number;
  fileId: number;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
  text: string;
  contextualizedText: string;
  scopeChain: string[];
  importSources: string[];
  siblingNames: string[];
  entityNames: string[];
  tokenCount: number;
  contentHash: string;
  createdAt: number;
}

export interface PreparedChunk extends Omit<ChunkRecord, "id" | "fileId" | "createdAt"> {}

export interface VectorSearchResult {
  chunkId: number;
  fileId: number;
  filePath: string;
  startLine: number;
  endLine: number;
  distance: number;
  scopeChain: string[];
  entityNames: string[];
  tokenCount: number;
}

export interface HybridSearchResult {
  fileId: number;
  filePath: string;
  symbolIds: number[];
  chunkId: number;
  startLine: number;
  endLine: number;
  scopeChain: string[];
  kind: SymbolKind | "chunk";
  bm25Rank: number | null;
  vectorRank: number | null;
  exactMatchRank: number | null;
  rrfScore: number;
  recencyScore: number;
}

export interface VectorStoreStats {
  total: number;
  embedded: number;
  pending: number;
}

export interface ChunkEmbeddingEntry {
  chunkId: number;
  embedding: Float32Array;
  fileId?: number;
  startLine?: number;
  endLine?: number;
  textHash?: string;
  modelName?: string;
}

export interface EmbeddingRuntime {
  embedder: {
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    dispose?: () => Promise<void>;
  };
  vectorStore: {
    storeBatch(entries: ChunkEmbeddingEntry[]): void;
    search(queryEmbedding: Float32Array, limit?: number): VectorSearchResult[];
    searchWithFilter(queryEmbedding: Float32Array, pathFilter?: string, limit?: number): VectorSearchResult[];
  };
  reranker?: {
    maxCandidates: number;
    alpha: number;
    rerank(query: string, documents: string[]): Promise<Array<{ index: number; score: number }>>;
    dispose?: () => Promise<void>;
  };
  modelName?: string;
}

export interface SessionRecord {
  id: string;
  agentId: string;
  projectRoot: string;
  startedAt: number;
  endedAt: number | null;
}

export interface ObservationRecord {
  id: number;
  sessionId: string;
  agentId: string;
  symbolId: number | null;
  fileId: number | null;
  scope: string;
  note: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  stale: boolean;
  staleReason: string | null;
  archived: boolean;
}

export interface CapsuleLogRecord {
  id: number;
  sessionId: string;
  query: string;
  mode: CapsuleMode;
  tokenBudget: number;
  tokensUsed: number;
  symbolsIncluded: string[];
  filesIncluded: string[];
  timestamp: number;
  followedUp: boolean;
  missRatio: number | null;
  noiseRatio: number | null;
}

export interface ParsedDecorator {
  name: string;
  fullText: string;
  args?: string[];
}

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
  fullSource: string;
  bodyHash: string;
  isExported: boolean;
  docComment: string | null;
  parentName?: string;
  decorators?: ParsedDecorator[];
  visibility?: SymbolVisibility;
}

export interface ParsedImport {
  names: string[];
  source: string;
  kind: "named" | "default" | "namespace";
  isReExport?: boolean;
  exportAll?: boolean;
  specifiers?: Array<{
    localName: string;
    importedName: string;
  }>;
}

export interface ParsedCall {
  callerSymbol: string;
  calleeName: string;
  line: number;
  edgeKind?: ParsedCallEdgeKind;
  receiverName?: string;
}

export interface VariableTypeBinding {
  variableName: string;
  typeName: string;
  scope: string;
}

export interface ParsedFrameworkCall {
  callerSymbol: string;
  targetName: string;
  line: number;
  framework:
    | "next_fetch"
    | "express_route"
    | "convex_mutation"
    | "convex_query"
    | "convex_action"
    | "fastapi_route"
    | "django_url"
    | "flask_route"
    | "spring_mapping"
    | "aspnet_route"
    | "rails_route"
    | "gin_route"
    | "axum_route"
    | "laravel_route"
    | "celery_task"
    | "sidekiq_task"
    | "actix_route";
  httpMethod?: string;
  routePath?: string;
  convexModule?: string;
  convexExport?: string;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  frameworkCalls: ParsedFrameworkCall[];
  variableBindings: VariableTypeBinding[];
  errors: string[];
  timedOut?: boolean;
}

export interface ScoredNode {
  symbol: SymbolRecord;
  file: FileRecord;
  score: number;
  distance: number;
  compressionLevel: CompressionLevel;
  rendered: string;
  tokenCount: number;
  outgoingEdges?: { targetName: string; kind: string }[];
}

export interface StructuredCapsuleFile {
  path: string;
  relevance: number;
  reason: string;
  symbols: string[];
  startLine?: number;
  endLine?: number;
}

export interface StructuredCapsuleSuggestedRead {
  tool: "cw_read";
  args: { path: string; symbol: string };
  reason: string;
}

export interface StructuredCapsuleOutput {
  query: string;
  intent: QueryIntent;
  confidence: "high" | "medium" | "low";
  recommended_supplementary_reads: 2 | 5 | 10;
  discoveredSymbols: string[];
  uncertainty: string;
  tokenBudget: number;
  tokensUsed: number;
  tokenUtilization: number;
  files: StructuredCapsuleFile[];
  suggestedReads: StructuredCapsuleSuggestedRead[];
  observations: string[];
  text: string;
}

export interface CapsuleOutput {
  content: string;
  metadata: CapsuleMetadata;
  structured?: StructuredCapsuleOutput;
}

export type CapsuleUncertainty = "very_low" | "low" | "medium" | "high" | "critical";

export interface CapsuleQuality {
  pivotCount: number;
  pivotsIncluded: number;
  pivotCoverage: number;
  dependencyCoverage: number;
  coverageConfidence: number;
  noiseRatio: number;
  uncertaintyFlag: boolean;
  lowConfidence: boolean;
  uncertainty: CapsuleUncertainty;
  reasons: string[];
  retrieval: {
    stageACandidateCount: number;
    stageBSelectedCount: number;
  };
}

export interface PatternSignature {
  importShape: string[];
  exportShape: string[];
  hookUsage: string[];
  symbolKinds: string[];
  directoryPattern: string;
}

export interface CodePattern {
  id: string;
  name: string;
  description: string;
  files: string[];
  confidence: number;
  signature: PatternSignature;
}

export interface CapsuleMetadata {
  query: string;
  mode: CapsuleMode;
  tokenBudget: number;
  tokensUsed: number;
  symbolCount: number;
  fileCount: number;
  filesIncluded: string[];
  compressionBreakdown: Record<CompressionLevel, number>;
  observationCount: number;
  quality: CapsuleQuality;
  diagnostics?: CapsuleDiagnostic;
  strategy?: {
    intent: QueryIntent;
    mode: "single-pass" | "multi-pass";
    subQueryCount: number;
    hybridSearch?: {
      enabled: boolean;
      applied: boolean;
      candidateCount: number;
      exactMatches: number;
    };

  };
  clusterGroups?: Array<{
    id: number;
    symbolCount: number;
    fileCount: number;
  }>;
  patterns?: CodePattern[];
  layerCoverages?: Array<{
    layer: string;
    count: number;
    filled: number;
  }>;
  generatedAt: number;
  timeLimited?: boolean;
  symbolNotFound?: boolean;
  previouslyCovered?: string[];
}

export interface ModeWeights {
  distanceWeight: number;
  centralityWeight: number;
  recencyWeight: number;
  memoryWeight: number;
  exportBonus: number;
}

export interface IndexDiff {
  added: ParsedSymbol[];
  modified: Array<{ old: SymbolRecord; new: ParsedSymbol }>;
  deleted: SymbolRecord[];
  renamed: Array<{ old: SymbolRecord; new: ParsedSymbol }>;
  unchanged: SymbolRecord[];
}
