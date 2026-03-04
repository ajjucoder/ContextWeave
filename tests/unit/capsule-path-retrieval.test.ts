import { describe, it, expect } from "vitest";
import { extractPathTerms, filePathMatchesQueryTerms } from "../../src/utils/path-retrieval.js";

describe("extractPathTerms", () => {
  it("splits on slashes, hyphens, underscores, and dots in directory names", () => {
    const terms = extractPathTerms("api/submit-inquiry/route.ts");
    expect(terms).toContain("api");
    expect(terms).toContain("submit");
    expect(terms).toContain("inquiry");
    expect(terms).toContain("route");
  });

  it("strips the file extension", () => {
    const terms = extractPathTerms("src/auth/login.ts");
    expect(terms).not.toContain("ts");
    expect(terms).toContain("auth");
    expect(terms).toContain("login");
  });

  it("filters out tokens shorter than 3 chars", () => {
    const terms = extractPathTerms("a/bb/ccc/dddd.ts");
    expect(terms).not.toContain("a");
    expect(terms).not.toContain("bb");
    expect(terms).toContain("ccc");
    expect(terms).toContain("dddd");
  });

  it("lowercases all tokens and splits CamelCase segments", () => {
    const terms = extractPathTerms("src/Auth/LoginPage.tsx");
    expect(terms).toContain("auth");
    // CamelCase splitting: LoginPage → "login", "page"
    expect(terms).toContain("login");
    expect(terms).toContain("page");
    expect(terms).not.toContain("loginpage");
  });

  it("handles underscore-separated names", () => {
    const terms = extractPathTerms("src/email_notification/handler.ts");
    expect(terms).toContain("email");
    expect(terms).toContain("notification");
    expect(terms).toContain("handler");
  });
});

describe("filePathMatchesQueryTerms", () => {
  it("matches when a specific query term (>=6 chars) appears as a path segment", () => {
    expect(
      filePathMatchesQueryTerms("api/submit-inquiry/route.ts", ["inquiry", "email", "notification", "flow"])
    ).toBe(true);
  });

  it("matches when 2+ query terms appear in path segments", () => {
    expect(
      filePathMatchesQueryTerms("src/auth/login.ts", ["auth", "login"])
    ).toBe(true);
  });

  it("matches when a path segment contains the query term as a substring", () => {
    // "notifications".includes("notification") → true
    expect(
      filePathMatchesQueryTerms("src/notifications/handler.ts", ["notification", "send"])
    ).toBe(true);
  });

  it("does not match when no query terms appear in path segments", () => {
    expect(
      filePathMatchesQueryTerms("src/components/ServicesRoute.tsx", ["inquiry", "email"])
    ).toBe(false);
  });

  it("does not match when only 1 short term matches and no specific term matches", () => {
    expect(
      filePathMatchesQueryTerms("src/auth/login.ts", ["auth", "session", "token"])
    ).toBe(false);
  });

  it("matches email-handler path with email+notification query", () => {
    expect(
      filePathMatchesQueryTerms("src/notifications/email-handler.ts", ["email", "notification"])
    ).toBe(true);
  });

  it("does not match a generic component path for a specific domain query", () => {
    expect(
      filePathMatchesQueryTerms("src/components/button.tsx", ["inquiry", "submit"])
    ).toBe(false);
  });

  it("matches when segment contains the query term as a substring", () => {
    expect(
      filePathMatchesQueryTerms("src/submitInquiry/handler.ts", ["inquiry"])
    ).toBe(true);
  });

  it("does not false-positive short term against unrelated CamelCase segment", () => {
    // "submit" should NOT match "resubmit" as a different concept
    // With CamelCase splitting, "resubmit" stays as "resubmit" (no camel boundary)
    // and "submit" (6 chars) requires exact match with pathTerms
    expect(
      filePathMatchesQueryTerms("src/resubmit/handler.ts", ["submit"])
    ).toBe(false);
  });
});
