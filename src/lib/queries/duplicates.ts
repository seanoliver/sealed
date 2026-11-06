import "server-only";
import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls, type RlsTx } from "@/lib/db";
import { books, contactDuplicateDismissals, contacts } from "@/lib/db/schema";
import {
  detectDuplicates,
  orderedPair,
  type ContactPair,
  type HouseholdMatch,
} from "@/lib/household-match";
import { logDbError } from "@/lib/log";
import { bookAccessibleBy } from "@/lib/queries/books";
import { updatedAtText } from "@/app/dashboard/contacts/write";

type Contact = typeof contacts.$inferSelect & { version: string };

export type DetectedDuplicate = { first: Contact; second: Contact; match: HouseholdMatch };

const ownBook = async (tx: RlsTx, userId: string) => {
  const [book] = await tx.select({ id: books.id }).from(books).where(bookAccessibleBy(userId)).limit(1);
  return book;
};

const dismissedPairs = (tx: RlsTx, bookId: string) =>
  tx
    .select({ a: contactDuplicateDismissals.contactA, b: contactDuplicateDismissals.contactB })
    .from(contactDuplicateDismissals)
    .where(eq(contactDuplicateDismissals.bookId, bookId));

export async function listDismissedPairs(claims: SessionClaims): Promise<ContactPair[]> {
  return withRls(claims, async (tx) => {
    const book = await ownBook(tx, claims.sub);
    return book ? dismissedPairs(tx, book.id) : [];
  });
}

/** Names only: this runs on every dashboard page, for the Review count. */
export async function countDetectedDuplicates(claims: SessionClaims, bookId: string): Promise<number> {
  return withRls(claims, async (tx) => {
    const [names, dismissed] = await Promise.all([
      tx
        .select({
          id: contacts.id,
          fullName: contacts.fullName,
          partnerName: contacts.partnerName,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          partnerFirstName: contacts.partnerFirstName,
          partnerLastName: contacts.partnerLastName,
        })
        .from(contacts)
        .where(eq(contacts.bookId, bookId)),
      dismissedPairs(tx, bookId),
    ]);
    return detectDuplicates(names, { dismissed }).length;
  });
}

/** Worked out from the book on every read, so an edit or a delete can never leave a stale pair. */
export async function loadDuplicateReview(
  claims: SessionClaims,
): Promise<{ pairs: DetectedDuplicate[]; contacts: Contact[] }> {
  return withRls(claims, async (tx) => {
    const book = await ownBook(tx, claims.sub);
    if (!book) return { pairs: [], contacts: [] };
    const [rows, dismissed] = await Promise.all([
      tx
        .select({ ...getTableColumns(contacts), version: updatedAtText })
        .from(contacts)
        .where(eq(contacts.bookId, book.id)),
      dismissedPairs(tx, book.id),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const pairs = detectDuplicates(rows, { dismissed }).flatMap(({ a, b, match }) => {
      const first = byId.get(a);
      const second = byId.get(b);
      return first && second ? [{ first, second, match }] : [];
    });
    return { pairs, contacts: rows };
  });
}

export async function listDetectedDuplicates(claims: SessionClaims): Promise<DetectedDuplicate[]> {
  return (await loadDuplicateReview(claims)).pairs;
}

export type DismissResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND = "Contact not found.";

export async function dismissDuplicateAs(
  claims: SessionClaims,
  first: string,
  second: string,
): Promise<DismissResult> {
  const { a, b } = orderedPair(first, second);
  try {
    return await withRls(claims, async (tx): Promise<DismissResult> => {
      const book = await ownBook(tx, claims.sub);
      if (!book) return { ok: false, error: NOT_FOUND };
      const found = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.bookId, book.id), inArray(contacts.id, [a, b])));
      if (a === b || found.length !== 2) return { ok: false, error: NOT_FOUND };
      await tx
        .insert(contactDuplicateDismissals)
        .values({ bookId: book.id, contactA: a, contactB: b })
        .onConflictDoNothing();
      return { ok: true };
    });
  } catch (err) {
    logDbError("[dd] [dismissDuplicateAs] insert failed", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
