import { createHash, timingSafeEqual } from "node:crypto";
import { appEnvironment } from "@/lib/app-env";
import { pingDatabase } from "@/lib/db/health";
import { sendNotification } from "@/lib/email/resend";
import { healthCheckFailedEmail } from "@/lib/email/templates";
import { logDbError } from "@/lib/log";

/**
 * Scheduled database health check, invoked daily by Vercel Cron (see
 * vercel.json). Keeps the Supabase project active and alerts on failure.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron
 * invocations. Responses never carry error details.
 */

/** Constant-time comparison. Hashing first equalizes the lengths. */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function sendFailureAlert(): Promise<void> {
  const to = process.env.HEALTH_ALERT_EMAIL;
  if (!to) return;
  try {
    const content = healthCheckFailedEmail({
      environment: appEnvironment(),
      checkedAt: new Date(),
    });
    // sendNotification swallows and logs its own send failures.
    await sendNotification({ to, ...content });
  } catch (err) {
    // Best effort: an alerting failure must not change the response.
    console.error(
      `[hc] [health] alert failed: ${err instanceof Error ? err.name : typeof err}`,
    );
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed and loud: an unset secret must never mean "open".
    console.error("[hc] [health] CRON_SECRET is not set");
    return Response.json({ ok: false }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!secretMatches(auth, `Bearer ${secret}`)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    await pingDatabase();
  } catch (err) {
    // Code only: connection-failure messages embed hosts, ports, and roles.
    logDbError("[hc] [health]", err, { includeMessage: false });
    await sendFailureAlert();
    return Response.json({ ok: false }, { status: 503 });
  }

  return Response.json({ ok: true });
}
