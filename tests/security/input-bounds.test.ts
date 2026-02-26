import { describe, it, expect } from "vitest";
import { z } from "zod/v3";

describe("input validation bounds", () => {
  const capsuleSchema = z.object({
    query: z.string(),
    token_budget: z.number().min(100).max(100000).optional(),
    mode: z.enum(["debug", "refactor", "feature", "review"]).optional(),
  });

  const impactSchema = z.object({
    target: z.string(),
    depth: z.number().min(1).max(20).optional(),
  });

  const flowSchema = z.object({
    source: z.string(),
    target: z.string().optional(),
    max_hops: z.number().min(1).max(20).optional(),
  });

  const recallSchema = z.object({
    query: z.string(),
    scope: z.string().optional(),
    include_stale: z.boolean().optional(),
    limit: z.number().min(1).max(500).optional(),
  });

  const rememberSchema = z.object({
    scope: z.string().max(100),
    note: z.string().max(10000),
    symbol: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  });

  it("rejects token_budget above 100000", () => {
    expect(() => capsuleSchema.parse({ query: "test", token_budget: 10_000_000 })).toThrow();
  });

  it("rejects token_budget below 100", () => {
    expect(() => capsuleSchema.parse({ query: "test", token_budget: 50 })).toThrow();
  });

  it("accepts valid token_budget", () => {
    expect(() => capsuleSchema.parse({ query: "test", token_budget: 4000 })).not.toThrow();
  });

  it("rejects depth above 20", () => {
    expect(() => impactSchema.parse({ target: "foo", depth: 100 })).toThrow();
  });

  it("rejects depth below 1", () => {
    expect(() => impactSchema.parse({ target: "foo", depth: 0 })).toThrow();
  });

  it("rejects max_hops above 20", () => {
    expect(() => flowSchema.parse({ source: "foo", max_hops: 1000 })).toThrow();
  });

  it("rejects recall limit above 500", () => {
    expect(() => recallSchema.parse({ query: "test", limit: 1000 })).toThrow();
  });

  it("rejects overly long note", () => {
    const longNote = "x".repeat(10001);
    expect(() => rememberSchema.parse({ scope: "test", note: longNote })).toThrow();
  });

  it("rejects overly long scope", () => {
    const longScope = "x".repeat(101);
    expect(() => rememberSchema.parse({ scope: longScope, note: "test" })).toThrow();
  });

  it("accepts all valid inputs", () => {
    expect(() => capsuleSchema.parse({ query: "test" })).not.toThrow();
    expect(() => impactSchema.parse({ target: "foo" })).not.toThrow();
    expect(() => flowSchema.parse({ source: "bar" })).not.toThrow();
    expect(() => recallSchema.parse({ query: "x", limit: 100 })).not.toThrow();
    expect(() => rememberSchema.parse({ scope: "arch", note: "something important" })).not.toThrow();
  });
});
