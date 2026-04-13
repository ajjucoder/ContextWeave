import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let ripgrepAvailabilityPromise: Promise<boolean> | null = null;

export interface RipgrepMatch {
  path: string;
  line: number;
  text: string;
}

interface RipgrepOptions {
  caseSensitive?: boolean;
  glob?: string;
  maxResults?: number;
  useRegex?: boolean;
  multiline?: boolean;
}

interface RgMatchEvent {
  type: "match";
  data: {
    path: { text: string };
    line_number: number;
    lines: { text: string };
  };
}

function parseRgJsonOutput(stdout: string): RipgrepMatch[] {
  const results: RipgrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let parsed: RgMatchEvent;
    try {
      parsed = JSON.parse(line) as RgMatchEvent;
    } catch {
      continue;
    }
    if (parsed.type !== "match") continue;
    results.push({
      path: parsed.data.path.text,
      line: parsed.data.line_number,
      text: parsed.data.lines.text.trimEnd(),
    });
  }
  return results;
}

export async function runRipgrepSearch(
  pattern: string,
  rootDir: string,
  options: RipgrepOptions = {}
): Promise<RipgrepMatch[]> {
  const { caseSensitive = false, glob, maxResults = 200, useRegex = false, multiline = false } = options;

  const args: string[] = ["--json", "--max-count", String(maxResults)];

  if (!caseSensitive) args.push("--ignore-case");
  if (!useRegex) args.push("--fixed-strings");
  if (multiline) args.push("--multiline");
  if (glob) args.push("--glob", glob);
  args.push("--max-filesize", "1M");
  args.push("--", pattern, ".");

  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: rootDir,
      maxBuffer: 10 * 1024 * 1024,
    });
    const matches = parseRgJsonOutput(stdout);
    return matches.slice(0, maxResults);
  } catch (err: unknown) {
    if (err && typeof err === "object") {
      const e = err as { code?: number | string; stdout?: string };
      // rg exits with code 1 when there are no matches — parse stdout if any
      if (e.code === 1) {
        const stdout = e.stdout ?? "";
        const matches = parseRgJsonOutput(stdout);
        return matches.slice(0, maxResults);
      }
    }
    throw err;
  }
}

export async function isRipgrepAvailable(): Promise<boolean> {
  if (!ripgrepAvailabilityPromise) {
    ripgrepAvailabilityPromise = execFileAsync("rg", ["--version"])
      .then(() => true)
      .catch(() => false);
  }
  return ripgrepAvailabilityPromise;
}
