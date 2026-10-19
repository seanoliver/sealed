"use server";

import { after } from "next/server";
import { sql } from "drizzle-orm";
// Sanctioned dbAdmin import (allowlisted for src/app/u/**):
// private.apply_token_update has zero grants for client roles.
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { hashedRateLimitKey, requestIp } from "@/lib/request-ip";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";
import { INVALID_LINK_MESSAGE } from "../../notice";
import { isSpentToken, notifyOwner, ownerForToken } from "../owner";

export type ConfirmState = { error?: string; confirmed?: boolean };

/**
 * "Yes, send it here": spends the token with an empty payload, which changes
 * no fields but records the confirmation in contact_events. Same gates as
 * submitTokenUpdate.
 */
export async function confirmTokenAddress(
  token: string,
  _prevState: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  if (!TOKEN_SHAPE.test(token)) return { error: INVALID_LINK_MESSAGE };

  const ip = await requestIp();
  let allowed = false;
  try {
    allowed = await checkRateLimit(
      hashedRateLimitKey("token-submit", ip),
      10,
      3600,
    );
  } catch (err) {
    logDbError("[tu] [confirmTokenAddress] rate-limit check failed", err);
    return { error: "Something went wrong. Please try again." };
  }
  if (!allowed) return { error: "Too many requests — please try again later." };

  const turnstileResponse = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(turnstileResponse, ip))) {
    return { error: "Verification failed — please try again." };
  }

  const owner = await ownerForToken(token);
  let applied = false;
  try {
    const rows = await dbAdmin.execute(
      sql`select private.apply_token_update(${token}, '{}'::jsonb) as ok`,
    );
    applied = rows[0]?.ok === true;
  } catch (err) {
    logDbError("[tu] [confirmTokenAddress] apply_token_update failed", err);
    return { error: "Something went wrong. Please try again." };
  }
  if (!applied)
    return (await isSpentToken(token))
      ? { confirmed: true }
      : { error: INVALID_LINK_MESSAGE };

  if (owner) after(() => notifyOwner(owner));
  return { confirmed: true };
}
