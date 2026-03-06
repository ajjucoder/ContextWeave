import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { fileQueries } from "../db/queries/files.js";
import { observationQueries } from "../db/queries/observations.js";
import { sessionQueries } from "../db/queries/sessions.js";
import { ObservationStore } from "./observations.js";

const BOOTSTRAP_SESSION_ID = "contextweave-bootstrap";
const BOOTSTRAP_AGENT_ID = "contextweave-bootstrap";
const MAX_SCAN_DEPTH = 4;
const MAX_DOC_FILES = 16;
const MAX_NOTES_PER_FILE = 4;
const MAX_TOTAL_NOTES = 24;
const MIN_NOTE_LENGTH = 24;
const MAX_NOTE_LENGTH = 220;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const DOC_DISCOVERY_RE = /(architect|design|decision|adr|policy|runbook|playbook|guide|overview)/i;
const FOLLOW_UP_HEADING_RE = /(follow[- ]?up|next steps?|actions?)/i;

interface SeedObservation {
  scope: "architecture" | "convention" | "decision" | "todo";
  note: string;
  fileId: number | null;
}

export interface BootstrapSyncResult {
  seeded: number;
  archived: number;
  total: number;
}

function toProjectPath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath).replace(/\\/g, "/");
}

function trimSentence(text: string, maxLength = MAX_NOTE_LENGTH): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  const sentence = compact.slice(0, maxLength);
  const lastSpace = sentence.lastIndexOf(" ");
  return `${sentence.slice(0, lastSpace > 40 ? lastSpace : maxLength).trim()}...`;
}

function normalizeInline(text: string): string {
  return text
    .replace(/`+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSkipLine(text: string): boolean {
  if (text.length < MIN_NOTE_LENGTH) return true;
  if (/[{};][^a-z]*$/.test(text)) return true;
  if (/^(cw_|npm |node |pnpm |yarn |tsx )/i.test(text)) return true;
  if (text.includes("```")) return true;
  return false;
}

function scopeForPath(projectPath: string): SeedObservation["scope"] {
  const lower = projectPath.toLowerCase();
  if (lower.endsWith("claude.md")) return "convention";
  if (/(^|\/)(adr|decisions?)(\/|$)/.test(lower)) return "decision";
  return "architecture";
}

function discoverDocFiles(projectRoot: string): string[] {
  const explicit = ["README.md", "CLAUDE.md", ".claude/CLAUDE.md"]
    .map((path) => resolve(projectRoot, path))
    .filter((path, index, paths) => existsSync(path) && paths.indexOf(path) === index);

  const discovered: string[] = [];
  const roots = ["docs", "doc"]
    .map((dir) => resolve(projectRoot, dir))
    .filter((dir) => existsSync(dir));

  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH || discovered.length >= MAX_DOC_FILES) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
        if (discovered.length >= MAX_DOC_FILES) return;
        continue;
      }
      if (!entry.isFile()) continue;
      if (!MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      if (!DOC_DISCOVERY_RE.test(fullPath)) continue;
      discovered.push(fullPath);
      if (discovered.length >= MAX_DOC_FILES) return;
    }
  };

  for (const root of roots) {
    visit(root, 0);
    if (discovered.length >= MAX_DOC_FILES) break;
  }

  return [...new Set([...explicit, ...discovered])].slice(0, MAX_DOC_FILES);
}

