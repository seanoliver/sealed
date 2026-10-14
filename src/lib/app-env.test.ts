import { afterEach, describe, expect, it, vi } from "vitest";
import { appEnvironment, isProductionEnvironment } from "./app-env";

describe("appEnvironment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["local", "production"] as const)(
    "accepts %s",
    (environment) => {
      vi.stubEnv("APP_ENV", environment);
      expect(appEnvironment()).toBe(environment);
    },
  );

  it.each([undefined, "preview", "staging"])("rejects %s", (environment) => {
    vi.stubEnv("APP_ENV", environment);
    expect(() => appEnvironment()).toThrow(/APP_ENV must be one of/);
  });

  it("only identifies production as production", () => {
    vi.stubEnv("APP_ENV", "local");
    expect(isProductionEnvironment()).toBe(false);
    vi.stubEnv("APP_ENV", "production");
    expect(isProductionEnvironment()).toBe(true);
  });
});
