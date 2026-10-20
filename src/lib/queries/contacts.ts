import "server-only";
import { and, asc, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { agentTokens, books, contactEvents, contacts, emailSends } from "@/lib/db/schema";
import type { FailureReason } from "@/lib/email/resend";
import { combineSends, type RecipientSend } from "@/lib/contacts-sheet";
import { type StoredNames } from "@/lib/names";
import { readingsForContact } from "@/lib/pinyin";
import { isPinyinQuery, matchesReading } from "@/lib/readings";
import { type Recipient } from "@/lib/recipients";

export const SEND_STATUSES = [
  "sent",
  "delivered",
  "opened",
  "bounced",
  "complained",
  "failed",
  "unconfirmed",
] as const;

/** Latest email_sends.status for a contact, or "none" when never emailed. */
export type SendStatus = "none" | (typeof SEND_STATUSES)[number];

export interface ContactListRow extends StoredNames {
  id: string;
  email: string | null;
  partnerEmail: string | null;
  birthday: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  district: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  countryCode: string | null;
  legacyCountry: string | null;
  /** Factual latest-send status; the UI layers an "updated" chip on top. */
  sendStatus: SendStatus;
  /** Why the latest send failed; set only when sendStatus is "failed". */
  sendFailureReason: FailureReason | null;
  sendStatuses: Record<Recipient, RecipientSend>;
  needsAttention: boolean;
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

// Postgres ARE escapes: CJK ideographs, compatibility ideographs, extensions B and up.
const HAN_PATTERN = String.raw`[\u3400-\u9fff\uf900-\ufaff\U00020000-\U0003ffff]`;

/**
 * Contacts in the caller's book with their latest send status and an
 * "updated since last send" flag, ordered by name. `search` filters by
 * full_name OR partner_name (case-insensitive substring), or by the pinyin of
 * a name in Chinese characters, with or without tone marks.
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

    // Greatest-n-per-group: rank each person's sends newest-first and keep
    // rank 1 in the join condition (id desc breaks exact sent_at ties).
    // Distinct rn aliases: drizzle leaves the alias unqualified in the join.
    const latestSend = (recipient: Recipient) =>
      tx
        .select({
          contactId: emailSends.contactId,
          status: emailSends.status,
          failureReason: emailSends.failureReason,
          sentAt: emailSends.sentAt,
          rn: sql<number>`row_number() over (
            partition by ${emailSends.contactId}
            order by ${emailSends.sentAt} desc, ${emailSends.id} desc)`.as(`${recipient}_rn`),
        })
        .from(emailSends)
        .where(eq(emailSends.recipient, recipient))
        .as(`${recipient}_send`);
    const primarySend = latestSend("primary");
    const partnerSend = latestSend("partner");

    const term = search?.trim();
    const pattern = term ? `%${escapeLike(term)}%` : undefined;
    const pinyinTerm = term && isPinyinQuery(term) ? term : undefined;
    const literal = pattern
      ? or(ilike(contacts.fullName, pattern), ilike(contacts.partnerName, pattern))
      : undefined;

    const rows = await tx
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        partnerName: contacts.partnerName,
        kidsNames: contacts.kidsNames,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        partnerFirstName: contacts.partnerFirstName,
        partnerLastName: contacts.partnerLastName,
        kids: contacts.kids,
        email: contacts.email,
        partnerEmail: contacts.partnerEmail,
        birthday: contacts.birthday,
        addressLine1: contacts.addressLine1,
        addressLine2: contacts.addressLine2,
        district: contacts.district,
        city: contacts.city,
        stateRegion: contacts.stateRegion,
        postalCode: contacts.postalCode,
        countryCode: contacts.countryCode,
        legacyCountry: contacts.legacyCountry,
        literalMatch: literal ? sql<boolean>`${literal}` : sql<boolean>`true`,
        // Wrapped in sql`` because drizzle types flat partial selects from a
        // left-joined subquery as non-nullable; this is string | null.
        primaryStatus: sql<string | null>`${primarySend.status}`,
        primaryFailureReason: sql<FailureReason | null>`${primarySend.failureReason}`,
        partnerStatus: sql<string | null>`${partnerSend.status}`,
        partnerFailureReason: sql<FailureReason | null>`${partnerSend.failureReason}`,
        updatedAfterSend: sql<boolean>`exists (
          select 1 from ${contactEvents}
          where ${contactEvents.contactId} = ${contacts.id}
            and ${contactEvents.source} = 'token'
            and ${contactEvents.createdAt} > greatest(${primarySend.sentAt}, ${partnerSend.sentAt}))`,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .leftJoin(
        primarySend,
        and(eq(primarySend.contactId, contacts.id), eq(primarySend.rn, 1)),
      )
      .leftJoin(
        partnerSend,
        and(eq(partnerSend.contactId, contacts.id), eq(partnerSend.rn, 1)),
      )
      .where(
        and(
          eq(contacts.bookId, book.id),
          pinyinTerm
            ? or(
                literal,
                sql`${contacts.fullName} ~ ${HAN_PATTERN}`,
                sql`${contacts.partnerName} ~ ${HAN_PATTERN}`,
              )
            : literal,
        ),
      )
      .orderBy(asc(contacts.fullName));

    const pinyinMatches = pinyinTerm
      ? await Promise.all(
          rows.map(
            async (row) =>
              !row.literalMatch &&
              matchesReading({
                names: [row.fullName, row.partnerName],
                readings: await readingsForContact(row),
                query: pinyinTerm,
              }),
          ),
        )
      : [];

    return rows.flatMap(
      ({
        primaryStatus,
        primaryFailureReason,
        partnerStatus,
        partnerFailureReason,
        literalMatch,
        ...row
      }, i) => {
        if (pinyinTerm && !literalMatch && !pinyinMatches[i]) return [];
        const sendStatuses = {
          primary: { status: toSendStatus(primaryStatus), failureReason: primaryFailureReason },
          partner: { status: toSendStatus(partnerStatus), failureReason: partnerFailureReason },
        };
        const { status, failureReason, needsAttention } = combineSends(
          sendStatuses.primary,
          sendStatuses.partner,
        );
        return [
          {
            ...row,
            sendStatus: status,
            sendFailureReason: failureReason,
            sendStatuses,
            needsAttention,
          },
        ];
      },
    );
  });
}

export type ContactDetail = {
  contact: typeof contacts.$inferSelect;
  version: string;
  events: (typeof contactEvents.$inferSelect & { agentName: string | null })[];
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
    const [row] = await tx
      .select({ contact: contacts, version: sql<string>`${contacts.updatedAt}::text` })
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);
    if (!row) return undefined;
    const { contact, version } = row;

    const events = await tx
      .select({ ...getTableColumns(contactEvents), agentName: agentTokens.name })
      .from(contactEvents)
      .leftJoin(agentTokens, eq(agentTokens.id, contactEvents.agentTokenId))
      .where(eq(contactEvents.contactId, id))
      .orderBy(desc(contactEvents.createdAt), desc(contactEvents.id))
      .limit(100);

    return { contact, version, events };
  });
}
