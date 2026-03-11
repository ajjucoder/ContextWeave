import * as path from "node:path";
import * as fs from "node:fs";

function readGoModule(projectRoot: string): string | null {
  const goModPath = path.join(projectRoot, "go.mod");
  if (!fs.existsSync(goModPath)) return null;
  const content = fs.readFileSync(goModPath, "utf8");
  const match = content.match(/^module\s+(\S+)/m);
  return match?.[1] ?? null;
}

export function resolveGoImport(importSpec: string, _currentFile: string, projectRoot: string): string | null {
  const moduleName = readGoModule(projectRoot);
  if (!moduleName) return null;

  if (!importSpec.startsWith(moduleName)) return null;

  const relPkg = importSpec.slice(moduleName.length).replace(/^\//, "");
  const pkgDir = path.join(projectRoot, relPkg);

  if (!fs.existsSync(pkgDir)) return null;

  const goFiles = fs.readdirSync(pkgDir).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"));
  if (goFiles.length === 0) return null;

  return path.relative(projectRoot, path.join(pkgDir, goFiles[0]!));
}
