import { type Metadata } from "next";
import { sql } from "drizzle-orm";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs):
// private.get_contact_for_token is a SECURITY DEFINER function with zero
// grants for client roles — the admin connection is the only path to it.
// This page and the submit action are its ONLY consumers.
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { hashedRateLimitKey, requestIp } from "@/lib/request-ip";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { householdPrefill } from "@/lib/names";
import { storedNames, tokenDataSchema } from "./token-data";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import { RecipientForm } from "@/components/recipient-form";
import { InvalidLinkNotice, Notice } from "../notice";
import { submitTokenUpdate } from "./actions";

/**
 * Tokens are secrets carried in the URL — this route must NEVER be crawled,
 * indexed, or followed. (Task 18 additionally sends X-Robots-Tag here.)
 */
export const metadata: Metadata = {
  title: "Update your address",
  robots: { index: false, follow: false },
};

/**
 * Recipient update page. Unauthenticated and token-gated: no session, no
 * cookies (excluded from the proxy matcher), no auth calls. The DOM contains
 * ONLY display values — never owner/book/contact ids.
 */
export default async function TokenUpdatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. Shape gate FIRST: anything that isn't exactly 43 base64url chars gets
  //    the generic page with ZERO DB work (no rate-limit row, no lookup).
  if (!TOKEN_SHAPE.test(token)) return <InvalidLinkNotice />;

  // 2. View rate limit: 30/hour per hashed IP. Fail CLOSED on limiter
  //    outage — refuse rather than serve unmetered.
  const ip = await requestIp();
  let allowed = false;
  try {
    allowed = await checkRateLimit(hashedRateLimitKey("token-view", ip), 30, 3600);
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
  // hidden. Pass the enabled flags to householdPrefill for the same reason.
  const household = householdPrefill(storedNames(contact), {
    partner: enabled_fields.partner_name,
    kids: enabled_fields.kids_names,
  });
  const defaults: TokenUpdateValues = {
    full_name: "",
    partner_name: "",
    kids_names: "",
    email: contact.email ?? "",
    birthday: enabled_fields.birthday ? (contact.birthday ?? "") : "",
    address_line1: contact.address_line1 ?? "",
    address_line2: contact.address_line2 ?? "",
    city: contact.city ?? "",
    state_region: contact.state_region ?? "",
    postal_code: contact.postal_code ?? "",
    country: contact.country ?? "",
  };

  // Bind the token server-side. Note: bound args may round-trip through the
  // client in cleartext (observed in dev) — acceptable here only because the
  // recipient's browser already holds the token in the URL. Never bind
  // secrets the client shouldn't see.
  const action = submitTokenUpdate.bind(null, token);

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

        <RecipientForm
          action={action}
          defaults={defaults}
          enabled={enabled_fields}
          submitLabel="Update my details"
          pendingLabel="Saving…"
          household={household}
        />
      </div>
    </main>
  );
}
