import "server-only";
import { appEnvironment } from "@/lib/app-env";

/**
 * Startup assertion for required server env vars. Deliberately dumb — no
 * schema library, just presence checks with a clear error naming every
 * missing var at once (instead of failing one-at-a-time deep in a request,
 * e.g. APP_URL silently producing "undefined/u/<token>" links).
 *
 * Called from src/lib/db/admin.ts module init: every server path that can
 * touch data imports the db layer (directly or transitively), so a
 * misconfigured deployment fails loudly at first touch.
 */

const ALWAYS_REQUIRED = [
  "APP_ENV",
  "APP_URL",
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/**
 * Only needed when emails actually go out (see isEmailDryRun in
 * email/resend.ts). RESEND_WEBHOOK_SECRET belongs to this group: real sends
 * produce status webhooks, and without the secret the webhook route refuses
 * every event (fail closed) — better to fail loudly at startup than to
 * silently drop all delivery/bounce tracking.
 */
const EMAIL_REQUIRED = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "RESEND_WEBHOOK_SECRET",
] as const;

export function assertServerEnv(): void {
  const missing: string[] = ALWAYS_REQUIRED.filter((k) => !process.env[k]);

  // Validate APP_ENV even when every required key is present.
  appEnvironment();

  // Mirror of isEmailDryRun() in @/lib/email/resend.ts. Keep this local so
  // startup validation does not initialize the Resend module.
  const emailDryRun =
    process.env.EMAIL_DRY_RUN === "1" &&
    process.env.APP_ENV !== "production";
  if (!emailDryRun) {
    missing.push(...EMAIL_REQUIRED.filter((k) => !process.env[k]));
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "See .env.local.example for the full list.",
    );
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