function pushSeed(
  notes: SeedObservation[],
  seen: Set<string>,
  scope: SeedObservation["scope"],
  projectPath: string,
  text: string,
  fileId: number | null,
  heading?: string
): void {
  if (notes.length >= MAX_NOTES_PER_FILE) return;

  const normalizedText = normalizeInline(text);
  if (shouldSkipLine(normalizedText)) return;

  const prefix = heading && !normalizedText.toLowerCase().startsWith(heading.toLowerCase())
    ? `${heading}: `
    : "";
  const note = trimSentence(`${projectPath}: ${prefix}${normalizedText}`);
  const key = `${scope}:${note.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  notes.push({ scope, note, fileId });
}

function extractDocSeeds(projectPath: string, content: string, fileId: number | null): SeedObservation[] {
  const notes: SeedObservation[] = [];
  const seen = new Set<string>();
  const defaultScope = scopeForPath(projectPath);
  const lines = content.split(/\r?\n/);
  let inCodeFence = false;
  let currentHeading = "";
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = normalizeInline(paragraph.join(" "));
    const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
    pushSeed(notes, seen, defaultScope, projectPath, sentence, fileId, currentHeading);
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      flushParagraph();
      continue;
    }
    if (inCodeFence) continue;
    if (line.length === 0) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      currentHeading = normalizeInline(headingMatch[1] ?? "");
      continue;
    }

    const checkedMatch = line.match(/^[-*]\s+\[(x|X)\]\s+(.+)$/);
    if (checkedMatch) {
      flushParagraph();
      pushSeed(notes, seen, "decision", projectPath, `Validated follow-up: ${checkedMatch[2] ?? ""}`, fileId, currentHeading);
      continue;
    }

    const uncheckedMatch = line.match(/^[-*]\s+\[\s\]\s+(.+)$/);
    if (uncheckedMatch && FOLLOW_UP_HEADING_RE.test(currentHeading)) {
      flushParagraph();
      pushSeed(notes, seen, "todo", projectPath, `Follow-up: ${uncheckedMatch[1] ?? ""}`, fileId, currentHeading);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      pushSeed(notes, seen, defaultScope, projectPath, bulletMatch[1] ?? "", fileId, currentHeading);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return notes;
}

function collectBootstrapSeeds(db: Database.Database, projectRoot: string): SeedObservation[] {
  const files = fileQueries(db);
  const seeds: SeedObservation[] = [];

  for (const filePath of discoverDocFiles(projectRoot)) {
    const projectPath = toProjectPath(projectRoot, filePath);
    const fileId = files.getByPath(projectPath)?.id ?? null;
    const content = readFileSync(filePath, "utf8");
    for (const note of extractDocSeeds(projectPath, content, fileId)) {
      seeds.push(note);
      if (seeds.length >= MAX_TOTAL_NOTES) return seeds;
    }
  }

  return seeds;
}

export function syncBootstrapObservations(db: Database.Database, projectRoot: string): BootstrapSyncResult {
  sessionQueries(db).ensureSession(BOOTSTRAP_SESSION_ID, projectRoot);

  const store = new ObservationStore(db);
  const queries = observationQueries(db);
  const desired = collectBootstrapSeeds(db, projectRoot);
  const existing = queries
    .getBySession(BOOTSTRAP_SESSION_ID)
    .filter((observation) => observation.agentId === BOOTSTRAP_AGENT_ID && !observation.archived);

  const desiredKeys = new Set(desired.map((seed) => `${seed.scope}:${seed.note}`));
  let archived = 0;
  for (const observation of existing) {
    const key = `${observation.scope}:${observation.note}`;
    if (desiredKeys.has(key)) continue;
    queries.archive(observation.id);
    archived += 1;
  }

  const existingKeys = new Set(existing.map((observation) => `${observation.scope}:${observation.note}`));
  let seeded = 0;
  for (const seed of desired) {
    const key = `${seed.scope}:${seed.note}`;
    if (existingKeys.has(key)) continue;
    store.create({
      sessionId: BOOTSTRAP_SESSION_ID,
      agentId: BOOTSTRAP_AGENT_ID,
      fileId: seed.fileId ?? undefined,
      scope: seed.scope,
      note: seed.note,
      confidence: seed.scope === "todo" ? 0.88 : seed.scope === "convention" ? 0.9 : 0.96,
    });
    seeded += 1;
  }

  return {
    seeded,
    archived,
    total: desired.length,
  };
}
