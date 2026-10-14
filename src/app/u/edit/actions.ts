"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs):
// private.apply_token_update is a SECURITY DEFINER function with zero grants
// for client roles — the admin connection is the only path to it. This
// action and the /u/edit page are its ONLY consumers.
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { hashedIpKey, requestIp } from "@/lib/request-ip";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";
import {
  TOKEN_UPDATE_FIELDS,
  tokenUpdateSchema,
  type TokenUpdateField,
  type TokenUpdateValues,
} from "@/lib/validation/contact";
// Type-only import from a client module — erased at compile time, so no
// client code is pulled into this server action bundle.
import { type RecipientFormState } from "@/components/recipient-form";
import { INVALID_LINK_MESSAGE } from "../notice";
import { UPDATE_TOKEN_COOKIE } from "../update-token-cookie";

export type TokenUpdateState = RecipientFormState;

const GENERIC_ERROR = "Something went wrong. Please try again.";

function readTokenForm(formData: FormData): TokenUpdateValues {
  return Object.fromEntries(
    TOKEN_UPDATE_FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
  ) as TokenUpdateValues;
}

/**
 * Recipient-facing submit for /u/edit. Everything here is hostile input:
 * the token, the form values, the turnstile response, and the caller itself
 * (server actions are directly invokable endpoints — the page's checks are
 * NOT a precondition). The raw token is never logged anywhere in this flow.
 */
export async function submitTokenUpdate(
  _prevState: TokenUpdateState,
  formData: FormData,
): Promise<TokenUpdateState> {
  const cookieStore = await cookies();
  const token = cookieStore.get(UPDATE_TOKEN_COOKIE)?.value ?? "";

  // 1. Token shape gate — same regex as the page; malformed tokens cost no
  //    DB work and get the same generic copy as dead ones.
  if (!TOKEN_SHAPE.test(token)) {
    return { error: INVALID_LINK_MESSAGE };
  }

  const submitted = readTokenForm(formData);
  const ip = await requestIp();

  // 2. Rate limit submits per IP: 10/hour. Fail CLOSED on a rate-limiter
  //    outage — this surface would rather refuse than be unmetered.
  let allowed = false;
  try {
    allowed = await checkRateLimit(hashedIpKey("token-submit", ip), 10, 3600);
  } catch (err) {
    logDbError("[tu] [submitTokenUpdate] rate-limit check failed", err);
    return { error: GENERIC_ERROR, values: submitted };
  }
  if (!allowed) {
    return {
      error: "Too many requests — please try again later.",
      values: submitted,
    };
  }

  // 3. Turnstile. The response comes from the hidden input the widget
  //    injects; verifyTurnstile fails closed and never logs it.
  const turnstileResponse = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(turnstileResponse, ip))) {
    return {
      error: "Verification failed — please try again.",
      values: submitted,
    };
  }

  // 4. Validate. Same limits as the SQL CHECK constraints — class-22 errors
  //    (which can echo values into logs) stay unreachable.
  const parsed = tokenUpdateSchema.safeParse(submitted);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      values: submitted,
    };
  }

  // 5. Payload keys = exactly the fields the form rendered (present in
  //    formData): a present key with "" clears the column, an absent key
  //    (field disabled for this book) leaves it untouched. A hostile client
  //    CAN inject extra keys here, but apply_token_update re-gates disabled
  //    fields against books.enabled_fields server-side, so they are inert.
  const payload: Partial<Record<TokenUpdateField, string>> = {};
  for (const field of TOKEN_UPDATE_FIELDS) {
    if (formData.has(field)) payload[field] = parsed.data[field] ?? "";
  }

  // 6. Single-use apply. `false` covers unknown/expired/used token AND
  //    non-object/oversized payload — all get the identical generic copy.
  let applied = false;
  try {
    const rows = await dbAdmin.execute(
      sql`select private.apply_token_update(${token}, ${JSON.stringify(payload)}::jsonb) as ok`,
    );
    applied = rows[0]?.ok === true;
  } catch (err) {
    // logDbError reports code/constraint only — the token never reaches logs.
    logDbError("[tu] [submitTokenUpdate] apply_token_update failed", err);
    return { error: GENERIC_ERROR, values: submitted };
  }
  if (!applied) {
    return { error: INVALID_LINK_MESSAGE, values: submitted };
  }

  cookieStore.delete({ name: UPDATE_TOKEN_COOKIE, path: "/u" });
  redirect("/u/thanks");
}
