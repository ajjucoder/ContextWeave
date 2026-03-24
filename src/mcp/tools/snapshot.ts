import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { fileQueries } from "../../db/queries/files.js";
import { sessionQueries } from "../../db/queries/sessions.js";
import { countTokens } from "../../utils/tokens.js";
import { getRegisterTool } from "./register-helper.js";

const SNAPSHOT_TOKEN_BUDGET = 2048;
const MAX_ACTIVE_FILES = 10;
const MAX_OBSERVATIONS = 5;
const MAX_DECISIONS = 5;
const INITIAL_NOTE_LIMIT = 220;
const MIN_NOTE_LIMIT = 80;

interface SnapshotActiveFile {
  path: string;
  accessCount: number;
  lastAccessedAt: number;
}

interface SnapshotObservation {
  scope: string;
  note: string;
  confidence: number;
  updatedAt: number;
  filePath?: string;
}

interface SnapshotDecision {
  note: string;
  confidence: number;
  updatedAt: number;
  filePath?: string;
}

interface SnapshotSummary {
  sessionId: string;
  generatedAt: number;
  activeFiles: SnapshotActiveFile[];
  recentObservations: SnapshotObservation[];
  decisions: SnapshotDecision[];
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function renderSnapshot(snapshot: SnapshotSummary): string {
  return JSON.stringify(snapshot, null, 2);
}

function trimSnapshotToBudget(snapshot: SnapshotSummary): SnapshotSummary {
  const compact = {
    ...snapshot,
    activeFiles: snapshot.activeFiles.map((entry) => ({ ...entry })),
    recentObservations: snapshot.recentObservations.map((entry) => ({ ...entry })),
    decisions: snapshot.decisions.map((entry) => ({ ...entry })),
  };

  let noteLimit = INITIAL_NOTE_LIMIT;
  const applyNoteLimit = () => {
    compact.recentObservations = compact.recentObservations.map((entry) => ({
      ...entry,
      note: truncateText(entry.note, noteLimit),
    }));
    compact.decisions = compact.decisions.map((entry) => ({
      ...entry,
      note: truncateText(entry.note, noteLimit),
    }));
  };

  applyNoteLimit();

  while (countTokens(renderSnapshot(compact)) > SNAPSHOT_TOKEN_BUDGET) {
    if (noteLimit > MIN_NOTE_LIMIT) {
      noteLimit = Math.max(MIN_NOTE_LIMIT, noteLimit - 40);
      applyNoteLimit();
      continue;
    }

    if (compact.recentObservations.length > 1) {
      compact.recentObservations.pop();
      continue;
    }

    if (compact.decisions.length > 1) {
      compact.decisions.pop();
      continue;
    }

    if (compact.activeFiles.length > 1) {
      compact.activeFiles.pop();
      continue;
    }

    break;
  }

  return compact;
}

function resolveTargetSessionId(
  db: Database.Database,
  projectRoot: string,
  currentSessionId: string
): string {
  const currentHasActivity = db.prepare(`
    SELECT EXISTS(
      SELECT 1 FROM session_context WHERE session_id = ?
      UNION ALL
      SELECT 1 FROM observations WHERE session_id = ? AND archived = 0
      UNION ALL
      SELECT 1 FROM capsule_log WHERE session_id = ?
    ) AS has_activity
  `).get(currentSessionId, currentSessionId, currentSessionId) as { has_activity: number } | undefined;

  if ((currentHasActivity?.has_activity ?? 0) === 1) {
    return currentSessionId;
  }

  const latestForProject = db.prepare(`
    SELECT id
    FROM sessions
    WHERE project_root = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectRoot) as { id: string } | undefined;

  return latestForProject?.id ?? currentSessionId;
}

function loadActiveFiles(db: Database.Database, sessionId: string): SnapshotActiveFile[] {
  const files = fileQueries(db);
  const rows = db.prepare(`
    SELECT file_id, COUNT(*) AS access_count, MAX(returned_at) AS last_accessed_at
    FROM session_context
    WHERE session_id = ? AND file_id IS NOT NULL
    GROUP BY file_id
    ORDER BY last_accessed_at DESC, access_count DESC, file_id ASC
    LIMIT ?
  `).all(sessionId, MAX_ACTIVE_FILES) as Array<{
    file_id: number;
    access_count: number;
    last_accessed_at: number;
  }>;

  return rows.flatMap((row) => {
    const file = files.getById(row.file_id);
    if (!file) return [];
    return [{
      path: file.path,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
    }];
  });
}

function loadRecentObservations(db: Database.Database, sessionId: string): SnapshotObservation[] {
  const files = fileQueries(db);
  const rows = db.prepare(`
    SELECT scope, note, confidence, updated_at, file_id
    FROM observations
    WHERE session_id = ? AND archived = 0
    ORDER BY confidence DESC, updated_at DESC, id DESC
    LIMIT ?
  `).all(sessionId, MAX_OBSERVATIONS) as Array<{
    scope: string;
    note: string;
    confidence: number;
    updated_at: number;
    file_id: number | null;
  }>;

  return rows.map((row) => ({
    scope: row.scope,
    note: row.note,
    confidence: row.confidence,
    updatedAt: row.updated_at,
    filePath: row.file_id === null ? undefined : files.getById(row.file_id)?.path,
  }));
}

function loadDecisions(db: Database.Database, sessionId: string): SnapshotDecision[] {
  const files = fileQueries(db);
  const rows = db.prepare(`
    SELECT note, confidence, updated_at, file_id
    FROM observations
    WHERE session_id = ? AND archived = 0 AND scope = 'decision'
    ORDER BY updated_at DESC, confidence DESC, id DESC
    LIMIT ?
  `).all(sessionId, MAX_DECISIONS) as Array<{
    note: string;
    confidence: number;
    updated_at: number;
    file_id: number | null;
  }>;

  return rows.map((row) => ({
    note: row.note,
    confidence: row.confidence,
    updatedAt: row.updated_at,
    filePath: row.file_id === null ? undefined : files.getById(row.file_id)?.path,
  }));
}

/**
 * Registers a compact session snapshot tool for restoring recent working context.
 */
export function registerSnapshotTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  serverSessionId: string
): void {
  const registerTool = getRegisterTool(server);

  registerTool(
    "cw_snapshot",
    "Return a compact structured snapshot of recent session context including active files, observations, and decisions.",
    {},
    async () => {
      try {
        sessionQueries(db).ensureSession(serverSessionId, projectRoot);
        const targetSessionId = resolveTargetSessionId(db, projectRoot, serverSessionId);
        const summary = trimSnapshotToBudget({
          sessionId: targetSessionId,
          generatedAt: Date.now(),
          activeFiles: loadActiveFiles(db, targetSessionId),
          recentObservations: loadRecentObservations(db, targetSessionId),
          decisions: loadDecisions(db, targetSessionId),
        });

        return {
          content: [{ type: "text" as const, text: renderSnapshot(summary) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Snapshot failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
