import type { CapsuleDiagnostic } from "../capsule/diagnostics.js";
import type { QueryIntent } from "../capsule/intent-classifier.js";

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "enum"
  | "method"
  | "arrow";

export type EdgeKind =
  | "import"
  | "call"
  | "reference"
  | "type_usage"
  | "inheritance"
  | "implements";

export type CompressionLevel = 0 | 1 | 2 | 3;

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
}

export interface EdgeRecord {
  id: number;
  sourceSymbolId: number;
  targetSymbolId: number;
  kind: EdgeKind;
  createdAt: number;
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
}

export interface ParsedImport {
  names: string[];
  source: string;
  kind: "named" | "default" | "namespace";
}

export interface ParsedCall {
  callerSymbol: string;
  calleeName: string;
  line: number;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  errors: string[];
}

export interface ScoredNode {
  symbol: SymbolRecord;
  file: FileRecord;
  score: number;
  distance: number;
  compressionLevel: CompressionLevel;
  rendered: string;
  tokenCount: number;
}

export interface CapsuleOutput {
  content: string;
  metadata: CapsuleMetadata;
}

export type CapsuleUncertainty = "low" | "medium" | "high";

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

export interface CapsuleMetadata {
  query: string;
  mode: CapsuleMode;
  tokenBudget: number;
  tokensUsed: number;
  symbolCount: number;
  fileCount: number;
  compressionBreakdown: Record<CompressionLevel, number>;
  observationCount: number;
  quality: CapsuleQuality;
  diagnostics?: CapsuleDiagnostic;
  strategy?: {
    intent: QueryIntent;
    mode: "single-pass" | "multi-pass";
    subQueryCount: number;
  };
  clusterGroups?: Array<{
    id: number;
    symbolCount: number;
    fileCount: number;
  }>;
  generatedAt: number;
  timeLimited?: boolean;
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
