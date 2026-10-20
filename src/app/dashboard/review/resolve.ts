import "server-only";
import { and, eq, getTableColumns } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls, type RlsTx } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { books, contacts, submissions } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import {
  clearedFields,
  parsePartnerEmail,
  parseSubmissionPayload,
  withoutBlanks,
} from "@/lib/validation/submission";
import { recordContactEvent, updatedAtText, type Actor } from "../contacts/write";
import {
  changedFields,
  definedFields,
  mergeUpdate,
  rowToSnapshot,
  toInsertRow,
  type Snapshot,
} from "./merge";

/**
 * Review-queue resolution, shared by the dashboard's actions and the agent's
 * resolve_review_item. `submissions.payload` is ATTACKER-CONTROLLED jsonb
 * (public permalink submissions; submit_to_book does not gate enabled_fields
 * and stores whatever object it was handed). Every approval therefore:
 *   1. re-validates the payload through the STRICT parseSubmissionPayload
 *      (household or legacy shape; unknown keys — including a smuggled
 *      `notes` — stripped, per-field caps, a name required), which also
 *   2. drops fields DISABLED on the book (dropDisabledFields)
 * BEFORE anything touches `contacts`. The DB CHECK constraints are the third
 * net. Display-side gating (review/page.tsx) uses the same dropDisabledFields
 * helper, so display and merge can never disagree.
 */

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const NOT_FOUND = "Submission not found — it may already be reviewed.";
const INVALID_PAYLOAD =
  "This submission contains invalid data and can't be approved — reject it instead.";
const DUPLICATE_EMAIL =
  "You already have a contact with this email — use Apply update on the matching card or reject this one.";
const NO_MATCH =
  "This submission isn't linked to an existing contact — use Add contact instead.";

export type ResolveResult =
  | { ok: true; contactId?: string; eventId?: string }
  | { ok: false; error: string };

/** The approver's event: an owner's approval keeps the "submission" label. */
const approvalActor = (actor: Actor): Actor =>
  actor.source === "owner" ? { source: "submission" } : actor;

/**
 * Atomic concurrency gate for the approve paths: flip pending → approved and
 * report whether WE won the flip. Two concurrent approvals both read the
 * same pending row, but under READ COMMITTED the second UPDATE blocks on the
 * row lock and re-evaluates `status = 'pending'` after the first commits —
 * exactly one caller ever gets a row back. Contract: run in the SAME
 * transaction as the contact write, AFTER all read-only checks and BEFORE
 * any write — a losing racer must return having written nothing, and a
 * failed contact write (e.g. duplicate email) must throw so the rollback
 * restores the submission to pending.
 */
async function winApprovalFlip(
  tx: RlsTx,
  submissionId: string,
  bookId: string,
): Promise<boolean> {
  const rows = await tx
    .update(submissions)
    .set({ status: "approved" })
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.bookId, bookId),
        eq(submissions.status, "pending"),
      ),
    )
    .returning({ id: submissions.id });
  return rows.length === 1;
}

/**
 * The caller's book + the PENDING submission, both RLS-scoped (the explicit
 * predicates mirror what RLS enforces). undefined ⇒ no book, unknown id,
 * another user's submission, or already reviewed — all indistinguishable.
 * Read-only — the AUTHORITATIVE pending check is winApprovalFlip (this
 * select alone would be check-then-act under concurrency).
 */
async function loadPendingSubmission(tx: RlsTx, ownerId: string, id: string) {
  const [book] = await tx
    .select({ id: books.id, enabledFields: books.enabledFields })
    .from(books)
    .where(eq(books.ownerId, ownerId))
    .limit(1);
  if (!book) return undefined;
  const [submission] = await tx
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, id),
        eq(submissions.bookId, book.id),
        eq(submissions.status, "pending"),
      ),
    )
    .limit(1);
  if (!submission) return undefined;
  return { book, submission };
}

/** Approve an unmatched submission: create a new contact from the payload. */
export async function approveNewAs(
  claims: SessionClaims,
  id: string,
  actor: Actor,
): Promise<ResolveResult> {
  type Outcome =
    | { kind: "not_found" }
    | { kind: "invalid" }
    | { kind: "ok"; contactId: string; after: Partial<Snapshot>; updatedAt: string };

  let outcome: Outcome;
  try {
    outcome = await withRls(claims, async (tx): Promise<Outcome> => {
      const loaded = await loadPendingSubmission(tx, claims.sub, id);
      if (!loaded) return { kind: "not_found" };
      const { book, submission } = loaded;

      // STRICT re-validation of the untrusted payload (unknown keys stripped,
      // caps enforced, a name required — a missing/invalid name fails
      // here), then drop book-disabled fields. Nothing unvalidated or
      // ungated ever reaches `contacts`.
      const parsed = parseSubmissionPayload(submission.payload, book.enabledFields);
      if (!parsed.success) return { kind: "invalid" };
      const gated = parsed.data;

      // Concurrency gate: atomically flip pending → approved FIRST; a
      // concurrent approval of the same submission loses here and returns
      // without writing anything. If the insert below throws, the whole tx
      // (flip included) rolls back and the submission stays pending.
      if (!(await winApprovalFlip(tx, submission.id, book.id))) {
        return { kind: "not_found" };
      }

      const [{ updatedAtText: updatedAt, ...row }] = await tx
        .insert(contacts)
        .values({ bookId: book.id, ...toInsertRow(gated) })
        .returning({ ...getTableColumns(contacts), updatedAtText });
      return {
        kind: "ok",
        contactId: row.id,
        after: definedFields(rowToSnapshot(row)),
        updatedAt,
      };
    });
  } catch (err) {
    // Unique-violation ⇒ the tx rolled back: contact not created, submission
    // still pending, so the owner can Apply update / reject instead.
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: DUPLICATE_EMAIL };
    }
    logDbError("[rv] [approveNew] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (outcome.kind === "not_found") return { ok: false, error: NOT_FOUND };
  if (outcome.kind === "invalid") return { ok: false, error: INVALID_PAYLOAD };

  const eventId = await recordContactEvent(
    {
      contactId: outcome.contactId,
      diff: { after: outcome.after },
      contactUpdatedAt: outcome.updatedAt,
    },
    approvalActor(actor),
  );
  return { ok: true, contactId: outcome.contactId, eventId };
}

