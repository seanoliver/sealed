import "server-only";
import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
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

type Contact = typeof contacts.$inferSelect;

export type DetectedDuplicate = { first: Contact; second: Contact; match: HouseholdMatch };

const NAME_COLUMNS = {
  id: contacts.id,
  fullName: contacts.fullName,
  partnerName: contacts.partnerName,
  kidsNames: contacts.kidsNames,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  partnerFirstName: contacts.partnerFirstName,
  partnerLastName: contacts.partnerLastName,
  kids: contacts.kids,
};

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

/** Names only, once per request: the layout and the page both need it on every dashboard load. */
const bookNames = cache(async (claims: SessionClaims) =>
  withRls(claims, async (tx) => {
    const book = await ownBook(tx, claims.sub);
    if (!book) return { names: [], dismissed: [] };
    const [names, dismissed] = await Promise.all([
      tx.select(NAME_COLUMNS).from(contacts).where(eq(contacts.bookId, book.id)),
      dismissedPairs(tx, book.id),
    ]);
    return { names, dismissed };
  }),
);

export async function listBookNames(claims: SessionClaims) {
  return (await bookNames(claims)).names;
}

/** One detection run per request, shared by the layout's count and the page. */
const detectedPairs = cache(async (claims: SessionClaims) => {
  const { names, dismissed } = await bookNames(claims);
  return { names, pairs: detectDuplicates(names, { dismissed }) };
});

export async function listDetectedDuplicates(claims: SessionClaims) {
  const { names, pairs } = await detectedPairs(claims);
  const byId = new Map(names.map((row) => [row.id, row]));
  return pairs.flatMap(({ a, b, match }) => {
    const first = byId.get(a);
    const second = byId.get(b);
    return first && second ? [{ first, second, match }] : [];
  });
}

export async function countDetectedDuplicates(claims: SessionClaims): Promise<number> {
  return (await detectedPairs(claims)).pairs.length;
}

export async function loadDuplicateReview(
  claims: SessionClaims,
): Promise<{ pairs: DetectedDuplicate[]; contacts: Contact[] }> {
  return withRls(claims, async (tx) => {
    const book = await ownBook(tx, claims.sub);
    if (!book) return { pairs: [], contacts: [] };
    const [rows, dismissed] = await Promise.all([
      tx.select().from(contacts).where(eq(contacts.bookId, book.id)),
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
