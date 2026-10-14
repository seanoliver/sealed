import "server-only";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { books, contactEvents, contacts, emailSends } from "@/lib/db/schema";

const SEND_STATUSES = [
  "sent",
  "delivered",
  "opened",
  "bounced",
  "complained",
] as const;

/** Latest email_sends.status for a contact, or "none" when never emailed. */
export type SendStatus = "none" | (typeof SEND_STATUSES)[number];

export interface ContactListRow {
  id: string;
  fullName: string;
  partnerName: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  country: string | null;
  /** Factual latest-send status; the UI layers an "updated" chip on top. */
  sendStatus: SendStatus;
  /** True if a token-sourced contact_events row is newer than the latest send. */
  updatedAfterSend: boolean;
  updatedAt: Date;
}

/**
 * Escape LIKE/ILIKE wildcards in user input so a search for "100%" matches
 * the literal string rather than acting as a wildcard. Postgres's default
 * LIKE escape character is backslash, so escape `\` itself plus `%` and `_`.
 * The value is still passed as a bound parameter — this is wildcard hygiene,
 * not injection defense.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function toSendStatus(value: string | null): SendStatus {
  // The DB CHECK constraint limits status to SEND_STATUSES; anything else
  // (i.e. NULL from the left join) means the contact was never emailed.
  return value !== null && (SEND_STATUSES as readonly string[]).includes(value)
    ? (value as SendStatus)
    : "none";
}

/**
 * Contacts in the caller's book with their latest send status and an
 * "updated since last send" flag, ordered by name. `search` filters by
 * full_name OR partner_name (case-insensitive substring).
 */
export async function listContacts(
  claims: SessionClaims,
  search?: string,
): Promise<ContactListRow[]> {
  return withRls(claims, async (tx) => {
    // Scope explicitly to the caller's book (RLS enforces this too, but the
    // explicit predicate keeps the query self-documenting and index-friendly).
    const [book] = await tx
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ownerId, claims.sub))
      .limit(1);
    if (!book) return [];

    // Greatest-n-per-group: rank each contact's sends newest-first and keep
    // rank 1 in the join condition (id desc breaks exact sent_at ties).
    const latestSend = tx
      .select({
        contactId: emailSends.contactId,
        status: emailSends.status,
        sentAt: emailSends.sentAt,
        rn: sql<number>`row_number() over (
          partition by ${emailSends.contactId}
          order by ${emailSends.sentAt} desc, ${emailSends.id} desc)`.as("rn"),
      })
      .from(emailSends)
      .as("latest_send");

    const term = search?.trim();
    const pattern = term ? `%${escapeLike(term)}%` : undefined;

    const rows = await tx
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        partnerName: contacts.partnerName,
        email: contacts.email,
        addressLine1: contacts.addressLine1,
        city: contacts.city,
        stateRegion: contacts.stateRegion,
        postalCode: contacts.postalCode,
        country: contacts.country,
        // Wrapped in sql`` because drizzle types flat partial selects from a
        // left-joined subquery as non-nullable; this is string | null.
        sendStatus: sql<string | null>`${latestSend.status}`,
        // NULL sent_at (never emailed) makes the comparison NULL → false.
        updatedAfterSend: sql<boolean>`exists (
          select 1 from ${contactEvents}
          where ${contactEvents.contactId} = ${contacts.id}
            and ${contactEvents.source} = 'token'
            and ${contactEvents.createdAt} > ${latestSend.sentAt})`,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .leftJoin(
        latestSend,
        and(eq(latestSend.contactId, contacts.id), eq(latestSend.rn, 1)),
      )
      .where(
        and(
          eq(contacts.bookId, book.id),
          pattern
            ? or(
                ilike(contacts.fullName, pattern),
                ilike(contacts.partnerName, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(asc(contacts.fullName));

    return rows.map((row) => ({
      ...row,
      sendStatus: toSendStatus(row.sendStatus),
    }));
  });
}

export type ContactDetail = {
  contact: typeof contacts.$inferSelect;
  events: (typeof contactEvents.$inferSelect)[];
};

/**
 * A single contact plus its audit trail (newest first), or undefined when the
 * id doesn't exist or belongs to another user's book — RLS scopes both
 * selects to the caller's own book, so foreign ids are indistinguishable
 * from missing ones. `id` must be a validated UUID (an arbitrary string
 * would throw on the uuid cast).
 */
export async function getContactWithEvents(
  claims: SessionClaims,
  id: string,
): Promise<ContactDetail | undefined> {
  return withRls(claims, async (tx) => {
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);
    if (!contact) return undefined;

    const events = await tx
      .select()
      .from(contactEvents)
      .where(eq(contactEvents.contactId, id))
      .orderBy(desc(contactEvents.createdAt), desc(contactEvents.id))
      .limit(100);

    return { contact, events };
  });
}
