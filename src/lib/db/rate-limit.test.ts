import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  it("allows calls up to the limit, then refuses", async () => {
    const key = `rate-limit-test:${randomUUID()}`;
    expect(await checkRateLimit(key, 2, 60)).toBe(true);
    expect(await checkRateLimit(key, 2, 60)).toBe(true);
    expect(await checkRateLimit(key, 2, 60)).toBe(false);
  });
});
