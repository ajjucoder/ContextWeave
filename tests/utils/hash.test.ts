import { describe, expect, it } from "vitest";
import { hashFile } from "../../src/utils/hash.js";

describe("hashFile", () => {
  it("returns the expected sha256 digest for known input", () => {
    expect(hashFile("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
  });

  it("is deterministic and sensitive to content changes", () => {
    const first = hashFile("export const value = 1;\n");
    const second = hashFile("export const value = 1;\n");
    const changed = hashFile("export const value = 2;\n");

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
