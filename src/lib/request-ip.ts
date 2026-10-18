import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { requiredEnv } from "@/lib/env";

/**
 * Client-IP helpers for the unauthenticated public surfaces (/u, /b).
 * The IP is used ONLY as a rate-limit bucket key, and only in keyed-hash form —
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

/** Keyed with RATE_LIMIT_SECRET so stored keys can't be reversed by hashing guessed emails or IPs. */
export function hashedRateLimitKey(prefix: string, value: string): string {
  const digest = createHmac("sha256", requiredEnv("RATE_LIMIT_SECRET")).update(value).digest("hex");
  return `${prefix}:${digest}`;
}
