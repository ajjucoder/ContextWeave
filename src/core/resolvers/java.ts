import * as path from "node:path";
import * as fs from "node:fs";

const JAVA_SOURCE_ROOTS = ["src/main/java", "src/test/java", "src"];

export function resolveJavaImport(importSpec: string, _currentFile: string, projectRoot: string): string | null {
  if (importSpec.startsWith("java.") || importSpec.startsWith("javax.") || importSpec.startsWith("android.")) {
    return null;
  }

  const filePath = importSpec.replace(/\./g, path.sep) + ".java";

  for (const root of JAVA_SOURCE_ROOTS) {
    const candidate = path.join(projectRoot, root, filePath);
    if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
  }

  return null;
}
