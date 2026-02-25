import * as tsQueries from "./typescript.js";
import * as jsQueries from "./javascript.js";

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
};

export function getQueries(language: string): LanguageQuerySet | null {
  return queryRegistry[language] ?? null;
}
