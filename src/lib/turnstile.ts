import "server-only";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's documented maximum widget-response token length. */
const MAX_RESPONSE_LENGTH = 2048;

/**
 * Server-side Turnstile verification (siteverify).
 *
 * Fail closed: missing secret, empty/oversized response, non-2xx status,
 * unexpected body shape, a 5-second timeout, or any network failure all return false — a bot
 * check that can't be completed must never wave a request through.
 *
 * Logging: NOTHING here is ever logged. The response token is
 * attacker-supplied and single-use, and the siteverify payload can echo it
 * back — keep both out of logs entirely.
 */
export async function verifyTurnstile(
  response: string,
  ip?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !response || response.length > MAX_RESPONSE_LENGTH) {
    return false;
  }

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({
        secret,
        response,
        // remoteip is best-effort: omit it when the caller couldn't
        // determine a real client IP rather than sending garbage.
        ...(ip && ip !== "unknown" ? { remoteip: ip } : {}),
      }),
    });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    return (
      typeof data === "object" &&
      data !== null &&
      (data as { success?: unknown }).success === true
    );
  } catch {
    // Network/parse failure → fail closed, and deliberately no logging:
    // the request context contains the turnstile response token.
    return false;
  }
}
