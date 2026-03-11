import type Database from "better-sqlite3";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import type { SymbolRecord } from "../../core/types.js";

export interface ParsedSymbolReference {
  fileSuffix?: string;
  ownerName?: string;
  symbolName: string;
}

export function parseSymbolReference(reference: string): ParsedSymbolReference {
  const colonIdx = reference.lastIndexOf(":");
  const fileQualified = colonIdx > 0 && reference.slice(0, colonIdx).includes(".");
  const symbolPart = fileQualified ? reference.slice(colonIdx + 1) : reference;
  const ownerSeparator = symbolPart.lastIndexOf(".");

  return {
    fileSuffix: fileQualified ? reference.slice(0, colonIdx) : undefined,
    ownerName: ownerSeparator > 0 ? symbolPart.slice(0, ownerSeparator) : undefined,
    symbolName: ownerSeparator > 0 ? symbolPart.slice(ownerSeparator + 1) : symbolPart,
  };
}

export function findOwningClass(
  db: Database.Database,
  symbol: SymbolRecord
): SymbolRecord | null {
  if (symbol.kind !== "method") return null;
  const symbols = symbolQueries(db);
  const candidates = symbols
    .getByFileId(symbol.fileId)
    .filter(
      (candidate) =>
        candidate.kind === "class" &&
        candidate.startLine <= symbol.startLine &&
        candidate.endLine >= symbol.endLine
    )
    .sort(
      (a, b) =>
        (a.endLine - a.startLine) - (b.endLine - b.startLine) ||
        a.startLine - b.startLine
    );
  return candidates[0] ?? null;
}

export function formatSymbolDisplayName(
  db: Database.Database,
  symbol: SymbolRecord
): string {
  const owner = findOwningClass(db, symbol);
  return owner ? `${owner.name}.${symbol.name}` : symbol.name;
}

function matchesOwner(
  db: Database.Database,
  symbol: SymbolRecord,
  ownerName: string | undefined
): boolean {
  if (!ownerName) return true;
  return findOwningClass(db, symbol)?.name === ownerName;
}

export function resolveExactSymbolMatches(
  db: Database.Database,
  reference: string
): SymbolRecord[] {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const parsed = parseSymbolReference(reference);

  if (!parsed.symbolName) return [];

  if (parsed.fileSuffix) {
    const file = files.getByPathSuffix(parsed.fileSuffix);
    if (!file) return [];
    return symbols
      .getByFileId(file.id)
      .filter(
        (symbol) =>
          symbol.name === parsed.symbolName && matchesOwner(db, symbol, parsed.ownerName)
      )
      .sort((a, b) => b.centrality - a.centrality || a.startLine - b.startLine);
  }

  if (parsed.ownerName) {
    const qualifiedName = `${parsed.ownerName}.${parsed.symbolName}`;
    const byQualified = symbols.getByQualifiedName(qualifiedName);
    if (byQualified.length > 0) {
      return byQualified.sort((a, b) => b.centrality - a.centrality || a.fileId - b.fileId || a.startLine - b.startLine);
    }
  }

  return symbols
    .getByName(parsed.symbolName)
    .filter((symbol) => matchesOwner(db, symbol, parsed.ownerName))
    .sort((a, b) => b.centrality - a.centrality || a.fileId - b.fileId || a.startLine - b.startLine);
}
