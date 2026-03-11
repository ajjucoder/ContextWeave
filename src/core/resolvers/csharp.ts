import * as path from "node:path";
import * as fs from "node:fs";

export function resolveCSharpImport(importSpec: string, _currentFile: string, projectRoot: string): string | null {
  const parts = importSpec.split(".");
  const fileName = parts[parts.length - 1] + ".cs";
  const dirParts = parts.slice(0, -1);

  const candidates = [
    path.join(projectRoot, ...dirParts, fileName),
    path.join(projectRoot, "src", ...dirParts, fileName),
    path.join(projectRoot, fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
  }

  const walked = walkForFile(projectRoot, fileName);
  if (walked) return path.relative(projectRoot, walked);

  return null;
}

function walkForFile(dir: string, fileName: string, depth = 0): string | null {
  if (depth > 5) return null;
  if (!fs.existsSync(dir)) return null;

  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
      const found = walkForFile(full, fileName, depth + 1);
      if (found) return found;
    } else if (entry === fileName) {
      return full;
    }
  }

  return null;
}
