import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  profileRepo,
  persistProfile,
  loadProfile,
  getRetrievalLanes,
  getExpectedLayers,
  getLaneWeightForPath,
  classifyFileLayer,
  formatRepoProfile,
  type RepoProfile,
  type RetrievalLane,
} from "../../src/core/repo-profiler.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "cw-profiler-"));
}

describe("profileRepo", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("detects Next.js project from next.config.js", () => {
    const dir = makeTempDir();
    dirs.push(dir);
    writeFileSync(join(dir, "next.config.js"), "module.exports = {};");

    const profile = profileRepo(dir);

    expect(profile.frameworks).toContain("nextjs");
    expect(profile.layers).toContain("ui-component");
    expect(profile.layers).toContain("api-route");
  });

  it("detects Express project from package.json dependencies", () => {
    const dir = makeTempDir();
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0" } })
    );

    const profile = profileRepo(dir);

    expect(profile.frameworks).toContain("express");
  });

  it("detects Spring project from pom.xml", () => {
    const dir = makeTempDir();
    dirs.push(dir);
    writeFileSync(join(dir, "pom.xml"), "<project></project>");

    const profile = profileRepo(dir);

    expect(profile.frameworks).toContain("spring");
  });

  it("detects Go project from go.mod", () => {
    const dir = makeTempDir();
    dirs.push(dir);
    writeFileSync(join(dir, "go.mod"), "module example.com/app\n\ngo 1.21");

    const profile = profileRepo(dir);

    expect(profile.frameworks).toContain("go");
  });

  it("detects Django project from manage.py", () => {
    const dir = makeTempDir();
    dirs.push(dir);
    writeFileSync(join(dir, "manage.py"), "#!/usr/bin/env python");

    const profile = profileRepo(dir);

    expect(profile.frameworks).toContain("django");
  });

  it("returns empty profile for a directory with no markers", () => {
    const dir = makeTempDir();
    dirs.push(dir);

    const profile = profileRepo(dir);

    expect(profile.frameworks).toHaveLength(0);
    expect(profile.layers).toHaveLength(0);
    expect(profile.lanes).toHaveLength(0);
  });

  it("detects monorepo packages from packages/ subdirectories", () => {
    const dir = makeTempDir();
    dirs.push(dir);

    mkdirSync(join(dir, "packages", "frontend"), { recursive: true });
    writeFileSync(join(dir, "packages", "frontend", "next.config.js"), "module.exports = {};");

    mkdirSync(join(dir, "packages", "api"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "api", "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0" } })
    );

    const profile = profileRepo(dir);

    expect(profile.frameworks).toContain("nextjs");
    expect(profile.frameworks).toContain("express");
  });
});

describe("persistProfile / loadProfile", () => {
  it("roundtrips a profile through SQLite", () => {
    const db = new Database(":memory:");

    const profile: RepoProfile = {
      projectTypes: ["fullstack"],
      frameworks: ["nextjs"],
      backendRoots: ["app/api"],
      frontendRoots: ["app", "components"],
      layers: ["ui-component", "api-route"],
      lanes: [
        {
          name: "pages",
          layer: "ui-component",
          pathPrefixes: ["app/", "pages/"],
          fileGlobs: ["**/*.tsx"],
          priority: 0.9,
        },
      ],
      detectedAt: 1700000000000,
    };

    persistProfile(db, "/test/project", profile);
    const loaded = loadProfile(db, "/test/project");

    expect(loaded).not.toBeNull();
    expect(loaded!.frameworks).toEqual(profile.frameworks);
    expect(loaded!.projectTypes).toEqual(profile.projectTypes);
    expect(loaded!.layers).toEqual(profile.layers);
    expect(loaded!.lanes).toHaveLength(1);
    expect(loaded!.lanes[0]!.name).toBe("pages");
    expect(loaded!.detectedAt).toBe(profile.detectedAt);

    db.close();
  });

  it("returns null when table does not exist", () => {
    const db = new Database(":memory:");
    const result = loadProfile(db, "/nonexistent");
    expect(result).toBeNull();
    db.close();
  });

  it("returns null when project root is not found", () => {
    const db = new Database(":memory:");
    const profile: RepoProfile = {
      projectTypes: [],
      frameworks: [],
      backendRoots: [],
      frontendRoots: [],
      layers: [],
      lanes: [],
      detectedAt: Date.now(),
    };
    persistProfile(db, "/some/project", profile);
    const result = loadProfile(db, "/other/project");
    expect(result).toBeNull();
    db.close();
  });
});

