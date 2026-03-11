import * as path from "node:path";
import * as fs from "node:fs";

export function resolveRustImport(importSpec: string, currentFile: string, projectRoot: string): string | null {
  const parts = importSpec.replace(/^(crate|self|super)::/, "").split("::");
  const srcDir = path.join(projectRoot, "src");

  const base = srcDir;
  const modPath = path.join(base, ...parts.slice(0, -1));
  const lastName = parts[parts.length - 1] ?? "";

  const candidates = [
    path.join(modPath, `${lastName}.rs`),
    path.join(modPath, lastName, "mod.rs"),
    path.join(base, `${parts[0]}.rs`),
    path.join(base, parts[0] ?? "", "mod.rs"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
  }

  if (importSpec.startsWith("super::")) {
    const parentDir = path.dirname(path.dirname(currentFile));
    const modName = parts[parts.length - 1];
    if (modName) {
      const superCandidate = path.join(parentDir, `${modName}.rs`);
      if (fs.existsSync(superCandidate)) return path.relative(projectRoot, superCandidate);
    }
  }

  return null;
}
