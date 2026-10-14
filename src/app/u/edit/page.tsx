import { type Metadata } from "next";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { z } from "zod";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs):
// private.get_contact_for_token is a SECURITY DEFINER function with zero
// grants for client roles — the admin connection is the only path to it.
// This page and the submit action are its ONLY consumers.
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { hashedIpKey, requestIp } from "@/lib/request-ip";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import { RecipientForm } from "@/components/recipient-form";
import { InvalidLinkNotice, Notice } from "../notice";
import { UPDATE_TOKEN_COOKIE } from "../update-token-cookie";
import { submitTokenUpdate } from "./actions";

/**
 * Recipient pages show personal data behind a bearer token — this route must
 * NEVER be crawled, indexed, or followed. (next.config.ts additionally sends
 * X-Robots-Tag for /u/*.)
 */
export const metadata: Metadata = {
  title: "Update your address",
  robots: { index: false, follow: false },
};

/**
 * Defensive re-validation of get_contact_for_token's jsonb. The function is
 * ours, but this page is the app's most exposed surface — a schema drift
 * should fail closed to the generic invalid page, never render `undefined`s
 * or leak unexpected keys into the DOM.
 */
const tokenDataSchema = z.object({
  contact: z.object({
    full_name: z.string().nullable(),
    partner_name: z.string().nullable(),
    kids_names: z.string().nullable(),
    email: z.string().nullable(),
    birthday: z.string().nullable(),
    address_line1: z.string().nullable(),
    address_line2: z.string().nullable(),
    city: z.string().nullable(),
    state_region: z.string().nullable(),
    postal_code: z.string().nullable(),
    country: z.string().nullable(),
  }),
  enabled_fields: z.object({
    partner_name: z.boolean(),
    kids_names: z.boolean(),
    birthday: z.boolean(),
  }),
  owner_name: z.string(),
});

/**
 * Recipient update page. Unauthenticated and token-gated: no session (excluded
 * from the proxy matcher), no auth calls. The DOM contains ONLY display values — never owner/book/contact ids.
 */
export default async function TokenUpdatePage() {
  const token = (await cookies()).get(UPDATE_TOKEN_COOKIE)?.value ?? "";

  // 1. Shape gate FIRST: anything that isn't exactly 43 base64url chars gets
  //    the generic page with ZERO DB work (no rate-limit row, no lookup).
  if (!TOKEN_SHAPE.test(token)) return <InvalidLinkNotice />;

  // 2. View rate limit: 30/hour per hashed IP. Fail CLOSED on limiter
  //    outage — refuse rather than serve unmetered.
  const ip = await requestIp();
  let allowed = false;
  try {
    allowed = await checkRateLimit(hashedIpKey("token-view", ip), 30, 3600);
  } catch (err) {
    logDbError("[tu] [TokenUpdatePage] rate-limit check failed", err);
  }
  if (!allowed) {
    return (
      <Notice title="Too many requests">
        Too many requests — please try again later.
      </Notice>
    );
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
    logDbError("[tu] [TokenUpdatePage] get_contact_for_token failed", err);
    return (
      <Notice title="Something went wrong">
        Something went wrong. Please try again later.
      </Notice>
    );
  }
  const parsed = tokenDataSchema.safeParse(data);
  if (!parsed.success) return <InvalidLinkNotice />;

  const { contact, enabled_fields, owner_name: ownerLabel } = parsed.data;

  // PII: a disabled field's stored value must not reach the client AT ALL —
  // form props are embedded in the RSC payload, so passing it would leak it
  // into the page source even though no input renders it. Blank, not just
  // hidden.
  const defaults: TokenUpdateValues = {
    full_name: contact.full_name ?? "",
    partner_name: enabled_fields.partner_name
      ? (contact.partner_name ?? "")
      : "",
    kids_names: enabled_fields.kids_names ? (contact.kids_names ?? "") : "",
    email: contact.email ?? "",
    birthday: enabled_fields.birthday ? (contact.birthday ?? "") : "",
    address_line1: contact.address_line1 ?? "",
    address_line2: contact.address_line2 ?? "",
    city: contact.city ?? "",
    state_region: contact.state_region ?? "",
    postal_code: contact.postal_code ?? "",
    country: contact.country ?? "",
  };

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm ">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          Update your address for {ownerLabel}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your details below, fix anything that&apos;s out of date, and
          hit update. Only {ownerLabel} can see what you enter.
        </p>

        {/* Never bind the token as an action arg: bound args round-trip
            through the client in cleartext. */}
        <RecipientForm
          action={submitTokenUpdate}
          defaults={defaults}
          enabled={enabled_fields}
          submitLabel="Update my details"
          pendingLabel="Saving…"
        />
      </div>
    </main>
  );
}
