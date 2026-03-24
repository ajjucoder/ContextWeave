import { parentPort, workerData } from "node:worker_threads";
import { readFileSync, statSync } from "node:fs";
import { detectLanguage, parseFile, initParser } from "./parser.ts";
import { hashFile } from "../utils/hash.ts";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const PARSE_TIMEOUT_MICROS = 5_000_000;
const { filePaths } = workerData;
const results = [];

function parseFileWithTimeout(filePath, content, language) {
  if (language === "markdown" || language === "yaml" || language === "json" || language === "toml" || language === "ini") {
    return parseFile(filePath, content, language);
  }

  const parser = initParser(language);
  parser.setTimeoutMicros(PARSE_TIMEOUT_MICROS);
  try {
    return parseFile(filePath, content, language);
  } finally {
    parser.setTimeoutMicros(0);
  }
}

for (const filePath of filePaths) {
  const language = detectLanguage(filePath);
  if (!language) {
    results.push({
      filePath,
      content: "",
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
        content: "",
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
    const parseResult = parseFileWithTimeout(filePath, content, language);
    results.push({ filePath, content, mtime, hash, language, parsedAt: Date.now(), parseResult, error: null });
  } catch (err) {
    results.push({
      filePath,
      content: "",
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
