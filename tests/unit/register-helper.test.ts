import { describe, it, expect, vi } from "vitest";
import { getRegisterTool } from "../../src/mcp/tools/register-helper.js";

describe("getRegisterTool", () => {
  it("returns a bound function from server.tool", () => {
    const toolSpy = vi.fn();
    const fakeServer = { tool: toolSpy } as any;

    const registerTool = getRegisterTool(fakeServer);
    registerTool("test_tool", "description", {}, () => {});

    expect(toolSpy).toHaveBeenCalledTimes(1);
    expect(toolSpy.mock.calls[0][0]).toBe("test_tool");
  });

  it("preserves 'this' context via bind", () => {
    let capturedThis: unknown;
    const fakeServer = {
      tool(..._args: any[]) {
        capturedThis = this;
      },
    } as any;

    const registerTool = getRegisterTool(fakeServer);
    registerTool("x", "y", {});

    expect(capturedThis).toBe(fakeServer);
  });
});
