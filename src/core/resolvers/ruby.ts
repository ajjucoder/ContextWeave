import * as path from "node:path";
import * as fs from "node:fs";

export function resolveRubyImport(importSpec: string, currentFile: string, projectRoot: string): string | null {
  const cleanSpec = importSpec.replace(/^['"]|['"]$/g, "");

  if (cleanSpec.startsWith("./") || cleanSpec.startsWith("../")) {
    const currentDir = path.dirname(currentFile);
    const resolved = path.resolve(currentDir, cleanSpec);
    const candidates = [resolved, `${resolved}.rb`];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
    }
    return null;
  }

  for (const root of ["lib", "app", "."]) {
    const candidate = path.join(projectRoot, root, `${cleanSpec}.rb`);
    if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
  }

  return null;
}
