import "server-only";
import { type ReactNode } from "react";
import { sql } from "drizzle-orm";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs):
// private.get_contact_for_token is a SECURITY DEFINER function with zero
// grants for client roles — the admin connection is the only path to it.
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { hashedRateLimitKey, requestIp } from "@/lib/request-ip";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { InvalidLinkNotice, Notice } from "../notice";
import { type TokenData, tokenDataSchema } from "./token-data";

/** The gates every /u/[token] page runs before rendering anything personal. */
export async function loadTokenPage(
  token: string,
): Promise<{ data: TokenData } | { notice: ReactNode; invalid?: true }> {
  // 1. Shape gate FIRST: anything that isn't exactly 43 base64url chars gets
  //    the generic page with ZERO DB work (no rate-limit row, no lookup).
  if (!TOKEN_SHAPE.test(token))
    return { notice: <InvalidLinkNotice />, invalid: true };

  // 2. View rate limit: 30/hour per hashed IP. Fail CLOSED on limiter
  //    outage — refuse rather than serve unmetered.
  const ip = await requestIp();
  let allowed = false;
  try {
    allowed = await checkRateLimit(
      hashedRateLimitKey("token-view", ip),
      30,
      3600,
    );
  } catch (err) {
    logDbError("[tu] [loadTokenPage] rate-limit check failed", err);
  }
  if (!allowed) {
    return {
      notice: (
        <Notice title="Too many requests">
          Too many requests — please try again later.
        </Notice>
      ),
    };
  }

  // 3. Token lookup. NULL for unknown, expired, and used alike — and all
  //    three render the identical generic page (no differentiation).
  let data: unknown = null;
  try {
    const rows = await dbAdmin.execute(
      // The token itself is a bind parameter and is never logged.
      sql`select private.get_contact_for_token(${token}) as data`,
    );
    data = rows[0]?.data ?? null;
  } catch (err) {
    logDbError("[tu] [loadTokenPage] get_contact_for_token failed", err);
    return {
      notice: (
        <Notice title="Something went wrong">
          Something went wrong. Please try again later.
        </Notice>
      ),
    };
  }
  const parsed = tokenDataSchema.safeParse(data);
  if (!parsed.success) return { notice: <InvalidLinkNotice />, invalid: true };

  return { data: parsed.data };
}
