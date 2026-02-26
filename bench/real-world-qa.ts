import Database from "better-sqlite3";
import { resolve } from "node:path";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";
import { createSchema } from "../src/db/schema.js";
import { parseFile, detectLanguage } from "../src/core/parser.js";
import { readFileSync, readdirSync, statSync } from "node:fs";

interface ProjectResult {
  name: string;
  root: string;
  indexTime: number;
  filesIndexed: number;
  symbolsFound: number;
  errors: string[];
  languageBreakdown: Record<string, number>;
  capsuleTests: CapsuleTestResult[];
  parseFailures: ParseFailure[];
}

interface CapsuleTestResult {
  query: string;
  tokensUsed: number;
  symbolCount: number;
  fileCount: number;
  uncertainty: string;
  pivotCoverage: number;
  noiseRatio: number;
  timeMs: number;
  topSymbols: string[];
}

interface ParseFailure {
  file: string;
  language: string;
  error: string;
  symbolCount: number;
  importCount: number;
  callCount: number;
}

const PROJECTS: Array<{ name: string; root: string; queries: string[] }> = [
  {
    name: "ebps (Python)",
    root: "/path/to/project",
    queries: ["calculations", "extractor", "client", "pdf", "parser", "measurement"],
  },
  {
    name: "Nudgy (Rust+TSX)",
    root: "/path/to/project",
    queries: ["tray", "session", "scheduler", "commands", "TrayPanel", "sessionStore"],
  },
  {
    name: "codex-team-orchestrator (TypeScript)",
    root: "/path/to/project",
    queries: ["orchestrator", "agent", "team", "transport", "hooks", "permissions"],
  },
  {
    name: "polymarket-arbitrage-sim (TypeScript)",
    root: "/path/to/project",
    queries: ["arbitrage", "strategy", "risk", "execution", "market", "config"],
  },
];

function countFilesByLanguage(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    try {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (
          entry === "node_modules" || entry === "dist" || entry === "build" ||
          entry === ".git" || entry === "target" || entry === "venv" ||
          entry === ".venv" || entry === "__pycache__" || entry === ".contextweave" ||
          entry === "coverage" || entry === ".next" || entry === ".turbo" || entry === ".cache"
        ) continue;
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) walk(full);
          else {
            const lang = detectLanguage(full);
            if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
          }
        } catch {}
      }
    } catch {}
  };
  walk(root);
  return counts;
}

function testParseIndividualFiles(root: string): ParseFailure[] {
  const failures: ParseFailure[] = [];
  const walk = (dir: string) => {
    try {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (
          entry === "node_modules" || entry === "dist" || entry === "build" ||
          entry === ".git" || entry === "target" || entry === "venv" ||
          entry === ".venv" || entry === "__pycache__" || entry === ".contextweave" ||
          entry === "coverage" || entry === ".next" || entry === ".turbo" || entry === ".cache"
        ) continue;
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) { walk(full); continue; }
          const lang = detectLanguage(full);
          if (!lang) continue;
          const content = readFileSync(full, "utf-8");
          const result = parseFile(full, content, lang);
          if (result.errors.length > 0 || result.symbols.length === 0) {
            failures.push({
              file: full.replace(root + "/", ""),
              language: lang,
              error: result.errors.join("; ") || "no symbols extracted",
              symbolCount: result.symbols.length,
              importCount: result.imports.length,
              callCount: result.calls.length,
            });
          }
        } catch {}
      }
    } catch {}
  };
  walk(root);
  return failures;
}

