/**
 * Shared pipeline context and result types for capsule generation stages.
 */
import type Database from "better-sqlite3";
import { createLogger } from "../../utils/logger.js";
import type {
  CapsuleMode,
  FileRecord,
  HybridSearchResult,
  LightSymbolRecord,
} from "../../core/types.js";
import type { ClassifiedQuery, QueryIntent } from "../intent-classifier.js";
import type { SubQuery } from "../query-decomposer.js";
import type { RetrievalLane } from "../../core/repo-profiler.js";
import type { SessionContext } from "../session-context.js";
import type { ObservationRecord } from "../../core/types.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { fileQueries } from "../../db/queries/files.js";
import { edgeQueries } from "../../db/queries/edges.js";

export interface CapsuleParams {
  query: string;
  tokenBudget?: number;
  mode?: CapsuleMode;
  sessionId?: string;
  projectRoot?: string;
  maxQueryTimeMs?: number;
  path?: string;
  glob?: string;
  hybridSearchResults?: HybridSearchResult[];
}

export interface RankedCandidate {
  symbol: LightSymbolRecord;
  file: FileRecord;
  score: number;
  distance: number;
  isPivot: boolean;
  lexicalScore: number;
  degree: number;
}

export interface PivotCandidate {
  id: number;
  name: string;
  signature: string;
  kind: string;
  filePath: string;
}

export interface CapsuleContext {
  db: Database.Database;
  params: CapsuleParams;
  query: string;
  tokenBudget: number;
  mode: CapsuleMode;
  maxQueryTimeMs: number;
  startTime: number;
  logger: ReturnType<typeof createLogger>;
  symbols: ReturnType<typeof symbolQueries>;
  files: ReturnType<typeof fileQueries>;
  edges: ReturnType<typeof edgeQueries>;
  getDirectCallerIds: Database.Statement<[number], { symbolId: number }>;
  getDirectCalleeIds: Database.Statement<[number], { symbolId: number }>;
  elapsed(): number;
  isOverBudget(fraction: number): boolean;
}

export interface PivotResolution {
  classified: ClassifiedQuery;
  intent: QueryIntent;
  retrievalBudget: number;
  activeLanes: RetrievalLane[];
  candidateFiles: Array<{ fileId: number; path: string }>;
  candidateFileBoostById: Map<number, number>;
  allQueryTerms: string[];
  exactQueryTerms: string[];
  expandedQueryTerms: string[];
  pivotQueryTerms: string[];
  exactQueryTermSet: Set<string>;
  idfWeights: Map<string, number>;
  observations: ObservationRecord[];
  rawPivotIds: Set<number>;
  pivotCandidates: PivotCandidate[];
  rankedPivots: Map<number, number>;
  pivotScores: number[];
  pivotSymbolIds: Set<number>;
  exactPivotIds: Set<number>;
  relevantPivotIds: Set<number>;
  topLocalityPivotIds: Set<number>;
  queryUiFocused: boolean;
  queryLooksTestFocused: boolean;
  explicitTypeQuery: boolean;
  suppressTypeDeclarations: boolean;
  symbolNotFound: boolean;
  sameNameDefinitions: PivotCandidate[];
  hasSameNameCollision: boolean;
  useMultiPass: boolean;
  subQueries: SubQuery[];
  impliedModuleDirs: Set<string>;
  preferRuntimeKinds: boolean;
  hybridStrategy: {
    enabled: boolean;
    applied: boolean;
    candidateCount: number;
    exactMatches: number;
  };
  sessionId: string | null;
  hasExplicitSession: boolean;
  sessionCtx: SessionContext | null;
  previousSameQueryTokens: number | null;
  recentFileIds: Set<number>;
}

export interface GraphExpansion {
  visited: Map<number, number>;
  candidates: RankedCandidate[];
  ranked: RankedCandidate[];
  batchDegrees: Map<number, number>;
  observationCountBySymbol: Map<number, number>;
  observationCountByFile: Map<number, number>;
  fileCache: Map<number, FileRecord | undefined>;
  pivotFileIds: Set<number>;
  pivotDirs: Set<string>;
  localityPivotDirs: Set<string>;
  rankingPivotDirs: Set<string>;
  centralityHubThreshold: number;
  degreeHubThreshold: number;
}

interface CachedEdgeStmts {
  getDirectCallerIds: Database.Statement<[number], { symbolId: number }>;
  getDirectCalleeIds: Database.Statement<[number], { symbolId: number }>;
}

const DEFAULT_TOKEN_BUDGET = 4000;
const DEFAULT_MAX_QUERY_TIME_MS = 500;
const edgeStmtCache = new WeakMap<Database.Database, CachedEdgeStmts>();
const obsHitStmtCache = new WeakMap<Database.Database, Database.Statement<[number, number]>>();

export function getEdgeStmts(db: Database.Database): CachedEdgeStmts {
  const cached = edgeStmtCache.get(db);
  if (cached) return cached;
  const stmts: CachedEdgeStmts = {
    getDirectCallerIds: db.prepare(
      `SELECT source_symbol_id as symbolId FROM edges WHERE target_symbol_id = ? AND kind IN ('call', 'import', 'callback') LIMIT 12`
    ),
    getDirectCalleeIds: db.prepare(
      `SELECT target_symbol_id as symbolId FROM edges WHERE source_symbol_id = ? AND kind IN ('call', 'import', 'callback') LIMIT 12`
    ),
  };
  edgeStmtCache.set(db, stmts);
  return stmts;
}

export function createCapsuleContext(db: Database.Database, params: CapsuleParams): CapsuleContext {
  const tokenBudget = params.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const mode = params.mode ?? "feature";
  const query = params.query;
  const maxQueryTimeMs = params.maxQueryTimeMs ?? DEFAULT_MAX_QUERY_TIME_MS;
  const startTime = Date.now();
  const directEdges = getEdgeStmts(db);

  return {
    db,
    params,
    query,
    tokenBudget,
    mode,
    maxQueryTimeMs,
    startTime,
    logger: createLogger("generator"),
    symbols: symbolQueries(db),
    files: fileQueries(db),
    edges: edgeQueries(db),
    getDirectCallerIds: directEdges.getDirectCallerIds,
    getDirectCalleeIds: directEdges.getDirectCalleeIds,
    elapsed() {
      return Date.now() - startTime;
    },
    isOverBudget(fraction) {
      return Date.now() - startTime > maxQueryTimeMs * fraction;
    },
  };
}

export function recordObservationHits(db: Database.Database, observationIds: number[]): void {
  if (observationIds.length === 0) return;
  let stmt = obsHitStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare<[number, number]>("UPDATE observations SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?");
    obsHitStmtCache.set(db, stmt);
  }
  const now = Date.now();
  const cachedStmt = stmt;
  db.transaction(() => {
    for (const id of observationIds) {
      cachedStmt.run(now, id);
    }
  })();
}
