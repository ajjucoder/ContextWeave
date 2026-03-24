import { describe, expect, it } from "vitest";
import {
  ACTION_SIGNAL_TERMS,
  EXTENDED_ACTION_SIGNAL_TERMS,
  RUNTIME_QUERY_TERMS,
  isUiLikePath,
} from "../../src/capsule/signals.js";

describe("signals", () => {
  it("keeps the exported signal term sets non-empty", () => {
    expect(ACTION_SIGNAL_TERMS.size).toBeGreaterThan(0);
    expect(EXTENDED_ACTION_SIGNAL_TERMS.size).toBeGreaterThan(0);
    expect(RUNTIME_QUERY_TERMS.size).toBeGreaterThan(0);
  });

  it("classifies known UI-like paths", () => {
    expect(isUiLikePath("src/components/Button.tsx")).toBe(true);
    expect(isUiLikePath("app/dashboard/page.tsx")).toBe(true);
    expect(isUiLikePath("src/ui/dialog.ts")).toBe(true);
  });

  it("does not classify runtime-centric paths as UI-like", () => {
    expect(isUiLikePath("src/server/auth.ts")).toBe(false);
    expect(isUiLikePath("src/api/routes/users.ts")).toBe(false);
    expect(isUiLikePath("lib/services/session.ts")).toBe(false);
  });
});
