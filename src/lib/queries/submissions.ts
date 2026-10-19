import "server-only";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { books, contactEvents, contacts, submissions } from "@/lib/db/schema";
import { type Recipient } from "@/lib/recipients";

export type PendingSubmission = {
  submission: typeof submissions.$inferSelect;
  /**
   * Full matched-contact row (for the side-by-side diff) when
   * matched_contact_id is set and the contact still exists; the FK is
   * ON DELETE SET NULL, so a deleted match simply degrades to "new contact".
   */
  matchedContact: typeof contacts.$inferSelect | null;
};

/**
 * Pending submissions for the caller's book, newest first, joined with the
 * matched contact when present. `submission.payload` is ATTACKER-CONTROLLED
 * jsonb — callers must treat it as unknown and parse defensively (see
 * src/lib/validation/submission.ts); it is returned verbatim here.
 */
export async function listPendingSubmissions(
  claims: SessionClaims,
): Promise<PendingSubmission[]> {
  return withRls(claims, async (tx) => {
    // Scope explicitly to the caller's book (RLS enforces this too, but the
    // explicit predicate keeps the query self-documenting and index-friendly:
    // submissions_book_status_idx covers it).
    const [book] = await tx
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ownerId, claims.sub))
      .limit(1);
    if (!book) return [];

    return tx
      .select({ submission: submissions, matchedContact: contacts })
      .from(submissions)
      .leftJoin(contacts, eq(contacts.id, submissions.matchedContactId))
      .where(
        and(
          eq(submissions.bookId, book.id),
          eq(submissions.status, "pending"),
        ),
      )
      .orderBy(desc(submissions.createdAt), desc(submissions.id))
      .limit(200);
  });
}

export type PendingReply = {
  id: string;
  contactId: string;
  /** ATTACKER-CONTROLLED jsonb: parse it before display, never cast it. */
  payload: unknown;
  savedBy: Recipient | null;
};

export async function listPendingReplies(
  claims: SessionClaims,
): Promise<PendingReply[]> {
  return withRls(claims, async (tx) => {
    const [book] = await tx
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ownerId, claims.sub))
      .limit(1);
    if (!book) return [];

    const rows = await tx
      .selectDistinctOn([submissions.matchedContactId], {
        id: submissions.id,
        contactId: sql<string>`${submissions.matchedContactId}`,
        payload: submissions.payload,
        savedBy: sql<Recipient | null>`(
          select ${contactEvents.recipient} from ${contactEvents}
          where ${contactEvents.contactId} = ${submissions.matchedContactId}
            and ${contactEvents.source} = 'token'
          order by ${contactEvents.createdAt} desc, ${contactEvents.id} desc
          limit 1)`,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.bookId, book.id),
          eq(submissions.status, "pending"),
          isNotNull(submissions.matchedContactId),
        ),
      )
      .orderBy(
        submissions.matchedContactId,
        asc(submissions.createdAt),
        asc(submissions.id),
      );
    return rows;
  });
}
