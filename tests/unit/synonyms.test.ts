import { describe, it, expect } from "vitest";
import { expandQueryWithSynonyms } from "../../src/utils/synonyms.js";

describe("expandQueryWithSynonyms", () => {
  it("returns original terms when no synonyms match", () => {
    const result = expandQueryWithSynonyms(["foobar"]);
    expect(result).toEqual(["foobar"]);
  });

  it("expands auth to login/signin/sso/oauth variants", () => {
    const result = expandQueryWithSynonyms(["auth"]);
    expect(result).toContain("auth");
    expect(result).toContain("authentication");
    expect(result).toContain("login");
    expect(result).toContain("signin");
    expect(result).toContain("sso");
    expect(result).toContain("oauth");
  });

  it("expands notification to toast/alert variants", () => {
    const result = expandQueryWithSynonyms(["notification"]);
    expect(result).toContain("toast");
    expect(result).toContain("alert");
    expect(result).toContain("banner");
  });

  it("handles case-insensitive input", () => {
    const result = expandQueryWithSynonyms(["Auth"]);
    expect(result).toContain("auth");
    expect(result).toContain("login");
  });

  it("deduplicates when multiple terms share synonyms", () => {
    const result = expandQueryWithSynonyms(["auth", "login"]);
    const unique = new Set(result);
    expect(result.length).toBe(unique.size);
  });

  it("expands config synonyms", () => {
    const result = expandQueryWithSynonyms(["config"]);
    expect(result).toContain("configuration");
    expect(result).toContain("settings");
    expect(result).toContain("preferences");
  });

  it("preserves non-synonym terms alongside expansions", () => {
    const result = expandQueryWithSynonyms(["auth", "service"]);
    expect(result).toContain("service");
    expect(result).toContain("auth");
    expect(result).toContain("login");
  });
});