async function benchmarkProject(project: typeof PROJECTS[number]): Promise<ProjectResult> {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  createSchema(db);

  const langBreakdown = countFilesByLanguage(project.root);

  process.stderr.write(`\n  Indexing ${project.name}...\n`);
  const indexStart = Date.now();
  const indexResult = await indexProject(db, project.root);
  const indexTime = Date.now() - indexStart;

  process.stderr.write(`  Updating centrality...\n`);
  updateCentralityScores(db);

  const parseFailures = testParseIndividualFiles(project.root);

  process.stderr.write(`  Running capsule queries...\n`);
  const capsuleTests: CapsuleTestResult[] = [];

  for (const query of project.queries) {
    const start = Date.now();
    try {
      const capsule = generateCapsule(db, {
        query,
        tokenBudget: 4000,
        mode: "feature",
        sessionId: "bench",
        projectRoot: project.root,
      });
      const timeMs = Date.now() - start;

      const topSymbols = capsule.content
        .split("\n")
        .filter((l) => l.startsWith("## ") || l.startsWith("### "))
        .slice(0, 5)
        .map((l) => l.replace(/^#+\s*/, "").trim());

      capsuleTests.push({
        query,
        tokensUsed: capsule.metadata.tokensUsed,
        symbolCount: capsule.metadata.symbolCount,
        fileCount: capsule.metadata.fileCount,
        uncertainty: capsule.metadata.quality.uncertainty,
        pivotCoverage: capsule.metadata.quality.pivotCoverage,
        noiseRatio: capsule.metadata.quality.noiseRatio,
        timeMs,
        topSymbols,
      });
    } catch (err) {
      capsuleTests.push({
        query,
        tokensUsed: 0,
        symbolCount: 0,
        fileCount: 0,
        uncertainty: "CRASH",
        pivotCoverage: 0,
        noiseRatio: 0,
        timeMs: Date.now() - start,
        topSymbols: [String(err)],
      });
    }
  }

  db.close();

  return {
    name: project.name,
    root: project.root,
    indexTime,
    filesIndexed: indexResult.filesIndexed,
    symbolsFound: indexResult.symbolsFound,
    errors: indexResult.errors.slice(0, 10),
    languageBreakdown: langBreakdown,
    capsuleTests,
    parseFailures: parseFailures.slice(0, 20),
  };
}

async function main() {
  console.log("=" .repeat(80));
  console.log("  CONTEXTWEAVE REAL-WORLD QA BENCHMARK");
  console.log("=" .repeat(80));

  const results: ProjectResult[] = [];

  for (const project of PROJECTS) {
    try {
      const result = await benchmarkProject(project);
      results.push(result);
    } catch (err) {
      console.error(`\n  FATAL ERROR on ${project.name}: ${err}`);
      results.push({
        name: project.name,
        root: project.root,
        indexTime: 0,
        filesIndexed: 0,
        symbolsFound: 0,
        errors: [String(err)],
        languageBreakdown: {},
        capsuleTests: [],
        parseFailures: [],
      });
    }
  }

  console.log("\n");

  for (const r of results) {
    console.log("─".repeat(80));
    console.log(`  PROJECT: ${r.name}`);
    console.log("─".repeat(80));

    console.log(`\n  Index Performance:`);
    console.log(`    Files indexed:  ${r.filesIndexed}`);
    console.log(`    Symbols found:  ${r.symbolsFound}`);
    console.log(`    Index time:     ${r.indexTime}ms`);
    console.log(`    Throughput:     ${r.filesIndexed > 0 ? Math.round(r.filesIndexed / (r.indexTime / 1000)) : 0} files/sec`);

    console.log(`\n  Language Breakdown:`);
    for (const [lang, count] of Object.entries(r.languageBreakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${lang.padEnd(12)} ${count} files`);
    }

    if (r.errors.length > 0) {
      console.log(`\n  Index Errors (${r.errors.length} shown):`);
      for (const err of r.errors) {
        console.log(`    ${err.slice(0, 120)}`);
      }
    }

    if (r.parseFailures.length > 0) {
      console.log(`\n  Parse Failures (${r.parseFailures.length} files):`);
      for (const f of r.parseFailures.slice(0, 10)) {
        console.log(`    ${f.file.slice(0, 60).padEnd(62)} [${f.language}] syms=${f.symbolCount} imports=${f.importCount} calls=${f.callCount}`);
        if (f.error !== "no symbols extracted") {
          console.log(`      Error: ${f.error.slice(0, 100)}`);
        }
      }
    }

    console.log(`\n  Capsule Quality Tests:`);
    console.log(`    ${"Query".padEnd(22)} ${"Tokens".padEnd(8)} ${"Syms".padEnd(6)} ${"Files".padEnd(7)} ${"Uncert".padEnd(8)} ${"PivotCov".padEnd(10)} ${"Noise".padEnd(8)} ${"Time".padEnd(8)}`);
    console.log(`    ${"─".repeat(85)}`);
    for (const t of r.capsuleTests) {
      const status = t.uncertainty === "CRASH" ? "CRASH" :
                     t.uncertainty === "high" && t.symbolCount === 0 ? "MISS" :
                     t.uncertainty === "low" ? "GOOD" :
                     t.uncertainty === "medium" ? "OK" : "WEAK";
      console.log(
        `    ${t.query.padEnd(22)} ${String(t.tokensUsed).padEnd(8)} ${String(t.symbolCount).padEnd(6)} ${String(t.fileCount).padEnd(7)} ${status.padEnd(8)} ${(t.pivotCoverage * 100).toFixed(0).padStart(3)}%      ${(t.noiseRatio * 100).toFixed(0).padStart(3)}%     ${t.timeMs}ms`
      );
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("  SUMMARY");
  console.log("=".repeat(80));

  let totalFiles = 0, totalSymbols = 0, totalCapsules = 0, totalCrashes = 0, totalMisses = 0, totalGood = 0;
  const allParseFailures: number[] = [];

  for (const r of results) {
    totalFiles += r.filesIndexed;
    totalSymbols += r.symbolsFound;
    allParseFailures.push(r.parseFailures.length);
    for (const t of r.capsuleTests) {
      totalCapsules++;
      if (t.uncertainty === "CRASH") totalCrashes++;
      else if (t.symbolCount === 0) totalMisses++;
      else if (t.uncertainty === "low") totalGood++;
    }
  }

  console.log(`\n  Total files indexed:     ${totalFiles}`);
  console.log(`  Total symbols extracted: ${totalSymbols}`);
  console.log(`  Parse failure files:     ${allParseFailures.reduce((a, b) => a + b, 0)}`);
  console.log(`  Capsule queries run:     ${totalCapsules}`);
  console.log(`  Capsule results:         ${totalGood} good / ${totalCapsules - totalGood - totalCrashes - totalMisses} ok / ${totalMisses} misses / ${totalCrashes} crashes`);
  console.log(`\n  Overall status: ${totalCrashes > 0 ? "FAILURES DETECTED" : totalMisses > totalCapsules * 0.5 ? "HIGH MISS RATE" : "OPERATIONAL"}`);
  console.log("");
}

main().catch(console.error);
