import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { isNoOpReply } from "@/lib/contacts-sheet";
// Sanctioned dbAdmin import (allowlisted for src/app/u/**): the token lookup
// reads update_tokens, which has no grants for client roles.
import { dbAdmin } from "@/lib/db/admin";
import { contactEvents, contacts } from "@/lib/db/schema";
import { sendNotification } from "@/lib/email/resend";
import { contactNeedsReviewEmail, contactUpdatedEmail } from "@/lib/email/templates";
import { logDbError } from "@/lib/log";
import { householdLine, pickStoredNames } from "@/lib/names";
import { type Recipient } from "@/lib/recipients";

export type TokenOwner = {
  contactId: string;
  email: string;
  recipient: Recipient;
  household: string | null;
  /** This recipient had already replied through the link before this reply. */
  repliedBefore: boolean;
};

export async function ownerForToken(token: string): Promise<TokenOwner | null> {
  try {
    const rows = await dbAdmin.execute(
      sql`select c.id as contact_id, u.email as email, t.recipient as recipient,
                 t.used_at is not null as replied_before
          from public.update_tokens t
          join public.contacts c on c.id = t.contact_id
          join public.books b on b.id = c.book_id
          join auth.users u on u.id = b.owner_id
          where t.token_hash = extensions.digest(${token}, 'sha256')`,
    );
    const { contact_id: contactId, email, recipient, replied_before: repliedBefore } = rows[0] ?? {};
    return typeof contactId === "string" &&
      typeof email === "string" &&
      email &&
      (recipient === "primary" || recipient === "partner")
      ? {
          contactId,
          email,
          recipient,
          household: await householdBeforeReply(contactId),
          repliedBefore: repliedBefore === true,
        }
      : null;
  } catch (err) {
    logDbError("[tu] [ownerForToken] lookup failed", err);
    return null;
  }
}

/** Read before the apply, so the email only carries names the owner entered. */
async function householdBeforeReply(contactId: string): Promise<string | null> {
  try {
    const [row] = await dbAdmin
      .select({
        fullName: contacts.fullName,
        partnerName: contacts.partnerName,
        kidsNames: contacts.kidsNames,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        partnerFirstName: contacts.partnerFirstName,
        partnerLastName: contacts.partnerLastName,
        kids: contacts.kids,
      })
      .from(contacts)
      .where(eq(contacts.id, contactId));
    return row ? householdLine(pickStoredNames(row)) || null : null;
  } catch (err) {
    logDbError("[tu] [householdBeforeReply] lookup failed", err);
    return null;
  }
}

async function replyChanged({
  contactId,
  recipient,
}: Pick<TokenOwner, "contactId" | "recipient">): Promise<boolean | null> {
  try {
    const [row] = await dbAdmin
      .select({ diff: contactEvents.diff })
      .from(contactEvents)
      .where(
        and(
          eq(contactEvents.contactId, contactId),
          eq(contactEvents.source, "token"),
          eq(contactEvents.recipient, recipient),
        ),
      )
      .orderBy(desc(contactEvents.createdAt))
      .limit(1);
    if (!row) {
      console.error("[tu] [replyChanged] no token event for the reply");
      return null;
    }
    return !isNoOpReply(row.diff);
  } catch (err) {
    logDbError("[tu] [replyChanged] lookup failed", err);
    return null;
  }
}

/** Best effort: the recipient's update is already saved, so this never fails the submit. */
export async function notifyOwner({
  contactId,
  email,
  recipient,
  household,
  repliedBefore,
  queued = false,
}: TokenOwner & { queued?: boolean }): Promise<void> {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.error("[tu] [notifyOwner] APP_URL is not set");
    return;
  }
  if (queued) {
    await sendNotification({
      to: email,
      ...contactNeedsReviewEmail({ reviewUrl: `${appUrl}/dashboard/review` }),
    });
    return;
  }
  const changed = await replyChanged({ contactId, recipient });
  // A repeat reply that changes nothing is a retap or a re-confirm: one email is enough.
  if (repliedBefore && changed === false) return;
  await sendNotification({
    to: email,
    ...contactUpdatedEmail({
      contactUrl: `${appUrl}/dashboard/contacts/${contactId}`,
      household,
      changed,
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
