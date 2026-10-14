export const APP_ENVIRONMENTS = ["local", "production"] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/** Explicit deployment environment; NODE_ENV is always production on Vercel. */
export function appEnvironment(): AppEnvironment {
  const value = process.env.APP_ENV;
  if (APP_ENVIRONMENTS.some((candidate) => candidate === value)) {
    return value as AppEnvironment;
  }
  throw new Error(
    `APP_ENV must be one of: ${APP_ENVIRONMENTS.join(", ")}. Received: ${value ?? "<missing>"}`,
  );
}

export function isProductionEnvironment(): boolean {
  return appEnvironment() === "production";
}
