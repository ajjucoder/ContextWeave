import { describe, it, expect } from "vitest";
import { splitIdentifier } from "../../src/utils/camel-split.js";

describe("splitIdentifier", () => {
  it("splits camelCase", () => {
    expect(splitIdentifier("getUserById")).toEqual(["get", "user", "by", "id"]);
  });

  it("splits PascalCase", () => {
    expect(splitIdentifier("UserService")).toEqual(["user", "service"]);
  });

  it("splits snake_case", () => {
    expect(splitIdentifier("get_user_by_id")).toEqual(["get", "user", "by", "id"]);
  });

  it("splits SCREAMING_CASE", () => {
    expect(splitIdentifier("MAX_RETRY_COUNT")).toEqual(["max", "retry", "count"]);
  });

  it("handles acronyms: HTTPSConnection", () => {
    expect(splitIdentifier("HTTPSConnection")).toEqual(["https", "connection"]);
  });

  it("handles parseJSON", () => {
    expect(splitIdentifier("parseJSON")).toEqual(["parse", "json"]);
  });

  it("handles XMLParser", () => {
    expect(splitIdentifier("XMLParser")).toEqual(["xml", "parser"]);
  });

  it("returns [] for empty string", () => {
    expect(splitIdentifier("")).toEqual([]);
  });

  it("returns [] for single char", () => {
    expect(splitIdentifier("x")).toEqual([]);
  });

  it("handles single lowercase word", () => {
    expect(splitIdentifier("user")).toEqual(["user"]);
  });

  it("handles mixed delimiters: get-user_byId", () => {
    expect(splitIdentifier("get-user_byId")).toEqual(["get", "user", "by", "id"]);
  });

  it("handles kebab-case", () => {
    expect(splitIdentifier("my-component-name")).toEqual(["my", "component", "name"]);
  });

  it("handles dot notation", () => {
    expect(splitIdentifier("auth.middleware")).toEqual(["auth", "middleware"]);
  });

  it("deduplicates tokens", () => {
    const result = splitIdentifier("getGet");
    expect(result).toEqual(["get"]);
  });

  it("filters tokens shorter than 2 chars", () => {
    const result = splitIdentifier("a_bc");
    expect(result).not.toContain("a");
    expect(result).toContain("bc");
  });
});
