import { relative, resolve } from "node:path";

function cleanSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function normalizePath(value: string): string {
  const cleaned = cleanSlashes(value)
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/$/, "");
  if (cleaned === "." || cleaned.length === 0) {
    return "";
  }
  return cleaned;
}

function globPatternToSource(pattern: string): string {
  const tokenDoubleStarSlash = "__DOUBLE_STAR_SLASH__";
  const tokenDoubleStar = "__DOUBLE_STAR__";
  const tokenStar = "__STAR__";
  const tokenQuestion = "__QUESTION__";

  return cleanSlashes(pattern)
    .replace(/\*\*\//g, tokenDoubleStarSlash)
    .replace(/\*\*/g, tokenDoubleStar)
    .replace(/\*/g, tokenStar)
    .replace(/\?/g, tokenQuestion)
    .replace(/[|\\()[\]^$+?.]/g, "\\$&")
    .replaceAll(tokenDoubleStarSlash, "(?:.*/)?")
    .replaceAll(tokenDoubleStar, ".*")
    .replaceAll(tokenStar, "[^/]*")
    .replaceAll(tokenQuestion, "[^/]");
}

function expandBracePatterns(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) {
    if (pattern.includes("}")) {
      throw new Error(`Invalid glob pattern "${pattern}": unmatched "}"`);
    }
    return [pattern];
  }

  const close = pattern.indexOf("}", open + 1);
  if (close === -1) {
    throw new Error(`Invalid glob pattern "${pattern}": unmatched "{"`);
  }

  const inner = pattern.slice(open + 1, close);
  const options = inner.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (options.length === 0) {
    throw new Error(`Invalid glob pattern "${pattern}": empty brace expansion`);
  }

  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  return options.flatMap((option) => expandBracePatterns(`${prefix}${option}${suffix}`));
}

export function toProjectRelativePath(projectRoot: string, filePath: string): string {
  const root = resolve(projectRoot);
  const absolutePath = resolve(root, filePath);
  const relPath = normalizePath(relative(root, absolutePath));
  if (!relPath || relPath.startsWith("..")) {
    return normalizePath(filePath);
  }
  return relPath;
}

export function withinPath(filePath: string, basePath?: string): boolean {
  if (!basePath) return true;
  const normalizedFile = normalizePath(filePath);
  const normalizedBase = normalizePath(basePath);
  if (!normalizedBase) return true;
  return normalizedFile === normalizedBase || normalizedFile.startsWith(`${normalizedBase}/`);
}

export function globToRegExp(pattern: string): RegExp {
  const patterns = expandBracePatterns(pattern);
  const source = patterns.map((entry) => globPatternToSource(entry));
  if (source.length === 1) {
    return new RegExp(`^${source[0]}$`);
  }
  return new RegExp(`^(?:${source.join("|")})$`);
}
