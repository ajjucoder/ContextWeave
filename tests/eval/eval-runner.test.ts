import { describe, expect, it } from "vitest";
import { runEvalSuite } from "./eval-runner.js";
import { SMALL_PROJECT_FIXTURE } from "./fixtures/small-project.js";

describe("eval runner session isolation", () => {
  it("does not let earlier queries pollute later small-project retrievals", async () => {
    const result = await runEvalSuite({ fixtures: [SMALL_PROJECT_FIXTURE], metricOptions: { fileTopK: 5 } });
    const codebase = result.codebases.find((entry) => entry.id === SMALL_PROJECT_FIXTURE.id);
    const createStack = codebase?.queries.find((query) => query.id === "sp-create-stack");
    const loginTask = codebase?.tasks.find((task) => task.id === "sp-task-login-stack");

    expect(createStack).toBeTruthy();
    expect(createStack!.metrics.consideredFiles.map((file) => file.split("/").pop())).toContain("handler.ts");
    expect(createStack!.metrics.consideredSymbols).toContain("createAuthStack");
    expect(createStack!.metrics.consideredSymbols).toContain("AuthService");
    expect(loginTask).toBeTruthy();
    expect(loginTask!.firstPassSuccess).toBe(true);
    expect(loginTask!.turnsToSuccess).toBe(1);
  });
});
