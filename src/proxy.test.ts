import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "./proxy";

describe("proxy matcher", () => {
  it.each([
    ["/api/health", false],
    ["/api/health?x=1", false],
    ["/api/webhooks/resend", false],
    ["/api/healthz", true],
    ["/api/health/x", true],
    ["/api/mcp", false],
    ["/api/mcpx", true],
    ["/dashboard", true],
  ])("%s runs the session proxy: %s", (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });
});
