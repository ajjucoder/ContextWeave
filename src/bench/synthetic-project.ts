import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface ModuleProfile {
  folder: string;
  keyword: string;
  contextTerms: [string, string, string, string];
}

const MODULE_PROFILES: readonly ModuleProfile[] = [
  { folder: "auth", keyword: "authentication", contextTerms: ["token", "validation", "middleware", "session"] },
  { folder: "payments", keyword: "payment", contextTerms: ["invoice", "ledger", "reconciliation", "gateway"] },
  { folder: "notifications", keyword: "notification", contextTerms: ["dispatch", "template", "queue", "delivery"] },
  { folder: "analytics", keyword: "analytics", contextTerms: ["event", "pipeline", "aggregation", "reporting"] },
  { folder: "cache", keyword: "cache", contextTerms: ["eviction", "ttl", "consistency", "invalidation"] },
  { folder: "search", keyword: "search", contextTerms: ["index", "ranking", "query", "relevance"] },
  { folder: "routing", keyword: "routing", contextTerms: ["router", "handler", "path", "matcher"] },
  { folder: "worker", keyword: "worker", contextTerms: ["job", "scheduler", "retry", "backoff"] },
  { folder: "database", keyword: "database", contextTerms: ["transaction", "migration", "query", "connection"] },
  { folder: "session", keyword: "session", contextTerms: ["cookie", "state", "lifecycle", "renewal"] },
];

const DEFAULT_TARGET_LOC = 100_000;
const DEFAULT_FILE_COUNT = 500;
const DEFAULT_MODULE_COUNT = 10;
const HELPER_FUNCTIONS_PER_FILE = 6;
const MIN_LINES_PER_FILE = 40;

export interface SyntheticProjectOptions {
  rootDir: string;
  targetLoc?: number;
  fileCount?: number;
  moduleCount?: number;
}

export type SyntheticQueryKind = "narrow" | "broad" | "task";

export interface SyntheticQueryCase {
  kind: SyntheticQueryKind;
  label: string;
  query: string;
  expectedFile: string;
  expectedSymbol: string;
}

export interface SyntheticProjectManifest {
  rootDir: string;
  targetLoc: number;
  actualLoc: number;
  fileCount: number;
  moduleCount: number;
  files: string[];
  queryCases: SyntheticQueryCase[];
  generatedAt: number;
}