describe("getRetrievalLanes / getExpectedLayers", () => {
  it("returns lanes from a stored profile", () => {
    const db = new Database(":memory:");
    const lane: RetrievalLane = {
      name: "api-routes",
      layer: "api-route",
      pathPrefixes: ["app/api/"],
      fileGlobs: ["**/route.ts"],
      priority: 0.85,
    };
    const profile: RepoProfile = {
      projectTypes: ["fullstack"],
      frameworks: ["nextjs"],
      backendRoots: [],
      frontendRoots: [],
      layers: ["api-route"],
      lanes: [lane],
      detectedAt: Date.now(),
    };
    persistProfile(db, "/proj", profile);

    const lanes = getRetrievalLanes(db, "/proj");
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.name).toBe("api-routes");

    db.close();
  });

  it("returns empty array when no profile is stored", () => {
    const db = new Database(":memory:");
    expect(getRetrievalLanes(db, "/nowhere")).toEqual([]);
    db.close();
  });

  it("returns layers from a stored profile", () => {
    const db = new Database(":memory:");
    const profile: RepoProfile = {
      projectTypes: ["backend"],
      frameworks: ["express"],
      backendRoots: ["src"],
      frontendRoots: [],
      layers: ["api-route", "server", "storage"],
      lanes: [],
      detectedAt: Date.now(),
    };
    persistProfile(db, "/proj", profile);

    const layers = getExpectedLayers(db, "/proj");
    expect(layers).toContain("api-route");
    expect(layers).toContain("server");
    expect(layers).toContain("storage");

    db.close();
  });

  it("returns empty array when no profile is stored for getExpectedLayers", () => {
    const db = new Database(":memory:");
    expect(getExpectedLayers(db, "/nowhere")).toEqual([]);
    db.close();
  });
});

describe("getLaneWeightForPath", () => {
  const nextjsLanes: RetrievalLane[] = [
    { name: "pages", layer: "ui-component", pathPrefixes: ["app/", "pages/"], fileGlobs: ["**/*.tsx"], priority: 0.9 },
    { name: "api-routes", layer: "api-route", pathPrefixes: ["app/api/", "pages/api/"], fileGlobs: ["**/route.ts"], priority: 0.85 },
    { name: "components", layer: "ui-component", pathPrefixes: ["components/"], fileGlobs: ["**/*.tsx"], priority: 0.8 },
  ];

  it("returns weight greater than 1 for a matching path prefix", () => {
    const weight = getLaneWeightForPath(nextjsLanes, "app/page.tsx");
    expect(weight).toBeGreaterThan(1);
  });

  it("returns the highest priority match when multiple lanes match", () => {
    const weight = getLaneWeightForPath(nextjsLanes, "app/api/users/route.ts");
    expect(weight).toBe(1 + 0.9);
  });

  it("returns 1 for a path that matches no lane", () => {
    const weight = getLaneWeightForPath(nextjsLanes, "random/file.ts");
    expect(weight).toBe(1);
  });

  it("returns 1 for an empty lanes array", () => {
    expect(getLaneWeightForPath([], "app/page.tsx")).toBe(1);
  });

  it("normalizes backslashes before matching", () => {
    const weight = getLaneWeightForPath(nextjsLanes, "app\\page.tsx");
    expect(weight).toBeGreaterThan(1);
  });

  it("normalizes leading ./ before matching", () => {
    const weight = getLaneWeightForPath(nextjsLanes, "./app/page.tsx");
    expect(weight).toBeGreaterThan(1);
  });
});

