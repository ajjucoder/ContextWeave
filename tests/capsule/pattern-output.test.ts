import { describe, expect, it } from "vitest";
import type { CapsuleMetadata, FileRecord, ObservationRecord, ScoredNode, SymbolRecord } from "../../src/core/types.js";
import { formatCapsule } from "../../src/capsule/formatter.js";

function file(id: number, path: string): FileRecord {
  return {
    id,
    path,
    hash: `h-${id}`,
    lastIndexed: Date.now(),
    mtime: Date.now(),
    language: "tsx",
    symbolCount: 1,
    error: null,
  };
}

function symbol(id: number, fileId: number, name: string): SymbolRecord {
  return {
    id,
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 4,
    signature: `function ${name}()`,
    bodyHash: `b-${id}`,
    fullSource: `export default function ${name}() { return null; }`,
    isExported: true,
    docComment: null,
    centrality: 0.3,
    lastSeen: Date.now(),
  };
}

describe("formatCapsule pattern output", () => {
  it("includes overlapping broad-query patterns in the rendered capsule", () => {
    const dashboard = file(1, "src/app/dashboard/page.tsx");
    const settings = file(2, "src/app/settings/page.tsx");
    const nodes: ScoredNode[] = [
      {
        symbol: symbol(11, 1, "DashboardPage"),
        file: dashboard,
        score: 1.2,
        distance: 0,
        compressionLevel: 0,
        rendered: "dashboard-code",
        tokenCount: 50,
      },
      {
        symbol: symbol(22, 2, "SettingsPage"),
        file: settings,
        score: 1.1,
        distance: 1,
        compressionLevel: 1,
        rendered: "settings-code",
        tokenCount: 40,
      },
    ];
    const metadata: CapsuleMetadata = {
      query: "dashboard routing flow",
      mode: "feature",
      tokenBudget: 1200,
      tokensUsed: 90,
      symbolCount: 2,
      fileCount: 2,
      filesIncluded: [dashboard.path, settings.path],
      compressionBreakdown: { 0: 1, 1: 1, 2: 0, 3: 0 },
      observationCount: 0,
      quality: {
        pivotCount: 2,
        pivotsIncluded: 2,
        pivotCoverage: 1,
        dependencyCoverage: 1,
        coverageConfidence: 0.9,
        noiseRatio: 0,
        uncertaintyFlag: false,
        lowConfidence: false,
        uncertainty: "very_low",
        reasons: [],
        retrieval: { stageACandidateCount: 5, stageBSelectedCount: 2 },
      },
      strategy: {
        intent: "broad",
        mode: "multi-pass",
        subQueryCount: 2,
      },
      patterns: [
        {
          id: "page-pattern",
          name: "App Page Pattern",
          description: "Files in src/app/*/page.tsx import data-layer helpers and default-export a page component.",
          files: [
            "src/app/dashboard/page.tsx",
            "src/app/settings/page.tsx",
            "src/app/reports/page.tsx",
          ],
          confidence: 0.9,
          signature: {
            importShape: ["@/lib/data-layer", "react"],
            exportShape: ["default", "function"],
            hookUsage: ["useDataLayer", "useRouter"],
            symbolKinds: ["function"],
            directoryPattern: "src/app/*/page.tsx",
          },
        },
      ],
      generatedAt: Date.now(),
    };

    const output = formatCapsule(nodes, [] as ObservationRecord[], metadata, []);

    expect(output).toContain("--- Detected Patterns ---");
    expect(output).toContain("App Page Pattern");
    expect(output).toContain("src/app/*/page.tsx");
    expect(output).toContain("2 of 3 files in this capsule follow the pattern");
  });
});