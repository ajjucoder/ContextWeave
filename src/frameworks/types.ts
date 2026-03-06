import type { FileRecord, ParsedFrameworkCall, ParsedSymbol, SymbolRecord } from "../core/types.js";

export interface FrameworkResolveContext {
  files: {
    searchByPath(term: string, limit?: number): FileRecord[];
  };
  symbols: {
    getByFileAndName(fileId: number, name: string): SymbolRecord | undefined;
  };
  pickTargets: (queryName: string, lookupName?: string) => Array<{ id: number }>;
}

export interface FrameworkTracePlugin {
  id: string;
  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[];
  supports(call: ParsedFrameworkCall): boolean;
  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[];
}
