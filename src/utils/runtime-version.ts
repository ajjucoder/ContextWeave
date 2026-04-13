import { readFileSync } from "node:fs";

let cachedVersion: string | null = null;

export function getRuntimeVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { version?: string };
    cachedVersion = packageJson.version?.trim() || "unknown";
  } catch {
    cachedVersion = "unknown";
  }

  return cachedVersion;
}
