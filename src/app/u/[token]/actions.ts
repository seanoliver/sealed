"use server";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs):
// private.apply_token_update is a SECURITY DEFINER function with zero grants
// for client roles — the admin connection is the only path to it. This
// action and the /u/[token] page are its ONLY consumers.
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { hashedRateLimitKey, requestIp } from "@/lib/request-ip";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";
import {
  readTokenDetails,
  TOKEN_DETAIL_FIELDS,
  tokenDetailSchema,
} from "@/lib/validation/contact";
import {
  lastNameRequired,
  parseHouseholdForm,
  readHouseholdValues,
} from "@/lib/validation/household";
// Type-only import from a client module — erased at compile time, so no
// client code is pulled into this server action bundle.
import { type RecipientFormState } from "@/components/recipient-form";
import { INVALID_LINK_MESSAGE } from "../notice";

export type TokenUpdateState = RecipientFormState;

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function ownerNameForToken(token: string): Promise<string | null> {
  try {
    const rows = await dbAdmin.execute(
      sql`select private.get_contact_for_token(${token}) ->> 'owner_name' as owner`,
    );
    const owner = rows[0]?.owner;
    return typeof owner === "string" ? owner : null;
  } catch (err) {
    logDbError("[tu] [ownerNameForToken] get_contact_for_token failed", err);
    return null;
  }
}

/**
 * Recipient-facing submit for /u/[token]. Everything here is hostile input:
 * the token, the form values, the turnstile response, and the caller itself
 * (server actions are directly invokable endpoints — the page's checks are
 * NOT a precondition). The raw token is never logged anywhere in this flow.
 */
export async function submitTokenUpdate(
  token: string,
  _prevState: TokenUpdateState,
  formData: FormData,
): Promise<TokenUpdateState> {
  // 1. Token shape gate — same regex as the page; malformed tokens cost no
  //    DB work and get the same generic copy as dead ones.
  if (!TOKEN_SHAPE.test(token)) {
    return { error: INVALID_LINK_MESSAGE };
  }

  const submitted = readTokenDetails(formData);
  const echo = { values: submitted, household: readHouseholdValues(formData) };
  const ip = await requestIp();

  // 2. Rate limit submits per IP: 10/hour. Fail CLOSED on a rate-limiter
  //    outage — this surface would rather refuse than be unmetered.
  let allowed = false;
  try {
    allowed = await checkRateLimit(hashedRateLimitKey("token-submit", ip), 10, 3600);
  } catch (err) {
    logDbError("[tu] [submitTokenUpdate] rate-limit check failed", err);
    return { error: GENERIC_ERROR, ...echo };
  }
  if (!allowed) {
    return { error: "Too many requests — please try again later.", ...echo };
  }

  // 3. Turnstile. The response comes from the hidden input the widget
  //    injects; verifyTurnstile fails closed and never logs it.
  const turnstileResponse = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(turnstileResponse, ip))) {
    return { error: "Verification failed — please try again.", ...echo };
  }

  // 4. Validate. Same limits as the SQL CHECK constraints — class-22 errors
  //    (which can echo values into logs) stay unreachable.
  const household = parseHouseholdForm(formData, { ownerName: "the sender" });
  const details = tokenDetailSchema.safeParse(submitted);
  if (!household.ok || !details.success) {
    const fieldErrors = household.ok ? undefined : household.fieldErrors;
    if (fieldErrors?.last_name !== undefined) {
      const ownerName = await ownerNameForToken(token);
      if (ownerName !== null) fieldErrors.last_name = lastNameRequired(ownerName);
    }
    return {
      error: details.success
        ? household.ok
          ? undefined
          : household.error
        : (details.error.issues[0]?.message ?? "Invalid input"),
      fieldErrors,
      ...echo,
    };
  }

  // 5. Payload keys = exactly the fields the form rendered (present in
  //    formData): a present key with "" clears the column, an absent key
  //    (field disabled for this book) leaves it untouched. A hostile client
  //    CAN inject extra keys here, but apply_token_update re-gates disabled
  //    fields against books.enabled_fields server-side, so they are inert.
  //    Test the section markers: a removed partner row posts no partner keys.
  const names = household.data;
  const payload: Record<string, unknown> = {
    first_name: names.first_name,
    last_name: names.last_name,
  };
  if (formData.has("partner_section")) {
    payload.partner_first_name = names.partner_first_name ?? "";
    payload.partner_last_name = names.partner_last_name ?? "";
  }
  if (formData.has("kids_section")) payload.kids = names.kids ?? [];
  for (const field of TOKEN_DETAIL_FIELDS) {
    if (formData.has(field)) payload[field] = details.data[field] ?? "";
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
    return { error: GENERIC_ERROR, ...echo };
  }
  if (!applied) {
    return { error: INVALID_LINK_MESSAGE, ...echo };
  }

  redirect("/u/thanks");
}
