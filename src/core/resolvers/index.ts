import { resolvePythonImport } from "./python.js";
import { resolveGoImport } from "./go.js";
import { resolveRustImport } from "./rust.js";
import { resolveJavaImport } from "./java.js";
import { resolveCSharpImport } from "./csharp.js";
import { resolveCInclude } from "./c.js";
import { resolveRubyImport } from "./ruby.js";
import { resolvePhpImport } from "./php.js";

export type { } from "./python.js";

export function resolveModulePath(
  language: string,
  importSpec: string,
  currentFile: string,
  projectRoot: string
): string | null {
  switch (language) {
    case "python":
      return resolvePythonImport(importSpec, currentFile, projectRoot);
    case "go":
      return resolveGoImport(importSpec, currentFile, projectRoot);
    case "rust":
      return resolveRustImport(importSpec, currentFile, projectRoot);
    case "java":
      return resolveJavaImport(importSpec, currentFile, projectRoot);
    case "c_sharp":
    case "csharp":
      return resolveCSharpImport(importSpec, currentFile, projectRoot);
    case "c":
    case "cpp":
      return resolveCInclude(importSpec, currentFile, projectRoot);
    case "ruby":
      return resolveRubyImport(importSpec, currentFile, projectRoot);
    case "php":
      return resolvePhpImport(importSpec, currentFile, projectRoot);
    default:
      return null;
  }
}

export {
  resolvePythonImport,
  resolveGoImport,
  resolveRustImport,
  resolveJavaImport,
  resolveCSharpImport,
  resolveCInclude,
  resolveRubyImport,
  resolvePhpImport,
};
