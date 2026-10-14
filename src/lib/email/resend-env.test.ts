import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailDryRun } from "./resend";

describe("isEmailDryRun", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows dry-run email locally", () => {
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("EMAIL_DRY_RUN", "1");
    expect(isEmailDryRun()).toBe(true);
  });

  it("never allows dry-run email in production", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("EMAIL_DRY_RUN", "1");
    expect(isEmailDryRun()).toBe(false);
  });
});
