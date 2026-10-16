import { afterEach, describe, expect, it, vi } from "vitest";
import { assertServerEnv } from "./env";

describe("assertServerEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses to start without RATE_LIMIT_SECRET", () => {
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("EMAIL_DRY_RUN", "1");
    vi.stubEnv("RATE_LIMIT_SECRET", "");
    expect(() => assertServerEnv()).toThrow(/RATE_LIMIT_SECRET/);
  });
});
