import { parentPort, workerData } from "node:worker_threads";
import { readFileSync, statSync } from "node:fs";
import { detectLanguage, parseFile } from "./parser.ts";
import { hashFile } from "../utils/hash.ts";

const { filePaths } = workerData;
const results = [];

for (const filePath of filePaths) {
  const language = detectLanguage(filePath);
  if (!language) continue;

  try {
    const mtime = statSync(filePath).mtimeMs;
    const content = readFileSync(filePath, "utf-8");
    const hash = hashFile(content);
    const parseResult = parseFile(filePath, content, language);
    results.push({ filePath, mtime, hash, language, parseResult, error: null });
  } catch (err) {
    results.push({
      filePath,
      mtime: 0,
      hash: "",
      language,
      parseResult: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

parentPort?.postMessage(results);