describe("classifyFileLayer", () => {
  const nextjsLanes: RetrievalLane[] = [
    { name: "api-routes", layer: "api-route", pathPrefixes: ["app/api/", "pages/api/"], fileGlobs: ["**/route.ts"], priority: 0.95 },
    { name: "pages", layer: "ui-component", pathPrefixes: ["app/", "pages/"], fileGlobs: ["**/*.tsx"], priority: 0.9 },
    { name: "components", layer: "ui-component", pathPrefixes: ["components/", "src/components/"], fileGlobs: ["**/*.tsx"], priority: 0.8 },
  ];

  it("classifies an api route file correctly", () => {
    const layer = classifyFileLayer(nextjsLanes, "app/api/route.ts");
    expect(layer).toBe("api-route");
  });

  it("classifies a component file correctly", () => {
    const layer = classifyFileLayer(nextjsLanes, "components/Button.tsx");
    expect(layer).toBe("ui-component");
  });

  it("returns null for a path that matches no lane", () => {
    const layer = classifyFileLayer(nextjsLanes, "lib/random.ts");
    expect(layer).toBeNull();
  });

  it("returns null for an empty lanes array", () => {
    expect(classifyFileLayer([], "app/page.tsx")).toBeNull();
  });

  it("picks the highest priority lane when multiple prefixes match", () => {
    const layer = classifyFileLayer(nextjsLanes, "app/api/users/route.ts");
    expect(layer).toBe("api-route");
  });
});

describe("formatRepoProfile", () => {
  it("includes framework names in output", () => {
    const profile: RepoProfile = {
      projectTypes: ["fullstack"],
      frameworks: ["nextjs", "express"],
      backendRoots: ["app/api"],
      frontendRoots: ["app"],
      layers: ["ui-component", "api-route"],
      lanes: [],
      detectedAt: Date.now(),
    };

    const lines = formatRepoProfile(profile);
    const joined = lines.join("\n");

    expect(joined).toContain("nextjs");
    expect(joined).toContain("express");
  });

  it("includes project types in output", () => {
    const profile: RepoProfile = {
      projectTypes: ["backend"],
      frameworks: ["express"],
      backendRoots: ["src"],
      frontendRoots: [],
      layers: ["api-route", "server"],
      lanes: [],
      detectedAt: Date.now(),
    };

    const lines = formatRepoProfile(profile);
    const joined = lines.join("\n");

    expect(joined).toContain("backend");
  });

  it("includes architectural layers in output", () => {
    const profile: RepoProfile = {
      projectTypes: ["fullstack"],
      frameworks: ["nextjs"],
      backendRoots: [],
      frontendRoots: [],
      layers: ["ui-component", "api-route", "storage"],
      lanes: [],
      detectedAt: Date.now(),
    };

    const lines = formatRepoProfile(profile);
    const joined = lines.join("\n");

    expect(joined).toContain("ui-component");
    expect(joined).toContain("api-route");
  });

  it("returns empty array for an empty profile", () => {
    const profile: RepoProfile = {
      projectTypes: [],
      frameworks: [],
      backendRoots: [],
      frontendRoots: [],
      layers: [],
      lanes: [],
      detectedAt: Date.now(),
    };

    const lines = formatRepoProfile(profile);
    expect(lines).toHaveLength(0);
  });

  it("includes lane names when lanes are present", () => {
    const profile: RepoProfile = {
      projectTypes: ["fullstack"],
      frameworks: ["nextjs"],
      backendRoots: [],
      frontendRoots: [],
      layers: ["ui-component"],
      lanes: [
        { name: "pages", layer: "ui-component", pathPrefixes: ["app/"], fileGlobs: ["**/*.tsx"], priority: 0.9 },
      ],
      detectedAt: Date.now(),
    };

    const lines = formatRepoProfile(profile);
    const joined = lines.join("\n");

    expect(joined).toContain("pages");
  });

  it("truncates lane list and shows overflow count when more than 8 lanes", () => {
    const lanes: RetrievalLane[] = Array.from({ length: 10 }, (_, i) => ({
      name: `lane-${i}`,
      layer: "server" as const,
      pathPrefixes: [`src/lane${i}/`],
      fileGlobs: ["**/*.ts"],
      priority: 0.5,
    }));

    const profile: RepoProfile = {
      projectTypes: ["backend"],
      frameworks: ["express"],
      backendRoots: ["src"],
      frontendRoots: [],
      layers: ["server"],
      lanes,
      detectedAt: Date.now(),
    };

    const lines = formatRepoProfile(profile);
    const joined = lines.join("\n");

    expect(joined).toContain("+2 more");
  });
});
