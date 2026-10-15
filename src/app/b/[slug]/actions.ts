"use server";

import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { sql } from "drizzle-orm";
// Type-only import from a client module — erased at compile time.
import { type RecipientFormState } from "@/components/recipient-form";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs):
// private.submit_to_book is a SECURITY DEFINER function with zero grants for
// client roles — the admin connection is the only path to it. The owner
// email lookup below joins auth.users, which no client role can reach either.
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { sendNotification } from "@/lib/email/resend";
import { submissionNotificationEmail } from "@/lib/email/templates";
import { logDbError } from "@/lib/log";
import {
  getPublicBook,
  SLUG_SHAPE,
  type PublicBook,
} from "@/lib/queries/public-book";
import { hashedIpKey, requestIp } from "@/lib/request-ip";
import { verifyTurnstile } from "@/lib/turnstile";
import { readTokenDetails, tokenDetailSchema } from "@/lib/validation/contact";
import {
  parseHouseholdForm,
  readHouseholdValues,
} from "@/lib/validation/household";

const GENERIC_ERROR = "Something went wrong. Please try again.";
const TOO_MANY = "Too many requests — please try again later.";

/**
 * Best-effort owner notification for a new submission. NEVER contains
 * submitted data (see submissionNotificationEmail) and NEVER fails the
 * submission — every failure path logs and returns. The response the
 * submitter sees is already determined before this runs.
 */
async function notifyOwner(slug: string): Promise<void> {
  try {
    const rows = await dbAdmin.execute(
      sql`select u.email as email
          from public.books b
          join auth.users u on u.id = b.owner_id
          where b.slug = ${slug}`,
    );
    const email = rows[0]?.email;
    if (typeof email !== "string" || !email) return;
    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      console.error("[pb] [notifyOwner] APP_URL is not set");
      return;
    }
    // sendNotification swallows transport errors itself; the try/catch here
    // covers the lookup and any unexpected throw.
    await sendNotification({
      to: email,
      ...submissionNotificationEmail({
        reviewUrl: `${appUrl}/dashboard/review`,
      }),
    });
  } catch (err) {
    logDbError("[pb] [notifyOwner] owner notification failed", err);
  }
}

/**
 * Public permalink submit for /b/[slug]. Everything here is hostile input:
 * the slug, the form values, the turnstile response, and the caller itself
 * (server actions are directly invokable endpoints — the page's checks are
 * NOT a precondition). The response is IDENTICAL whether or not the email
 * matched an existing contact — submit_to_book returns true for both, and
 * nothing here branches on anything match-related.
 */
export async function submitToBook(
  slug: string,
  _prevState: RecipientFormState,
  formData: FormData,
): Promise<RecipientFormState> {
  // 1. Slug shape gate — a malformed slug can never exist (DB CHECK), so it
  //    404s with zero DB work, same as the page.
  if (!SLUG_SHAPE.test(slug)) notFound();

  const echo = {
    values: readTokenDetails(formData),
    household: readHouseholdValues(formData),
  };
  const ip = await requestIp();

  // 2a. Rate limit per hashed IP FIRST (5/hour): a single client must burn
  //     its own budget before it can touch any book's shared budget. Fail
  //     CLOSED on limiter outage.
  let allowed = false;
  try {
    allowed = await checkRateLimit(hashedIpKey("permalink-submit", ip), 5, 3600);
  } catch (err) {
    logDbError("[pb] [submitToBook] ip rate-limit check failed", err);
    return { error: GENERIC_ERROR, ...echo };
  }
  if (!allowed) {
    return { error: TOO_MANY, ...echo };
  }

  // 3. Turnstile BEFORE the shared book budget: requests that fail the bot
  //    gate burn only their own IP budget, never the book's — otherwise a
  //    handful of IPs sending bot-gated junk could lock a targeted book out
  //    for the day. The response comes from the hidden input the widget
  //    injects; verifyTurnstile fails closed and never logs it.
  const turnstileResponse = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(turnstileResponse, ip))) {
    return {
      error: "Verification failed — please try again.",
      ...echo,
    };
  }

  // 4. Rate limit per book (100/day): stops distributed spam converging on
  //    one book. Only bot-gate-passing requests reach this, so only they
  //    consume the shared budget. Key is the raw slug — it's public,
  //    unlike IPs.
  try {
    allowed = await checkRateLimit(`permalink-book:${slug}`, 100, 86400);
  } catch (err) {
    logDbError("[pb] [submitToBook] book rate-limit check failed", err);
    return { error: GENERIC_ERROR, ...echo };
  }
  if (!allowed) {
    return { error: TOO_MANY, ...echo };
  }

  // 5. Validate. Same limits as the SQL CHECK constraints — class-22 errors
  //    (which can echo values into logs) stay unreachable, and the Zod
  //    max-lengths keep the payload far below submit_to_book's 64KB guard.
  //    The owner name is only needed for the last-name error copy.
  let book: PublicBook | null;
  try {
    book = await getPublicBook(slug);
  } catch (err) {
    logDbError("[pb] [submitToBook] getPublicBook failed", err);
    return { error: GENERIC_ERROR, ...echo };
  }
  if (!book) notFound();
  const household = parseHouseholdForm(formData, { ownerName: book.ownerName });
  const details = tokenDetailSchema.safeParse(echo.values);
  if (!household.ok || !details.success) {
    return {
      error: details.success
        ? household.ok
          ? undefined
          : household.error
        : (details.error.issues[0]?.message ?? "Invalid input"),
      fieldErrors: household.ok ? undefined : household.fieldErrors,
      ...echo,
    };
  }

  // 6. Payload = only the fields with a value. Unlike apply_token_update
  //    (where a present-but-empty key means "clear the column"), submit_to_
  //    book stores the payload verbatim as a NEW pending submission — empty
  //    keys carry no meaning there and would only pad attacker-controlled
  //    stored data, so they are dropped. The payload uses the household
  //    shape that parseSubmissionPayload expects at approval.
  const payload: Record<string, unknown> = {};
  for (const [field, value] of Object.entries({ ...household.data, ...details.data })) {
    if (value !== undefined) payload[field] = value;
  }

  // 7. Insert the pending submission. `false` means the slug doesn't exist
  //    (book vanished between render and submit, or a hostile direct call) —
  //    the payload guards are unreachable here because Zod already enforced
  //    object shape and size. Enumeration note: `true` NEVER reveals whether
  //    the email matched an existing contact.
  let accepted = false;
  try {
    const rows = await dbAdmin.execute(
      sql`select private.submit_to_book(${slug}, ${JSON.stringify(payload)}::jsonb) as ok`,
    );
    accepted = rows[0]?.ok === true;
  } catch (err) {
    // logDbError reports code/constraint only — never the payload.
    logDbError("[pb] [submitToBook] submit_to_book failed", err);
    return { error: GENERIC_ERROR, ...echo };
  }
  if (!accepted) notFound();

  // 8. Fire-and-forget owner notification: after() defers it until AFTER
  //    the response is sent, so a slow email provider can never delay the
  //    submitter's redirect (and notifyOwner catches everything, so it can
  //    never fail the submission either). The thanks URL carries nothing
  //    derived from the submission — just the public slug.
  after(() => notifyOwner(slug));
  redirect(`/b/${slug}/thanks`);
}
