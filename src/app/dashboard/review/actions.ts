"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withRls, type RlsTx } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { contactInputToRow as toRow } from "@/lib/db/contact-row";
import { isUniqueViolation } from "@/lib/db/errors";
import { books, contactEvents, contacts, submissions } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { formatPerson, type Kid } from "@/lib/names";
import {
  TOKEN_UPDATE_FIELDS,
  type TokenUpdateField,
} from "@/lib/validation/contact";
import {
  dropDisabledFields,
  isHouseholdPayload,
  parseSubmissionPayload,
  type SubmissionPayload,
} from "@/lib/validation/submission";

/**
 * Review-queue actions. `submissions.payload` is ATTACKER-CONTROLLED jsonb
 * (public permalink submissions; submit_to_book does not gate enabled_fields
 * and stores whatever object it was handed). Every approval therefore:
 *   1. re-validates the payload through the STRICT parseSubmissionPayload
 *      (household or legacy shape; unknown keys — including a smuggled
 *      `notes` — stripped, per-field caps, a name required), and
 *   2. drops fields DISABLED on the book (dropDisabledFields)
 * BEFORE anything touches `contacts`. The DB CHECK constraints are the third
 * net. Display-side gating (review/page.tsx) uses the same dropDisabledFields
 * helper, so display and merge can never disagree.
 */

export type ReviewActionState = { error?: string };

const uuidSchema = z.uuid();

const GENERIC_ERROR = "Something went wrong. Please try again.";
const NOT_FOUND = "Submission not found — it may already be reviewed.";
const INVALID_PAYLOAD =
  "This submission contains invalid data and can't be approved — reject it instead.";
const DUPLICATE_EMAIL =
  "You already have a contact with this email — use Apply update on the matching card or reject this one.";

const NAME_FIELDS = [
  "first_name",
  "last_name",
  "partner_first_name",
  "partner_last_name",
  "kids",
] as const;

/** Every contact field a submission can write, for audit diffs. */
const SNAPSHOT_FIELDS = [...TOKEN_UPDATE_FIELDS, ...NAME_FIELDS] as const;
type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Field snapshot keyed by schema names. No `notes`: it can never arrive via a submission. */
type Snapshot = Record<TokenUpdateField, string | null> & {
  first_name: string | null;
  last_name: string | null;
  partner_first_name: string | null;
  partner_last_name: string | null;
  kids: Kid[] | null;
};

function rowToSnapshot(row: typeof contacts.$inferSelect): Snapshot {
  return {
    full_name: row.fullName,
    partner_name: row.partnerName,
    kids_names: row.kidsNames,
    email: row.email,
    birthday: row.birthday,
    address_line1: row.addressLine1,
    address_line2: row.addressLine2,
    city: row.city,
    state_region: row.stateRegion,
    postal_code: row.postalCode,
    country: row.country,
    first_name: row.firstName,
    last_name: row.lastName,
    partner_first_name: row.partnerFirstName,
    partner_last_name: row.partnerLastName,
    kids: row.kids,
  };
}

// jsonb reorders object keys, so kids compare with sorted keys.
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Non-null fields only — keeps create diffs compact. */
function definedFields(snap: Snapshot): Partial<Snapshot> {
  const out: Partial<Record<SnapshotField, unknown>> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (snap[field] !== null) out[field] = snap[field];
  }
  return out as Partial<Snapshot>;
}

type SnapshotDiff = { before: Partial<Snapshot>; after: Partial<Snapshot> };

/** Changed fields only, or undefined for a no-op merge (no audit row). */
function changedFields(
  before: Snapshot,
  after: Snapshot,
): SnapshotDiff | undefined {
  const diff = {
    before: {} as Partial<Record<SnapshotField, unknown>>,
    after: {} as Partial<Record<SnapshotField, unknown>>,
  };
  let changed = false;
  for (const field of SNAPSHOT_FIELDS) {
    if (!sameValue(before[field], after[field])) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
      changed = true;
    }
  }
  return changed ? (diff as SnapshotDiff) : undefined;
}

/** Schema field name → contacts column name, for the merge update. */
const FIELD_TO_COLUMN = {
  full_name: "fullName",
  partner_name: "partnerName",
  kids_names: "kidsNames",
  email: "email",
  birthday: "birthday",
  address_line1: "addressLine1",
  address_line2: "addressLine2",
  city: "city",
  state_region: "stateRegion",
  postal_code: "postalCode",
  country: "country",
  first_name: "firstName",
  last_name: "lastName",
  partner_first_name: "partnerFirstName",
  partner_last_name: "partnerLastName",
  kids: "kids",
} as const satisfies Record<SnapshotField, keyof typeof contacts.$inferInsert>;

/**
 * Contact columns for a new contact. fullName is NOT NULL in the insert
 * type; for household payloads the trigger re-derives it (and the partner
 * and kids display strings) from the structured names.
 */
function toInsertRow(payload: SubmissionPayload) {
  if (!isHouseholdPayload(payload)) return toRow(payload);
  const {
    first_name,
    last_name,
    partner_first_name,
    partner_last_name,
    kids,
    ...rest
  } = payload;
  return {
    ...toRow({
      ...rest,
      full_name: formatPerson({ first: first_name, last: last_name }) ?? "",
    }),
    firstName: first_name,
    lastName: last_name,
    partnerFirstName: partner_first_name ?? null,
    partnerLastName: partner_last_name ?? null,
    kids: kids ?? null,
  };
}

/**
 * Fields a merge writes: present keys only. A submitted partner is written
 * as a whole group, so a partner with no last name clears the old one.
 */
