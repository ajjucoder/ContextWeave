import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";

const log = createLogger("repo-profiler");

export type ArchLayer =
  | "storage"
  | "server"
  | "api-route"
  | "client-fetch"
  | "state"
  | "ui-component"
  | "config";

export interface RetrievalLane {
  name: string;
  layer: ArchLayer;
  pathPrefixes: string[];
  fileGlobs: string[];
  priority: number;
}

export interface RepoProfile {
  projectTypes: string[];
  frameworks: string[];
  backendRoots: string[];
  frontendRoots: string[];
  layers: ArchLayer[];
  lanes: RetrievalLane[];
  detectedAt: number;
}

interface MarkerRule {
  file: string;
  check?: (content: string, projectRoot: string) => string | null;
  framework: string;
  projectType: string;
}

const MARKER_RULES: MarkerRule[] = [
  { file: "next.config.js", framework: "nextjs", projectType: "fullstack" },
  { file: "next.config.mjs", framework: "nextjs", projectType: "fullstack" },
  { file: "next.config.ts", framework: "nextjs", projectType: "fullstack" },
  { file: "nuxt.config.ts", framework: "nuxt", projectType: "fullstack" },
  { file: "nuxt.config.js", framework: "nuxt", projectType: "fullstack" },
  { file: "angular.json", framework: "angular", projectType: "frontend" },
  { file: "svelte.config.js", framework: "sveltekit", projectType: "fullstack" },
  { file: "svelte.config.ts", framework: "sveltekit", projectType: "fullstack" },
  { file: "astro.config.mjs", framework: "astro", projectType: "frontend" },
  { file: "astro.config.ts", framework: "astro", projectType: "frontend" },
  { file: "remix.config.js", framework: "remix", projectType: "fullstack" },
  { file: "remix.config.ts", framework: "remix", projectType: "fullstack" },
  { file: "Cargo.toml", framework: "rust", projectType: "backend" },
  { file: "go.mod", framework: "go", projectType: "backend" },
  { file: "pom.xml", framework: "spring", projectType: "backend" },
  { file: "build.gradle", framework: "spring", projectType: "backend" },
  { file: "build.gradle.kts", framework: "spring", projectType: "backend" },
  { file: "Gemfile", framework: "rails", projectType: "backend" },
  { file: "composer.json", framework: "laravel", projectType: "backend" },
  { file: "pyproject.toml", framework: "python", projectType: "backend" },
  { file: "setup.py", framework: "python", projectType: "backend" },
  { file: "requirements.txt", framework: "python", projectType: "backend" },
  { file: "manage.py", framework: "django", projectType: "backend" },
  { file: "settings.py", framework: "django", projectType: "backend" },
  {
    file: "package.json",
    framework: "",
    projectType: "",
    check: (content) => {
      try {
        const pkg = JSON.parse(content) as {
          name?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if ("express" in allDeps) return "express";
        if ("fastify" in allDeps) return "fastify";
        if ("@nestjs/core" in allDeps) return "nestjs";
        if ("hono" in allDeps) return "hono";
        if ("koa" in allDeps) return "koa";
        if ("@hapi/hapi" in allDeps) return "hapi";
        if ("react" in allDeps && !("next" in allDeps)) return "react";
        if ("vue" in allDeps && !("nuxt" in allDeps)) return "vue";
        if ("svelte" in allDeps && !("@sveltejs/kit" in allDeps)) return "svelte";
        if ("@supabase/supabase-js" in allDeps) return "supabase";
        if ("prisma" in allDeps || "@prisma/client" in allDeps) return "prisma";
        if ("drizzle-orm" in allDeps) return "drizzle";

        const rootPackageName = pkg.name?.split("/").pop();
        if (rootPackageName === "express") return "express";
        if (rootPackageName === "fastify") return "fastify";
        if (rootPackageName === "koa") return "koa";
        if (rootPackageName === "hono") return "hono";
        if (rootPackageName === "hapi") return "hapi";
      } catch {
        return null;
      }
      return null;
    },
  },
];

interface FrameworkLaneConfig {
  lanes: RetrievalLane[];
  backendRoots: string[];
  frontendRoots: string[];
  layers: ArchLayer[];
}

const FRAMEWORK_LANE_CONFIGS: Record<string, FrameworkLaneConfig> = {
  nextjs: {
    lanes: [
      { name: "pages", layer: "ui-component", pathPrefixes: ["app/", "pages/", "src/app/", "src/pages/"], fileGlobs: ["**/*.tsx", "**/*.jsx"], priority: 0.9 },
      { name: "api-routes", layer: "api-route", pathPrefixes: ["app/api/", "pages/api/", "src/app/api/"], fileGlobs: ["**/route.ts", "**/route.tsx"], priority: 0.85 },
      { name: "components", layer: "ui-component", pathPrefixes: ["components/", "src/components/"], fileGlobs: ["**/*.tsx", "**/*.jsx"], priority: 0.8 },
      { name: "lib", layer: "client-fetch", pathPrefixes: ["lib/", "src/lib/", "utils/", "src/utils/"], fileGlobs: ["**/*.ts"], priority: 0.7 },
      { name: "server-actions", layer: "server", pathPrefixes: ["actions/", "src/actions/"], fileGlobs: ["**/*.ts"], priority: 0.75 },
    ],
    backendRoots: ["app/api", "pages/api", "src/app/api"],
    frontendRoots: ["app", "pages", "components", "src/app", "src/components"],
    layers: ["ui-component", "api-route", "client-fetch", "server", "storage"],
  },
  express: {
    lanes: [
      { name: "core-lib", layer: "server", pathPrefixes: ["lib/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.92 },
      { name: "routes", layer: "api-route", pathPrefixes: ["routes/", "src/routes/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.9 },
      { name: "controllers", layer: "server", pathPrefixes: ["controllers/", "src/controllers/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.85 },
      { name: "services", layer: "server", pathPrefixes: ["services/", "src/services/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.8 },
      { name: "models", layer: "storage", pathPrefixes: ["models/", "src/models/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.75 },
      { name: "middleware", layer: "server", pathPrefixes: ["middleware/", "src/middleware/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.7 },
    ],
    backendRoots: ["src", "routes", "controllers"],
    frontendRoots: [],
    layers: ["api-route", "server", "storage"],
  },
  fastify: {
    lanes: [
      { name: "core-lib", layer: "server", pathPrefixes: ["lib/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.92 },
      { name: "routes", layer: "api-route", pathPrefixes: ["routes/", "src/routes/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.9 },
      { name: "plugins", layer: "server", pathPrefixes: ["plugins/", "src/plugins/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.85 },
      { name: "services", layer: "server", pathPrefixes: ["services/", "src/services/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.8 },
      { name: "schemas", layer: "storage", pathPrefixes: ["schemas/", "src/schemas/"], fileGlobs: ["**/*.ts", "**/*.js"], priority: 0.75 },
    ],
    backendRoots: ["src", "routes", "plugins"],
    frontendRoots: [],
    layers: ["api-route", "server", "storage"],
  },
  nestjs: {
    lanes: [
      { name: "controllers", layer: "api-route", pathPrefixes: ["src/"], fileGlobs: ["**/*.controller.ts"], priority: 0.9 },
      { name: "services", layer: "server", pathPrefixes: ["src/"], fileGlobs: ["**/*.service.ts"], priority: 0.85 },
      { name: "modules", layer: "config", pathPrefixes: ["src/"], fileGlobs: ["**/*.module.ts"], priority: 0.8 },
      { name: "entities", layer: "storage", pathPrefixes: ["src/"], fileGlobs: ["**/*.entity.ts", "**/*.dto.ts"], priority: 0.75 },
      { name: "guards", layer: "server", pathPrefixes: ["src/"], fileGlobs: ["**/*.guard.ts", "**/*.interceptor.ts"], priority: 0.7 },
    ],
    backendRoots: ["src"],
    frontendRoots: [],
    layers: ["api-route", "server", "storage", "config"],
  },
  spring: {
    lanes: [
      { name: "controllers", layer: "api-route", pathPrefixes: ["src/main/java/"], fileGlobs: ["**/*Controller.java", "**/*Resource.java"], priority: 0.9 },
      { name: "services", layer: "server", pathPrefixes: ["src/main/java/"], fileGlobs: ["**/*Service.java", "**/*ServiceImpl.java"], priority: 0.85 },
      { name: "repositories", layer: "storage", pathPrefixes: ["src/main/java/"], fileGlobs: ["**/*Repository.java", "**/*Dao.java"], priority: 0.8 },
      { name: "entities", layer: "storage", pathPrefixes: ["src/main/java/"], fileGlobs: ["**/*Entity.java", "**/*Model.java"], priority: 0.75 },
      { name: "config", layer: "config", pathPrefixes: ["src/main/java/", "src/main/resources/"], fileGlobs: ["**/*Config.java", "**/*.yml", "**/*.yaml"], priority: 0.7 },
    ],
    backendRoots: ["src/main/java"],
    frontendRoots: [],
    layers: ["api-route", "server", "storage", "config"],
  },
  django: {
    lanes: [
      { name: "views", layer: "api-route", pathPrefixes: [], fileGlobs: ["**/views.py", "**/views/*.py"], priority: 0.9 },
      { name: "models", layer: "storage", pathPrefixes: [], fileGlobs: ["**/models.py", "**/models/*.py"], priority: 0.85 },
      { name: "serializers", layer: "server", pathPrefixes: [], fileGlobs: ["**/serializers.py", "**/serializers/*.py"], priority: 0.8 },
      { name: "urls", layer: "api-route", pathPrefixes: [], fileGlobs: ["**/urls.py"], priority: 0.75 },
      { name: "admin", layer: "config", pathPrefixes: [], fileGlobs: ["**/admin.py"], priority: 0.7 },
    ],
    backendRoots: [],
    frontendRoots: [],
    layers: ["api-route", "server", "storage", "config"],
  },
  rails: {
    lanes: [
      { name: "controllers", layer: "api-route", pathPrefixes: ["app/controllers/"], fileGlobs: ["**/*_controller.rb"], priority: 0.9 },
      { name: "models", layer: "storage", pathPrefixes: ["app/models/"], fileGlobs: ["**/*.rb"], priority: 0.85 },
      { name: "views", layer: "ui-component", pathPrefixes: ["app/views/"], fileGlobs: ["**/*.erb", "**/*.haml"], priority: 0.8 },
      { name: "services", layer: "server", pathPrefixes: ["app/services/"], fileGlobs: ["**/*.rb"], priority: 0.75 },
      { name: "config", layer: "config", pathPrefixes: ["config/"], fileGlobs: ["**/*.rb", "**/*.yml"], priority: 0.7 },
    ],
    backendRoots: ["app"],
    frontendRoots: ["app/views"],
    layers: ["api-route", "server", "storage", "ui-component", "config"],
  },
  react: {
    lanes: [
      { name: "components", layer: "ui-component", pathPrefixes: ["src/components/", "components/"], fileGlobs: ["**/*.tsx", "**/*.jsx"], priority: 0.9 },
      { name: "hooks", layer: "client-fetch", pathPrefixes: ["src/hooks/", "hooks/"], fileGlobs: ["**/*.ts", "**/*.tsx"], priority: 0.85 },
      { name: "pages", layer: "ui-component", pathPrefixes: ["src/pages/", "pages/"], fileGlobs: ["**/*.tsx", "**/*.jsx"], priority: 0.8 },
      { name: "store", layer: "state", pathPrefixes: ["src/store/", "src/state/", "store/"], fileGlobs: ["**/*.ts"], priority: 0.75 },
      { name: "api", layer: "client-fetch", pathPrefixes: ["src/api/", "src/services/", "api/"], fileGlobs: ["**/*.ts"], priority: 0.7 },
    ],
    backendRoots: [],
    frontendRoots: ["src", "components"],
    layers: ["ui-component", "client-fetch", "state"],
  },
  rust: {
    lanes: [
      { name: "handlers", layer: "api-route", pathPrefixes: ["src/handlers/", "src/routes/"], fileGlobs: ["**/*.rs"], priority: 0.9 },
      { name: "models", layer: "storage", pathPrefixes: ["src/models/", "src/entities/"], fileGlobs: ["**/*.rs"], priority: 0.85 },
      { name: "services", layer: "server", pathPrefixes: ["src/services/"], fileGlobs: ["**/*.rs"], priority: 0.8 },
      { name: "lib", layer: "server", pathPrefixes: ["src/"], fileGlobs: ["**/lib.rs", "**/mod.rs"], priority: 0.7 },
    ],
    backendRoots: ["src"],
    frontendRoots: [],
    layers: ["api-route", "server", "storage"],
  },
  go: {
    lanes: [
      { name: "handlers", layer: "api-route", pathPrefixes: ["handlers/", "api/", "internal/api/"], fileGlobs: ["**/*.go"], priority: 0.9 },
      { name: "models", layer: "storage", pathPrefixes: ["models/", "internal/models/"], fileGlobs: ["**/*.go"], priority: 0.85 },
      { name: "services", layer: "server", pathPrefixes: ["services/", "internal/services/", "pkg/"], fileGlobs: ["**/*.go"], priority: 0.8 },
      { name: "cmd", layer: "config", pathPrefixes: ["cmd/"], fileGlobs: ["**/*.go"], priority: 0.7 },
    ],
    backendRoots: ["cmd", "internal", "pkg"],
    frontendRoots: [],
    layers: ["api-route", "server", "storage", "config"],
  },
};

function detectMarkers(projectRoot: string): { frameworks: string[]; projectTypes: string[] } {
  const frameworks = new Set<string>();
  const projectTypes = new Set<string>();

  for (const rule of MARKER_RULES) {
    const filePath = resolve(projectRoot, rule.file);
    if (!existsSync(filePath)) continue;

    if (rule.check) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const result = rule.check(content, projectRoot);
        if (result) {
          frameworks.add(result);
          if (FRAMEWORK_LANE_CONFIGS[result]) {
            const config = FRAMEWORK_LANE_CONFIGS[result]!;
            if (config.frontendRoots.length > 0 && config.backendRoots.length > 0) {
              projectTypes.add("fullstack");
            } else if (config.frontendRoots.length > 0) {
              projectTypes.add("frontend");
            } else {
              projectTypes.add("backend");
            }
          }
        }
      } catch {
        continue;
      }
    } else {
      frameworks.add(rule.framework);
      projectTypes.add(rule.projectType);
    }
  }

  return {
    frameworks: [...frameworks],
    projectTypes: [...projectTypes],
  };
}

function detectMonorepoPackages(projectRoot: string): Array<{ path: string; frameworks: string[] }> {
  const packageDirs = ["packages", "apps", "services", "modules"];
  const results: Array<{ path: string; frameworks: string[] }> = [];

  for (const dir of packageDirs) {
    const dirPath = resolve(projectRoot, dir);
    if (!existsSync(dirPath)) continue;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subPath = join(dir, entry.name);
        const subRoot = resolve(projectRoot, subPath);
        const { frameworks } = detectMarkers(subRoot);
        if (frameworks.length > 0) {
          results.push({ path: subPath, frameworks });
        }
      }
    } catch {
      continue;
    }
  }

  return results;
}

function buildLanesForFrameworks(frameworks: string[]): RetrievalLane[] {
  const lanes: RetrievalLane[] = [];
  const seenNames = new Set<string>();

  for (const fw of frameworks) {
    const config = FRAMEWORK_LANE_CONFIGS[fw];
    if (!config) continue;

    for (const lane of config.lanes) {
      const key = `${lane.name}-${lane.layer}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      lanes.push(lane);
    }
  }

  return lanes.sort((a, b) => b.priority - a.priority);
}

function collectLayersForFrameworks(frameworks: string[]): ArchLayer[] {
  const layers = new Set<ArchLayer>();
  for (const fw of frameworks) {
    const config = FRAMEWORK_LANE_CONFIGS[fw];
    if (!config) continue;
    for (const layer of config.layers) {
      layers.add(layer);
    }
  }
  return [...layers];
}

function collectRootsForFrameworks(frameworks: string[], type: "backend" | "frontend"): string[] {
  const roots = new Set<string>();
  for (const fw of frameworks) {
    const config = FRAMEWORK_LANE_CONFIGS[fw];
    if (!config) continue;
    const source = type === "backend" ? config.backendRoots : config.frontendRoots;
    for (const root of source) {
      roots.add(root);
    }
  }
  return [...roots];
}

export function profileRepo(projectRoot: string): RepoProfile {
  const { frameworks, projectTypes } = detectMarkers(projectRoot);
  const monorepoPackages = detectMonorepoPackages(projectRoot);

  const allFrameworks = [...frameworks];
  for (const pkg of monorepoPackages) {
    for (const fw of pkg.frameworks) {
      if (!allFrameworks.includes(fw)) allFrameworks.push(fw);
    }
  }

  const lanes = buildLanesForFrameworks(allFrameworks);
  const layers = collectLayersForFrameworks(allFrameworks);
  const backendRoots = collectRootsForFrameworks(allFrameworks, "backend");
  const frontendRoots = collectRootsForFrameworks(allFrameworks, "frontend");

  for (const pkg of monorepoPackages) {
    for (const lane of buildLanesForFrameworks(pkg.frameworks)) {
      const prefixed: RetrievalLane = {
        ...lane,
        pathPrefixes: lane.pathPrefixes.map((p) => `${pkg.path}/${p}`),
        name: `${pkg.path}/${lane.name}`,
      };
      lanes.push(prefixed);
    }
  }

  const profile: RepoProfile = {
    projectTypes: [...new Set(projectTypes)],
    frameworks: allFrameworks,
    backendRoots,
    frontendRoots,
    layers,
    lanes,
    detectedAt: Date.now(),
  };

  log.info("repo profile detected", {
    projectTypes: profile.projectTypes,
    frameworks: profile.frameworks,
    laneCount: profile.lanes.length,
    layerCount: profile.layers.length,
  });

  return profile;
}

export function persistProfile(db: Database.Database, projectRoot: string, profile: RepoProfile): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS repo_profile (
      project_root TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      detected_at  INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO repo_profile (project_root, profile_json, detected_at)
    VALUES (?, ?, ?)
  `).run(projectRoot, JSON.stringify(profile), profile.detectedAt);
}

export function loadProfile(db: Database.Database, projectRoot: string): RepoProfile | null {
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='repo_profile'"
    ).get();
    if (!tableExists) return null;

    const row = db.prepare(
      "SELECT profile_json FROM repo_profile WHERE project_root = ?"
    ).get(projectRoot) as { profile_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.profile_json) as RepoProfile;
  } catch {
    return null;
  }
}

export function getRetrievalLanes(db: Database.Database, projectRoot: string): RetrievalLane[] {
  const profile = loadProfile(db, projectRoot);
  return profile?.lanes ?? [];
}

export function getExpectedLayers(db: Database.Database, projectRoot: string): ArchLayer[] {
  const profile = loadProfile(db, projectRoot);
  return profile?.layers ?? [];
}

export function getLaneWeightForPath(lanes: RetrievalLane[], filePath: string): number {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

  let maxPriority = 0;
  for (const lane of lanes) {
    for (const prefix of lane.pathPrefixes) {
      if (normalized.startsWith(prefix.toLowerCase())) {
        maxPriority = Math.max(maxPriority, lane.priority);
      }
    }
  }

  return maxPriority > 0 ? 1 + maxPriority : 1;
}

export function classifyFileLayer(lanes: RetrievalLane[], filePath: string): ArchLayer | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

  let bestLane: RetrievalLane | null = null;
  let bestPriority = 0;

  for (const lane of lanes) {
    for (const prefix of lane.pathPrefixes) {
      if (normalized.startsWith(prefix.toLowerCase()) && lane.priority > bestPriority) {
        bestLane = lane;
        bestPriority = lane.priority;
      }
    }
  }

  return bestLane?.layer ?? null;
}

export function formatRepoProfile(profile: RepoProfile): string[] {
  const lines: string[] = [];
  if (profile.frameworks.length > 0) {
    lines.push(`Frameworks: ${profile.frameworks.join(", ")}`);
  }
  if (profile.projectTypes.length > 0) {
    lines.push(`Project types: ${profile.projectTypes.join(", ")}`);
  }
  if (profile.layers.length > 0) {
    lines.push(`Architectural layers: ${profile.layers.join(", ")}`);
  }
  if (profile.lanes.length > 0) {
    lines.push(`Retrieval lanes: ${profile.lanes.slice(0, 8).map((l) => l.name).join(", ")}${profile.lanes.length > 8 ? ` (+${profile.lanes.length - 8} more)` : ""}`);
  }
  if (profile.backendRoots.length > 0) {
    lines.push(`Backend roots: ${profile.backendRoots.join(", ")}`);
  }
  if (profile.frontendRoots.length > 0) {
    lines.push(`Frontend roots: ${profile.frontendRoots.join(", ")}`);
  }
  return lines;
}
