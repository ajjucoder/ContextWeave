import * as path from "node:path";
import * as fs from "node:fs";

const SYSTEM_INCLUDE_RE = /^<[^>]+>$/;

export function resolveCInclude(importSpec: string, currentFile: string, projectRoot: string): string | null {
  if (SYSTEM_INCLUDE_RE.test(importSpec)) return null;

  const cleanSpec = importSpec.replace(/^["']|["']$/g, "");
  const currentDir = path.dirname(currentFile);

  const relative = path.join(currentDir, cleanSpec);
  if (fs.existsSync(relative)) return path.relative(projectRoot, relative);

  const fromRoot = path.join(projectRoot, cleanSpec);
  if (fs.existsSync(fromRoot)) return path.relative(projectRoot, fromRoot);

  for (const includeDir of ["include", "src", "lib"]) {
    const candidate = path.join(projectRoot, includeDir, cleanSpec);
    if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
  }

  return null;
}
