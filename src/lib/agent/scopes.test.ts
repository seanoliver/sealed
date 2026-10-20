import { describe, expect, it } from "vitest";
import { AgentScopeError, hasScope, requireScope } from "./scopes";

describe("agent scopes", () => {
  it("grants only the scopes a token carries", () => {
    expect(hasScope(["read"], "read")).toBe(true);
    expect(hasScope(["read", "write"], "send")).toBe(false);
    expect(hasScope([], "read")).toBe(false);
  });

  it("refuses a missing scope with a message naming it", () => {
    expect(() => requireScope(["read"], "read")).not.toThrow();
    expect(() => requireScope(["read"], "write")).toThrow(AgentScopeError);
    expect(() => requireScope(["write"], "send")).toThrow('lacks the "send" scope');
  });
});
