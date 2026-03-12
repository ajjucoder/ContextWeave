export function lineNumberForOffset(source: string, startLine: number, offset: number): number {
  return startLine + source.slice(0, offset).split("\n").length - 1;
}
