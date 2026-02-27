import { relative, resolve } from "node:path";

function cleanSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

export function normalizePath(value: string): string {
  const cleaned = cleanSlashes(value)
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/$/, "");
  if (cleaned === "." || cleaned.length === 0) {
    return "";
  }
  return cleaned;
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
  const tokenDoubleStarSlash = "__DOUBLE_STAR_SLASH__";
  const tokenDoubleStar = "__DOUBLE_STAR__";
  const tokenStar = "__STAR__";
  const tokenQuestion = "__QUESTION__";

  const source = cleanSlashes(pattern)
    .replace(/\*\*\//g, tokenDoubleStarSlash)
    .replace(/\*\*/g, tokenDoubleStar)
    .replace(/\*/g, tokenStar)
    .replace(/\?/g, tokenQuestion)
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replaceAll(tokenDoubleStarSlash, "(?:.*/)?")
    .replaceAll(tokenDoubleStar, ".*")
    .replaceAll(tokenStar, "[^/]*")
    .replaceAll(tokenQuestion, "[^/]");

  return new RegExp(`^${source}$`);
}
