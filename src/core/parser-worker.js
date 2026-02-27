import { parentPort, workerData } from "node:worker_threads";
import { readFileSync, statSync } from "node:fs";
import { detectLanguage, parseFile } from "./parser.ts";
import { hashFile } from "../utils/hash.ts";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const { filePaths } = workerData;
const results = [];

for (const filePath of filePaths) {
  const language = detectLanguage(filePath);
  if (!language) {
    results.push({
      filePath,
      mtime: 0,
      hash: "",
      language: "unknown",
      parsedAt: Date.now(),
      parseResult: null,
      error: "Unsupported language",
    });
    continue;
  }

  try {
    const stat = statSync(filePath);
    const mtime = stat.mtimeMs;
    if (stat.size > MAX_FILE_SIZE) {
      results.push({
        filePath,
        mtime,
        hash: "",
        language,
        parsedAt: Date.now(),
        parseResult: null,
        error: `File ${filePath} exceeds ${MAX_FILE_SIZE} byte limit (${stat.size} bytes)`,
      });
      continue;
    }

    const content = readFileSync(filePath, "utf-8");
    const hash = hashFile(content);
    const parseResult = parseFile(filePath, content, language);
    results.push({ filePath, mtime, hash, language, parsedAt: Date.now(), parseResult, error: null });
  } catch (err) {
    results.push({
      filePath,
      mtime: 0,
      hash: "",
      language,
      parsedAt: Date.now(),
      parseResult: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

parentPort?.postMessage(results);
