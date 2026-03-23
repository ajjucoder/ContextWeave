import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { encode } from "gpt-tokenizer";

function parseInput() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: node baseline_batch_eval.mjs <input.json>");
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function countTokens(value) {
  return encode(value).length;
}

function runGrep(projectRoot, op) {
  const args = ["-n", "--no-heading"];
  if (op.fixedStrings !== false) {
    args.push("-F");
  }
  if (op.caseSensitive === false) {
    args.push("-i");
  }
  if (op.glob) {
    args.push("-g", op.glob);
  }
  if (op.maxResults) {
    args.push("-m", String(op.maxResults));
  }
  args.push(op.pattern);
  args.push(op.path ? resolve(projectRoot, op.path) : projectRoot);
  const result = spawnSync("rg", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const text = (result.stdout ?? "").trimEnd();
  return text.length > 0 ? text : (result.stderr ?? "").trimEnd() || `No matches for ${op.pattern}`;
}

function runRead(projectRoot, op) {
  const filePath = resolve(projectRoot, op.path);
  if (!existsSync(filePath)) {
    return `Missing file: ${op.path}`;
  }
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, op.startLine ?? 1);
  const end = Math.min(lines.length, op.endLine ?? Math.min(lines.length, start + (op.maxLines ?? 200) - 1));
  const width = String(end).length;
  const excerpt = lines.slice(start - 1, end);
  return [
    `Read ${op.path}:${start}-${end} (${excerpt.length} lines)`,
    "",
    ...excerpt.map((line, index) => `${String(start + index).padStart(width, " ")} | ${line}`),
  ].join("\n");
}

function runGlob(projectRoot, op) {
  const args = ["--files"];
  if (op.glob) {
    args.push("-g", op.glob);
  }
  args.push(projectRoot);
  const result = spawnSync("rg", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return (result.stdout ?? "").trimEnd();
}

function executeOp(projectRoot, op) {
  const start = Date.now();
  let text;
  switch (op.kind) {
    case "grep":
      text = runGrep(projectRoot, op);
      break;
    case "read":
      text = runRead(projectRoot, op);
      break;
    case "glob":
      text = runGlob(projectRoot, op);
      break;
    default:
      throw new Error(`Unsupported op kind: ${op.kind}`);
  }
  const elapsedMs = Date.now() - start;
  const inputPayload = JSON.stringify(op);
  return {
    ...op,
    elapsedMs,
    inputTokens: countTokens(inputPayload),
    outputTokens: countTokens(text),
    totalTokens: countTokens(inputPayload) + countTokens(text),
    text,
  };
}

function main() {
  const input = parseInput();
  const projectRoot = resolve(input.projectRoot);
  const results = (input.ops ?? []).map((op) => executeOp(projectRoot, op));
  process.stdout.write(JSON.stringify({ projectRoot, results }, null, 2));
}

main();
