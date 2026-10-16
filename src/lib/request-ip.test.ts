import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { firstForwardedIp, hashedRateLimitKey } from "./request-ip";

describe("firstForwardedIp", () => {
  it("takes the first hop of a multi-hop list", () => {
    expect(firstForwardedIp("203.0.113.7, 198.51.100.1, 10.0.0.1")).toBe(
      "203.0.113.7",
    );
  });

  it("trims whitespace around the first hop", () => {
    expect(firstForwardedIp("  203.0.113.7 , 10.0.0.1")).toBe("203.0.113.7");
  });

  it("handles a single-hop header", () => {
    expect(firstForwardedIp("::1")).toBe("::1");
  });

  it('falls back to "unknown" for a missing header', () => {
    expect(firstForwardedIp(null)).toBe("unknown");
  });

  it('falls back to "unknown" for blank values', () => {
    expect(firstForwardedIp("")).toBe("unknown");
    expect(firstForwardedIp("   ")).toBe("unknown");
    expect(firstForwardedIp(" , 10.0.0.1")).toBe("unknown");
  });
});

describe("hashedRateLimitKey", () => {
  beforeEach(() => vi.stubEnv("RATE_LIMIT_SECRET", "test-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("is `${prefix}:${hmacSha256hex(secret, ip)}` — the raw IP never appears", () => {
    const key = hashedRateLimitKey("token-view", "203.0.113.7");
    const digest = createHmac("sha256", "test-secret").update("203.0.113.7").digest("hex");
    expect(key).toBe(`token-view:${digest}`);
    expect(key).not.toContain("203.0.113.7");
  });

  it("changes with the secret", () => {
    const first = hashedRateLimitKey("a", "1.1.1.1");
    vi.stubEnv("RATE_LIMIT_SECRET", "other-secret");
    expect(hashedRateLimitKey("a", "1.1.1.1")).not.toBe(first);
  });

  it("refuses to run without a secret", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "");
    expect(() => hashedRateLimitKey("a", "1.1.1.1")).toThrow("RATE_LIMIT_SECRET");
  });

  it("is deterministic and distinguishes prefixes and IPs", () => {
    expect(hashedRateLimitKey("a", "1.1.1.1")).toBe(hashedRateLimitKey("a", "1.1.1.1"));
    expect(hashedRateLimitKey("a", "1.1.1.1")).not.toBe(hashedRateLimitKey("b", "1.1.1.1"));
    expect(hashedRateLimitKey("a", "1.1.1.1")).not.toBe(hashedRateLimitKey("a", "1.1.1.2"));
  });
});