/** Approve a matched submission: merge the payload into the matched contact. */
export async function approveMergeAs(
  claims: SessionClaims,
  id: string,
  actor: Actor,
): Promise<ResolveResult> {
  type Outcome =
    | { kind: "not_found" }
    | { kind: "invalid" }
    | { kind: "no_match" }
    | {
        kind: "ok";
        contactId: string;
        diff: ReturnType<typeof changedFields>;
        updatedAt?: string;
      };

  let outcome: Outcome;
  try {
    outcome = await withRls(claims, async (tx): Promise<Outcome> => {
      const loaded = await loadPendingSubmission(tx, claims.sub, id);
      if (!loaded) return { kind: "not_found" };
      const { book, submission } = loaded;
      if (!submission.matchedContactId) return { kind: "no_match" };

      // Same strict-parse + gate as approveNewAs (see module doc).
      const token = submission.source === "token";
      const payload = token ? withoutBlanks(submission.payload) : submission.payload;
      const parsed = parseSubmissionPayload(payload, book.enabledFields);
      const partnerEmail = parsePartnerEmail(payload);
      if (!parsed.success || !partnerEmail.success) return { kind: "invalid" };
      const gated = parsed.data;

      // Scoped by id AND bookId (RLS backstops the same predicate). The FK
      // is ON DELETE SET NULL, so a dangling match is unreachable in
      // practice — no_match covers the race anyway.
      const [existing] = await tx
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.id, submission.matchedContactId),
            eq(contacts.bookId, book.id),
          ),
        )
        .limit(1);
      if (!existing) return { kind: "no_match" };

      // Merge semantics: PRESENT keys overwrite, ABSENT keys stay untouched.
      // Legit payloads are value-bearing by construction (submitToBook drops
      // empty values), and the strict parse turns "" into undefined — so an
      // empty string (only craftable by a hostile direct insert) is treated
      // as absent and can never CLEAR a column. This intentionally differs
      // from token updates, where a present-but-empty key means "clear".
      const before = rowToSnapshot(existing);
      const set = mergeUpdate(before, gated, {
        partnerEmail: partnerEmail.data,
        clear: token ? clearedFields(submission.payload, book.enabledFields) : [],
      });

      // Concurrency gate: atomically flip pending → approved after all the
      // read-only checks and BEFORE the contact write; a concurrent approval
      // loses here and returns without writing. A failed update below rolls
      // the flip back to pending.
      if (!(await winApprovalFlip(tx, submission.id, book.id))) {
        return { kind: "not_found" };
      }

      if (!set) {
        return { kind: "ok", contactId: existing.id, diff: undefined };
      }
      const [{ updatedAtText: updatedAt, ...row }] = await tx
        .update(contacts)
        .set(set)
        .where(
          and(eq(contacts.id, existing.id), eq(contacts.bookId, book.id)),
        )
        .returning({ ...getTableColumns(contacts), updatedAtText });
      // Diff the stored row so trigger-derived display strings are audited.
      return {
        kind: "ok",
        contactId: existing.id,
        diff: changedFields(before, rowToSnapshot(row)),
        updatedAt,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: DUPLICATE_EMAIL };
    }
    logDbError("[rv] [approveMerge] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (outcome.kind === "not_found") return { ok: false, error: NOT_FOUND };
  if (outcome.kind === "invalid") return { ok: false, error: INVALID_PAYLOAD };
  if (outcome.kind === "no_match") return { ok: false, error: NO_MATCH };

  // No audit row for a no-op merge (nothing changed).
  const eventId = outcome.diff
    ? await recordContactEvent(
        { contactId: outcome.contactId, diff: outcome.diff, contactUpdatedAt: outcome.updatedAt },
        approvalActor(actor),
      )
    : undefined;
  return { ok: true, contactId: outcome.contactId, eventId };
}

/** Reject a pending submission. No audit row — nothing changed. */
export async function rejectAs(claims: SessionClaims, id: string): Promise<ResolveResult> {
  let rejected: { id: string } | undefined;
  try {
    rejected = await withRls(claims, async (tx) => {
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return undefined;
      const [row] = await tx
        .update(submissions)
        .set({ status: "rejected" })
        .where(
          and(
            eq(submissions.id, id),
            eq(submissions.bookId, book.id),
            eq(submissions.status, "pending"),
          ),
        )
        .returning({ id: submissions.id });
      return row;
    });
  } catch (err) {
    logDbError("[rv] [reject] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!rejected) return { ok: false, error: NOT_FOUND };
  return { ok: true };
}