function mergePatch(payload: SubmissionPayload): Partial<Snapshot> {
  const patch: Partial<Record<SnapshotField, unknown>> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) patch[key as SnapshotField] = value;
  }
  if (isHouseholdPayload(payload) && payload.partner_first_name !== undefined) {
    patch.partner_last_name = payload.partner_last_name ?? null;
  }
  return patch as Partial<Snapshot>;
}

/**
 * Audit append — the ONLY sanctioned dbAdmin use in this module.
 * contact_events is client-unwritable by design (no insert policy/grant for
 * `authenticated`), so the row is written via the admin connection after the
 * RLS-scoped write has already succeeded. Best-effort: an audit failure is
 * logged, never surfaced as a user-facing error for a write that committed.
 */
async function recordSubmissionEvent(
  contactId: string,
  diff: Record<string, unknown>,
): Promise<void> {
  try {
    await dbAdmin
      .insert(contactEvents)
      .values({ contactId, source: "submission", diff });
  } catch (err) {
    logDbError("[rv] [recordSubmissionEvent] audit insert failed", err);
  }
}

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
export async function approveNew(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) return { error: NOT_FOUND };

  type Outcome =
    | { kind: "not_found" }
    | { kind: "invalid" }
    | { kind: "ok"; contactId: string; after: Partial<Snapshot> };

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
      const parsed = parseSubmissionPayload(submission.payload);
      if (!parsed.success) return { kind: "invalid" };
      const gated = dropDisabledFields(parsed.data, book.enabledFields);

      // Concurrency gate: atomically flip pending → approved FIRST; a
      // concurrent approval of the same submission loses here and returns
      // without writing anything. If the insert below throws, the whole tx
      // (flip included) rolls back and the submission stays pending.
      if (!(await winApprovalFlip(tx, submission.id, book.id))) {
        return { kind: "not_found" };
      }

      const [row] = await tx
        .insert(contacts)
        .values({ bookId: book.id, ...toInsertRow(gated) })
        .returning();
      return {
        kind: "ok",
        contactId: row.id,
        after: definedFields(rowToSnapshot(row)),
      };
    });
  } catch (err) {
    // Unique-violation ⇒ the tx rolled back: contact not created, submission
    // still pending, so the owner can Apply update / reject instead.
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { error: DUPLICATE_EMAIL };
    }
    logDbError("[rv] [approveNew] failed", err);
    return { error: GENERIC_ERROR };
  }
  if (outcome.kind === "not_found") return { error: NOT_FOUND };
  if (outcome.kind === "invalid") return { error: INVALID_PAYLOAD };

  await recordSubmissionEvent(outcome.contactId, { after: outcome.after });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");
  return {};
}

/** Approve a matched submission: merge the payload into the matched contact. */
export async function approveMerge(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) return { error: NOT_FOUND };

  type Outcome =
    | { kind: "not_found" }
    | { kind: "invalid" }
    | { kind: "no_match" }
    | {
        kind: "ok";
        contactId: string;
        diff: ReturnType<typeof changedFields>;
      };

  let outcome: Outcome;
  try {
    outcome = await withRls(claims, async (tx): Promise<Outcome> => {
      const loaded = await loadPendingSubmission(tx, claims.sub, id);
      if (!loaded) return { kind: "not_found" };
      const { book, submission } = loaded;
      if (!submission.matchedContactId) return { kind: "no_match" };

      // Same strict-parse + gate as approveNew (see module doc).
      const parsed = parseSubmissionPayload(submission.payload);
      if (!parsed.success) return { kind: "invalid" };
      const gated = dropDisabledFields(parsed.data, book.enabledFields);

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
      const patch = mergePatch(gated);
      const changed = SNAPSHOT_FIELDS.filter(
        (field) => field in patch && !sameValue(before[field], patch[field]),
      );

      // Concurrency gate: atomically flip pending → approved after all the
      // read-only checks and BEFORE the contact write; a concurrent approval
      // loses here and returns without writing. A failed update below rolls
      // the flip back to pending.
      if (!(await winApprovalFlip(tx, submission.id, book.id))) {
        return { kind: "not_found" };
      }

      if (changed.length === 0) {
        return { kind: "ok", contactId: existing.id, diff: undefined };
      }
      const set: Partial<Record<string, unknown>> = {};
      for (const field of changed) set[FIELD_TO_COLUMN[field]] = patch[field];
      const [row] = await tx
        .update(contacts)
        .set(set as Partial<typeof contacts.$inferInsert>)
        .where(
          and(eq(contacts.id, existing.id), eq(contacts.bookId, book.id)),
        )
        .returning();
      // Diff the stored row so trigger-derived display strings are audited.
      return {
        kind: "ok",
        contactId: existing.id,
        diff: changedFields(before, rowToSnapshot(row)),
      };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { error: DUPLICATE_EMAIL };
    }
    logDbError("[rv] [approveMerge] failed", err);
    return { error: GENERIC_ERROR };
  }
  if (outcome.kind === "not_found") return { error: NOT_FOUND };
  if (outcome.kind === "invalid") return { error: INVALID_PAYLOAD };
  if (outcome.kind === "no_match") {
    return {
      error:
        "This submission isn't linked to an existing contact — use Add contact instead.",
    };
  }

  // No audit row for a no-op merge (nothing changed).
  if (outcome.diff) {
    await recordSubmissionEvent(outcome.contactId, outcome.diff);
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${outcome.contactId}`);
  revalidatePath("/dashboard/review");
  return {};
}

/** Reject a pending submission. No audit row — nothing changed. */
export async function reject(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) return { error: NOT_FOUND };

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
    return { error: GENERIC_ERROR };
  }
  if (!rejected) return { error: NOT_FOUND };

  revalidatePath("/dashboard/review");
  return {};
}
