import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Client-IP helpers for the unauthenticated public surfaces (/u, /b).
 * The IP is used ONLY as a rate-limit bucket key, and only in hashed form —
 * raw IPs are never persisted or logged.
 */

/** First hop of an x-forwarded-for list; "unknown" when absent/blank. */
export function firstForwardedIp(xff: string | null): string {
  const first = xff?.split(",")[0]?.trim();
  return first || "unknown";
}

/**
 * Best-effort client IP: first hop of x-forwarded-for (set by the platform
 * proxy, e.g. Vercel). Untrusted input — treat it as an opaque bucket key,
 * never as authentication.
 */
export async function requestIp(): Promise<string> {
  const h = await headers();
  return firstForwardedIp(h.get("x-forwarded-for"));
}

/**
 * Rate-limit key: `${prefix}:${sha256hex(value)}`, where value is a client
 * IP or an email. Hashing keeps raw IPs and emails out of the
 * private.rate_limits table (PII minimization) while still giving
 * per-client buckets.
 */
export function hashedRateLimitKey(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}
