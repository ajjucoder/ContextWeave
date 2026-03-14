import { describe, it, expect } from "vitest";
import { isNaturalLanguageQuery, expandToHypothetical } from "../../src/capsule/hyde.js";

describe("HyDE query expansion", () => {
  describe("isNaturalLanguageQuery", () => {
    it("returns false for camelCase identifiers", () => {
      expect(isNaturalLanguageQuery("getUserProfile")).toBe(false);
      expect(isNaturalLanguageQuery("handleSubmit")).toBe(false);
    });

    it("returns false for snake_case identifiers", () => {
      expect(isNaturalLanguageQuery("get_user_profile")).toBe(false);
    });

    it("returns false for dot notation", () => {
      expect(isNaturalLanguageQuery("user.profile")).toBe(false);
    });

    it("returns false for short queries", () => {
      expect(isNaturalLanguageQuery("auth")).toBe(false);
      expect(isNaturalLanguageQuery("user service")).toBe(false);
    });

    it("returns true for natural language questions", () => {
      expect(isNaturalLanguageQuery("how does authentication work across the app")).toBe(true);
      expect(isNaturalLanguageQuery("what is the data flow for user registration")).toBe(true);
      expect(isNaturalLanguageQuery("explain the error handling patterns")).toBe(true);
    });

    it("returns true for architectural queries", () => {
      expect(isNaturalLanguageQuery("architecture of the session management system")).toBe(true);
      expect(isNaturalLanguageQuery("how are database connections managed")).toBe(true);
    });
  });

  describe("expandToHypothetical", () => {
    it("generates a function signature from NL query", () => {
      const result = expandToHypothetical("how does authentication work");
      expect(result).toContain("function");
      expect(result).toContain("authenticate");
    });

    it("uses nouns as parameter names", () => {
      const result = expandToHypothetical("validate user email address");
      expect(result).toContain("function validate");
      expect(result).toContain("user");
    });

    it("handles queries with no recognized verbs", () => {
      const result = expandToHypothetical("database connection pool settings");
      expect(result).toContain("function handle");
      expect(result).toContain("database");
    });

    it("preserves original query in docstring", () => {
      const query = "how does session management work";
      const result = expandToHypothetical(query);
      expect(result).toContain("session");
      expect(result).toContain("management");
    });

    it("returns original query when no nouns extracted", () => {
      const query = "is it working";
      const result = expandToHypothetical(query);
      expect(result).toContain("working");
    });
  });
});
