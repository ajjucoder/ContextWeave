import * as path from "node:path";
import * as fs from "node:fs";

interface ComposerPsr4 {
  [namespace: string]: string | string[];
}

function readPsr4Autoload(projectRoot: string): ComposerPsr4 {
  const composerPath = path.join(projectRoot, "composer.json");
  if (!fs.existsSync(composerPath)) return {};
  try {
    const composer = JSON.parse(fs.readFileSync(composerPath, "utf8")) as {
      autoload?: { "psr-4"?: ComposerPsr4 };
    };
    return composer.autoload?.["psr-4"] ?? {};
  } catch {
    return {};
  }
}

export function resolvePhpImport(importSpec: string, _currentFile: string, projectRoot: string): string | null {
  const psr4 = readPsr4Autoload(projectRoot);
  const normalized = importSpec.replace(/\\/g, "/");

  for (const [namespace, srcDirs] of Object.entries(psr4)) {
    const normalizedNs = namespace.replace(/\\/g, "/").replace(/\/$/, "");
    if (!normalized.startsWith(normalizedNs + "/") && normalized !== normalizedNs) continue;

    const relPath = normalized.slice(normalizedNs.length).replace(/^\//, "");
    const dirs = Array.isArray(srcDirs) ? srcDirs : [srcDirs];

    for (const dir of dirs) {
      const candidate = path.join(projectRoot, dir, `${relPath}.php`);
      if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
    }
  }

  const fallback = path.join(projectRoot, `${normalized.replace(/\//g, path.sep)}.php`);
  if (fs.existsSync(fallback)) return path.relative(projectRoot, fallback);

  return null;
}
