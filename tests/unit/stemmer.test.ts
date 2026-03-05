import { describe, it, expect } from "vitest";
import { stem } from "../../src/utils/stemmer.js";

describe("Porter Stemmer", () => {
  it("stems regular -ing words", () => {
    expect(stem("caching")).toBe("cach");
    expect(stem("running")).toBe("run");
    expect(stem("connecting")).toBe("connect");
    expect(stem("processing")).toBe("process");
  });

  it("stems regular -ed words", () => {
    expect(stem("cached")).toBe("cach");
    expect(stem("connected")).toBe("connect");
    expect(stem("processed")).toBe("process");
    expect(stem("walked")).toBe("walk");
  });

  it("stems regular -es/-s words", () => {
    expect(stem("caches")).toBe("cach");
    expect(stem("processes")).toBe("process");
    expect(stem("connections")).toBe("connect");
    expect(stem("tokens")).toBe("token");
  });

  it("stems -tion/-sion words", () => {
    expect(stem("authentication")).toBe("authent");
    expect(stem("connection")).toBe("connect");
    expect(stem("validation")).toBe("valid");
  });

  it("stems -ment words", () => {
    expect(stem("management")).toBe("manag");
    expect(stem("deployment")).toBe("deploy");
  });

  it("stems -ness words", () => {
    expect(stem("staleness")).toBe("stale");
    expect(stem("darkness")).toBe("dark");
  });

  it("stems -ly words", () => {
    expect(stem("quickly")).toBe("quick");
    expect(stem("manually")).toBe("manual");
  });

  it("returns short words unchanged", () => {
    expect(stem("a")).toBe("a");
    expect(stem("an")).toBe("an");
    expect(stem("db")).toBe("db");
  });

  it("returns already-stemmed words unchanged or stable", () => {
    expect(stem("auth")).toBe("auth");
    expect(stem("jwt")).toBe("jwt");
    expect(stem("sql")).toBe("sql");
    expect(stem("api")).toBe("api");
  });

  it("handles camelCase tokens (pre-lowered)", () => {
    expect(stem("validate")).toBe("valid");
    expect(stem("handler")).toBe("handler");
  });

  it("is idempotent — stemming a stem returns the same value", () => {
    const words = ["caching", "authentication", "connection", "running", "tokens"];
    for (const word of words) {
      const once = stem(word);
      const twice = stem(once);
      expect(twice).toBe(once);
    }
  });
});