interface FileSpec {
  relativePath: string;
  moduleIndex: number;
  moduleLocalIndex: number;
  globalIndex: number;
  lines: number;
  profile: ModuleProfile;
  anchorName: string;
  domainIdentifier: string;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function distribute(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const remainder = total - base * buckets;
  return Array.from({ length: buckets }, (_, index) => base + (index < remainder ? 1 : 0));
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function toIdentifier(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : "domain";
}

function makeAnchorName(domainIdentifier: string, moduleIndex: number, moduleLocalIndex: number): string {
  return `${domainIdentifier}FlowAnchor${String(moduleIndex).padStart(2, "0")}${String(moduleLocalIndex).padStart(3, "0")}`;
}

function buildFileContent(spec: FileSpec, nextSpec: FileSpec): string {
  const lines: string[] = [];
  const nextFileName = nextSpec.relativePath.split("/").pop() ?? "file-000.ts";
  const helperPrefix = `${spec.domainIdentifier}Stage${String(spec.moduleLocalIndex).padStart(3, "0")}`;

  lines.push(`import { ${nextSpec.anchorName} } from "./${nextFileName}";`);
  lines.push("");
  lines.push(`export const MODULE_NAME = "${spec.profile.folder}";`);
  lines.push(`export const MODULE_INDEX = ${spec.moduleIndex};`);
  lines.push(`export const FILE_INDEX = ${spec.globalIndex};`);
  lines.push(`export const FILE_PATH = "${spec.relativePath}";`);
  lines.push("");

  const helperNames: string[] = [];
  for (let helperIndex = 0; helperIndex < HELPER_FUNCTIONS_PER_FILE; helperIndex++) {
    const helperName = `${helperPrefix}Helper${helperIndex}`;
    helperNames.push(helperName);
    lines.push(`export function ${helperName}(value: number): number {`);
    lines.push(`  return value + ${spec.globalIndex + helperIndex + 1};`);
    lines.push("}");
    lines.push("");
  }

  const primaryHelper = helperNames[0] ?? `${helperPrefix}Helper0`;
  lines.push(`export function ${spec.anchorName}(seed: number): number {`);
  lines.push("  const nextSeed = seed % 17;");
  lines.push(`  return ${primaryHelper}(nextSeed) + ${nextSpec.anchorName}(nextSeed);`);
  lines.push("}");
  lines.push("");
  lines.push(
    `export const ${spec.domainIdentifier.toUpperCase()}_QUERY_TERMS = "${spec.profile.keyword} ${spec.profile.contextTerms.join(" ")} pipeline handler";`
  );
  lines.push("");

  let fillerIndex = 0;
  while (lines.length < spec.lines) {
    lines.push(`// ${spec.profile.keyword} synthetic context line ${spec.globalIndex}-${fillerIndex}`);
    fillerIndex++;
  }

  if (lines.length > spec.lines) {
    throw new Error(
      `File template exceeded line budget for ${spec.relativePath} (${lines.length} > ${spec.lines})`
    );
  }

  return lines.join("\n");
}

function buildQueryCases(modules: FileSpec[][]): SyntheticQueryCase[] {
  const cases: SyntheticQueryCase[] = [];

  const narrowModules = modules.slice(0, Math.min(5, modules.length));
  for (const moduleSpecs of narrowModules) {
    const spec = moduleSpecs[0];
    if (!spec) continue;
    cases.push({
      kind: "narrow",
      label: `narrow:${spec.profile.folder}`,
      query: spec.anchorName,
      expectedFile: spec.relativePath,
      expectedSymbol: spec.anchorName,
    });
  }

  const broadModules = modules.slice(0, Math.min(2, modules.length));
  for (const moduleSpecs of broadModules) {
    const spec = moduleSpecs[0];
    if (!spec) continue;
    cases.push({
      kind: "broad",
      label: `broad:${spec.profile.folder}`,
      query: `${spec.profile.keyword} ${spec.profile.contextTerms[0]} ${spec.profile.contextTerms[1]} pipeline`,
      expectedFile: spec.relativePath,
      expectedSymbol: spec.anchorName,
    });
  }

  const taskModules = modules.slice(0, Math.min(2, modules.length));
  for (const moduleSpecs of taskModules) {
    const spec = moduleSpecs[0];
    if (!spec) continue;
    cases.push({
      kind: "task",
      label: `task:${spec.profile.folder}`,
      query: `find bugs in ${spec.profile.keyword} ${spec.profile.contextTerms[0]} ${spec.profile.contextTerms[2]} pipeline`,
      expectedFile: spec.relativePath,
      expectedSymbol: spec.anchorName,
    });
  }

  return cases;
}

export function createSyntheticProject(options: SyntheticProjectOptions): SyntheticProjectManifest {
  const targetLoc = options.targetLoc ?? DEFAULT_TARGET_LOC;
  const fileCount = options.fileCount ?? DEFAULT_FILE_COUNT;
  const moduleCount = options.moduleCount ?? DEFAULT_MODULE_COUNT;
  const rootDir = resolve(options.rootDir);

  assertPositiveInteger(targetLoc, "targetLoc");
  assertPositiveInteger(fileCount, "fileCount");
  assertPositiveInteger(moduleCount, "moduleCount");

  if (moduleCount > fileCount) {
    throw new Error(`moduleCount (${moduleCount}) cannot exceed fileCount (${fileCount})`);
  }

  const perFileFloor = Math.floor(targetLoc / fileCount);
  if (perFileFloor < MIN_LINES_PER_FILE) {
    throw new Error(
      `targetLoc (${targetLoc}) is too small for ${fileCount} files; minimum is ${fileCount * MIN_LINES_PER_FILE}`
    );
  }

  removeSyntheticProject(rootDir);
  mkdirSync(rootDir, { recursive: true });

  const filesPerModule = distribute(fileCount, moduleCount);
  const linesPerFile = distribute(targetLoc, fileCount);

  const modules: FileSpec[][] = [];
  let globalIndex = 0;

  for (let moduleIndex = 0; moduleIndex < filesPerModule.length; moduleIndex++) {
    const count = filesPerModule[moduleIndex] ?? 0;
    if (count === 0) continue;

    const profile = MODULE_PROFILES[moduleIndex % MODULE_PROFILES.length]!;
    const domainIdentifier = toIdentifier(profile.keyword);
    const folderName = `${profile.folder}-${String(moduleIndex).padStart(2, "0")}`;
    const moduleSpecs: FileSpec[] = [];

    for (let moduleLocalIndex = 0; moduleLocalIndex < count; moduleLocalIndex++) {
      const lineBudget = linesPerFile[globalIndex];
      if (lineBudget === undefined) {
        throw new Error(`Missing line budget for file index ${globalIndex}`);
      }
      const fileName = `file-${String(moduleLocalIndex).padStart(3, "0")}.ts`;
      const relativePath = `src/${folderName}/${fileName}`;
      moduleSpecs.push({
        relativePath,
        moduleIndex,
        moduleLocalIndex,
        globalIndex,
        lines: lineBudget,
        profile,
        anchorName: makeAnchorName(domainIdentifier, moduleIndex, moduleLocalIndex),
        domainIdentifier,
      });
      globalIndex++;
    }

    modules.push(moduleSpecs);
  }

  const files: string[] = [];
  let actualLoc = 0;

  for (const moduleSpecs of modules) {
    for (let index = 0; index < moduleSpecs.length; index++) {
      const spec = moduleSpecs[index]!;
      const nextSpec = moduleSpecs[(index + 1) % moduleSpecs.length]!;
      const content = buildFileContent(spec, nextSpec);
      const loc = countLines(content);
      if (loc !== spec.lines) {
        throw new Error(`Generated ${loc} lines for ${spec.relativePath}, expected ${spec.lines}`);
      }
      const absolutePath = resolve(rootDir, spec.relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf-8");
      files.push(spec.relativePath);
      actualLoc += loc;
    }
  }

  if (actualLoc !== targetLoc) {
    throw new Error(`Generated LOC mismatch: expected ${targetLoc}, got ${actualLoc}`);
  }

  return {
    rootDir,
    targetLoc,
    actualLoc,
    fileCount,
    moduleCount,
    files,
    queryCases: buildQueryCases(modules),
    generatedAt: Date.now(),
  };
}

export function countSyntheticProjectLoc(manifest: SyntheticProjectManifest): number {
  let total = 0;
  for (const relativePath of manifest.files) {
    const absolutePath = resolve(manifest.rootDir, relativePath);
    const content = readFileSync(absolutePath, "utf-8");
    total += countLines(content);
  }
  return total;
}

export function removeSyntheticProject(rootDir: string): void {
  const resolved = resolve(rootDir);
  if (!existsSync(resolved)) return;
  rmSync(resolved, { recursive: true, force: true });
}
