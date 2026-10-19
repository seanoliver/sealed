import "server-only";
import { sql } from "drizzle-orm";
// Sanctioned dbAdmin import (allowlisted for src/app/u/**): the token lookup
// reads update_tokens, which has no grants for client roles.
import { dbAdmin } from "@/lib/db/admin";
import { sendNotification } from "@/lib/email/resend";
import { contactUpdatedEmail } from "@/lib/email/templates";
import { logDbError } from "@/lib/log";

export type TokenOwner = { contactId: string; email: string };

export async function ownerForToken(token: string): Promise<TokenOwner | null> {
  try {
    const rows = await dbAdmin.execute(
      sql`select c.id as contact_id, u.email as email
          from public.update_tokens t
          join public.contacts c on c.id = t.contact_id
          join public.books b on b.id = c.book_id
          join auth.users u on u.id = b.owner_id
          where t.token_hash = extensions.digest(${token}, 'sha256')`,
    );
    const { contact_id: contactId, email } = rows[0] ?? {};
    return typeof contactId === "string" && typeof email === "string" && email
      ? { contactId, email }
      : null;
  } catch (err) {
    logDbError("[tu] [ownerForToken] lookup failed", err);
    return null;
  }
}

/** Best effort: the recipient's update is already saved, so this never fails the submit. */
export async function notifyOwner({
  contactId,
  email,
}: TokenOwner): Promise<void> {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.error("[tu] [notifyOwner] APP_URL is not set");
    return;
  }
  await sendNotification({
    to: email,
    ...contactUpdatedEmail({
      contactUrl: `${appUrl}/dashboard/contacts/${contactId}`,
    }),
  });
}

/** A token that was valid and has been used, as opposed to unknown or expired. */
export async function isSpentToken(token: string): Promise<boolean> {
  try {
    const rows = await dbAdmin.execute(
      sql`select 1 from public.update_tokens
          where token_hash = extensions.digest(${token}, 'sha256') and used_at is not null`,
    );
    return rows.length > 0;
  } catch (err) {
    logDbError("[tu] [isSpentToken] lookup failed", err);
    return false;
  }
}
