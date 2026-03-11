import * as path from "node:path";
import * as fs from "node:fs";

export function resolvePythonImport(importSpec: string, currentFile: string, projectRoot: string): string | null {
  const currentDir = path.dirname(currentFile);

  if (importSpec.startsWith(".")) {
    const dots = importSpec.match(/^\.+/)?.[0] ?? ".";
    const rest = importSpec.slice(dots.length);
    let base = currentDir;
    for (let i = 1; i < dots.length; i++) {
      base = path.dirname(base);
    }
    const modPath = rest ? path.join(base, rest.replace(/\./g, path.sep)) : base;
    const candidates = [`${modPath}.py`, path.join(modPath, "__init__.py")];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
    }
    return null;
  }

  const parts = importSpec.split(".");
  for (let len = parts.length; len > 0; len--) {
    const modPath = path.join(projectRoot, ...parts.slice(0, len));
    const candidates = [`${modPath}.py`, path.join(modPath, "__init__.py")];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
    }
  }

  return null;
}
