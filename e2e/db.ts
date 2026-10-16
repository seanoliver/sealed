import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

/**
 * Direct Postgres access for the e2e suite (seeding + cleanup).
 *
 * Deliberately NOT `src/lib/db/admin`: that module imports `server-only`,
 * which throws outside a React Server Components bundle — the Playwright
 * runner is plain Node. This tiny client owns the tables (superuser DSN), so
 * everything here bypasses RLS by design; e2e seeds are trusted fixtures.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set — playwright.config.ts loads it from .env.local",
  );
}

// idle_timeout releases connections between tests so a worker process never
// lingers on an open socket after its spec files finish.
const db = postgres(url, { prepare: false, max: 2, idle_timeout: 5 });

/**
 * Mirrors src/lib/tokens.ts (server-only, unimportable here — keep in sync):
 * 32 random bytes as 43-char unpadded base64url; only the sha256 is stored.
 */
export function generateToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest() };
}

/** Auth user id for an email signed up through the UI. */
export async function getUserIdByEmail(email: string): Promise<string> {
  const rows = await db`select id from auth.users where email = ${email}`;
  if (rows.length !== 1) {
    throw new Error(`expected 1 auth user for ${email}, found ${rows.length}`);
  }
  return rows[0].id as string;
}

export type EnabledFields = {
  partner_name: boolean;
  kids_names: boolean;
  birthday: boolean;
};

export async function seedBook(opts: {
  ownerId: string;
  slug: string;
  displayName?: string;
  enabledFields?: EnabledFields;
}): Promise<string> {
  const enabled: EnabledFields = opts.enabledFields ?? {
    partner_name: true,
    kids_names: true,
    birthday: true,
  };
  await db`
    update public.profiles
    set display_name = ${opts.displayName ?? "E2E Owner"}
    where id = ${opts.ownerId}`;
  const rows = await db`
    insert into public.books (owner_id, slug, enabled_fields)
    values (${opts.ownerId}, ${opts.slug}, ${db.json(enabled)})
    returning id`;
  return rows[0].id as string;
}

export async function seedOwnerBook(opts: {
  email: string;
  displayName: string;
  slug: string;
}): Promise<{ ownerId: string; bookId: string }> {
  const ownerId = randomUUID();
  await db`insert into auth.users (id, email) values (${ownerId}, ${opts.email})`;
  const bookId = await seedBook({
    ownerId,
    slug: opts.slug,
    displayName: opts.displayName,
  });
  return { ownerId, bookId };
}

export async function seedContact(opts: {
  bookId: string;
  fullName: string;
  email?: string;
  partnerName?: string;
  kidsNames?: string;
  city?: string;
  country?: string;
}): Promise<string> {
  const rows = await db`
    insert into public.contacts
      (book_id, full_name, email, partner_name, kids_names, city, country)
    values
      (${opts.bookId}, ${opts.fullName}, ${opts.email ?? null},
       ${opts.partnerName ?? null}, ${opts.kidsNames ?? null},
       ${opts.city ?? null}, ${opts.country ?? null})
    returning id`;
  return rows[0].id as string;
}

/** Mint a live update token for a contact and return the RAW token (URL part). */
export async function seedUpdateToken(contactId: string): Promise<string> {
  const { token, hash } = generateToken();
  await db`
    insert into public.update_tokens (contact_id, token_hash, expires_at)
    values (${contactId}, ${hash}, now() + interval '30 days')`;
  return token;
}

/** An email_sends row in its insert-time state ('sent'), as requestAddresses writes it. */
export async function seedEmailSend(opts: {
  contactId: string;
  bookId: string;
  resendId: string;
}): Promise<void> {
  await db`
    insert into public.email_sends (contact_id, book_id, resend_id, status)
    values (${opts.contactId}, ${opts.bookId}, ${opts.resendId}, 'sent')`;
}

/**
 * Delete a test user by email. auth.users cascades to profiles → books →
 * contacts → submissions/update_tokens/email_sends/contact_events, so one
 * delete removes everything a spec created.
 */
export async function cleanupUser(email: string): Promise<void> {
  await db`delete from auth.users where email = ${email}`;
  await db`delete from private.waitlist where email = ${email.toLowerCase()}`;
}

/** Let an email through the invite-only gate (private.before_user_created_hook). */
export async function approveEmail(email: string): Promise<void> {
  await db`select private.approve_waitlist_email(${email})`;
}

/** Record an email as waiting, as an unapproved sign-up attempt would. */
export async function seedPendingWaitlist(email: string): Promise<void> {
  await db`
    insert into private.waitlist (email, source)
    values (${email.toLowerCase()}, 'email')
    on conflict (email) do nothing`;
}

export async function getWaitlistRow(
  email: string,
): Promise<{ status: string; source: string; invited: boolean } | null> {
  const rows = await db`
    select status, source, invitation_sent_at is not null as invited
    from private.waitlist where email = ${email.toLowerCase()}`;
  return (rows[0] as { status: string; source: string; invited: boolean }) ?? null;
}

export async function authUserExists(email: string): Promise<boolean> {
  const rows = await db`select 1 from auth.users where email = ${email.toLowerCase()}`;
  return rows.length > 0;
}

/**
 * Reset the app's fixed-window rate limits (token/permalink views + submits
 * share the runner's single IP). Keeps back-to-back suite runs from eating
 * a prior run's budget — e.g. permalink submits are capped at 5/hour/IP.
 */
export async function clearRateLimits(): Promise<void> {
  await db`delete from private.rate_limits`;
}

/** The suite shares one IP, and the entry form allows only 5 requests an hour per IP. */
export async function clearRequestAccessLimits(): Promise<void> {
  await db`delete from private.rate_limits where key like 'request-access%'`;
}
