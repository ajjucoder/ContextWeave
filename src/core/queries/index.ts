import * as tsQueries from "./typescript.js";
import * as jsQueries from "./javascript.js";
import * as pyQueries from "./python.js";
import * as goQueries from "./go.js";
import * as rustQueries from "./rust.js";
import * as javaQueries from "./java.js";
import * as cQueries from "./c.js";
import * as cppQueries from "./cpp.js";
import * as csharpQueries from "./csharp.js";
import * as rubyQueries from "./ruby.js";
import * as bashQueries from "./bash.js";
import * as phpQueries from "./php.js";

export interface LanguageQuerySet {
  functionDeclarations: string;
  arrowFunctions: string;
  classDeclarations: string;
  methodDefinitions: string;
  variableDeclarations: string;
  importDeclarations: string;
  exportDeclarations: string;
  callExpressions: string;
  interfaceDeclarations?: string;
  typeAliasDeclarations?: string;
  enumDeclarations?: string;
  typeReferences?: string;
}

const queryRegistry: Record<string, LanguageQuerySet> = {
  typescript: tsQueries,
  tsx: tsQueries,
  javascript: jsQueries,
  jsx: jsQueries,
  python: pyQueries,
  go: goQueries,
  rust: rustQueries,
  java: javaQueries,
  c: cQueries,
  cpp: cppQueries,
  csharp: csharpQueries,
  ruby: rubyQueries,
  bash: bashQueries,
  php: phpQueries,
};

export function getQueries(language: string): LanguageQuerySet | null {
  return queryRegistry[language] ?? null;
}
