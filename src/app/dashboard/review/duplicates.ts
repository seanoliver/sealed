import "server-only";
import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { books, contactDuplicateDismissals, contacts, submissions } from "@/lib/db/schema";
import { orderedPair } from "@/lib/household-match";
import { planDuplicateMerge } from "@/lib/duplicate-merge";
import { logDbError } from "@/lib/log";
import { bookAccessibleBy } from "@/lib/queries/books";
import {
  changedFields,
  definedFields,
  GENERIC_ERROR,
  rowToSnapshot,
  type Row,
  updatedAtText,
} from "../contacts/write";

const GONE = "One of these contacts is gone. Reload to see the latest.";
const CHANGED = "One of these contacts changed since you opened this page. Reload to compare again.";
const DISMISSED = "Someone marked these two as not duplicates. Reload to see the latest.";
const PENDING_REPLY =
  "The contact you would delete has a reply waiting for review. Apply or reject that reply first.";

export type MergeInput = {
  keepId: string;
  removeId: string;
  /** Each contact's updated_at text from the page that showed the pair. */
  keepVersion: string;
  removeVersion: string;
};

export type MergeResult = { ok: true } | { ok: false; error: string };

/**
 * Deletes a contact, so it cannot be undone: the links, send history and
 * events of `removeId` go with it. The copy under `merged_from` on the kept
 * contact's history is the only record left, so it commits with the delete.
 * Both rows lock in id order, so two merges of one pair, in either direction,
 * cannot deadlock or both win.
 */
export async function mergeDuplicateAs(claims: SessionClaims, input: MergeInput): Promise<MergeResult> {
  const { keepId, removeId, keepVersion, removeVersion } = input;
  if (keepId === removeId) return { ok: false, error: GONE };

  type Outcome = { kind: "refused"; error: string } | { kind: "merged" };
  let outcome: Outcome;
  try {
    outcome = await withRls(claims, async (tx): Promise<Outcome> => {
      const [book] = await tx.select({ id: books.id }).from(books).where(bookAccessibleBy(claims.sub)).limit(1);
      if (!book) return { kind: "refused", error: GONE };

      const locked = await tx
        .select({ ...getTableColumns(contacts), version: updatedAtText })
        .from(contacts)
        .where(and(eq(contacts.bookId, book.id), inArray(contacts.id, [keepId, removeId])))
        .orderBy(asc(contacts.id))
        .for("update");
      const keep = locked.find((row) => row.id === keepId);
      const remove = locked.find((row) => row.id === removeId);
      if (!keep || !remove) return { kind: "refused", error: GONE };
      if (keep.version !== keepVersion || remove.version !== removeVersion) {
        return { kind: "refused", error: CHANGED };
      }

      // Marking a pair never touches either contact, so the version check can't see it.
      const pair = orderedPair(keepId, removeId);
      const [dismissed] = await tx
        .select({ a: contactDuplicateDismissals.contactA })
        .from(contactDuplicateDismissals)
        .where(
          and(
            eq(contactDuplicateDismissals.contactA, pair.a),
            eq(contactDuplicateDismissals.contactB, pair.b),
          ),
        );
      if (dismissed) return { kind: "refused", error: DISMISSED };

      // The FK would quietly unlink it, and a reply must not move to another person's contact.
      const [waiting] = await tx
        .select({ id: submissions.id })
        .from(submissions)
        .where(and(eq(submissions.matchedContactId, removeId), eq(submissions.status, "pending")))
        .limit(1);
      if (waiting) return { kind: "refused", error: PENDING_REPLY };

      const { set } = planDuplicateMerge(keep, remove);
      // Delete first: the kept contact may take this contact's email.
      await tx.delete(contacts).where(and(eq(contacts.id, removeId), eq(contacts.bookId, book.id)));
      const before = rowToSnapshot(keep);
      let after = before;
      if (Object.keys(set).length > 0) {
        const [row] = await tx
          .update(contacts)
          .set(set as Partial<Row>)
          .where(and(eq(contacts.id, keepId), eq(contacts.bookId, book.id)))
          .returning();
        after = rowToSnapshot(row);
      }
      const diff = {
        ...(changedFields(before, after) ?? { before: {}, after: {} }),
        merged_from: definedFields(rowToSnapshot(remove)),
      };
      await tx.execute(sql`
        insert into public.contact_events (contact_id, source, diff)
        values (${keepId}, 'owner', ${JSON.stringify(diff)}::jsonb)`);
      return { kind: "merged" };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: "Another contact already has that email." };
    }
    logDbError("[dd] [mergeDuplicateAs] merge failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (outcome.kind === "refused") return { ok: false, error: outcome.error };
  return { ok: true };
}
