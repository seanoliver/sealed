import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { contactDetailsToRow, householdToRow } from "@/lib/db/contact-row";
import { isUniqueViolation } from "@/lib/db/errors";
import { sameJsonb } from "@/lib/db/jsonb";
import { books, contactEvents, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { householdPrefill, type Kid, type StoredNames } from "@/lib/names";
import {
  CONTACT_FIELDS,
  contactDetailsSchema,
  type ContactDetailsInput,
  type ContactFormValues,
  SAME_PARTNER_EMAIL,
  samePartnerEmail,
} from "@/lib/validation/contact";
import { householdSchema, type HouseholdInput } from "@/lib/validation/household";

/**
 * Contact writes shared by the dashboard's server actions and the agent tools.
 * Never import this from a "use server" module's exports: every function here
 * trusts the `claims` it is handed.
 */

export const NAME_FIELDS = [
  "first_name",
  "last_name",
  "partner_first_name",
  "partner_last_name",
  "kids",
] as const;
export const SNAPSHOT_FIELDS = [...CONTACT_FIELDS, ...NAME_FIELDS] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Field snapshot keyed by form/schema names, for audit diffs. */
export type Snapshot = Record<SnapshotField, string | readonly Kid[] | null>;
export type ContactDiff = { before: Partial<Snapshot>; after: Partial<Snapshot> };

export type ContactRow = typeof contacts.$inferSelect;
export type Row = ReturnType<typeof householdToRow> & ReturnType<typeof contactDetailsToRow>;

const SNAPSHOT_COLUMNS = {
  full_name: "fullName",
  partner_name: "partnerName",
  kids_names: "kidsNames",
  email: "email",
  partner_email: "partnerEmail",
  birthday: "birthday",
  address_line1: "addressLine1",
  address_line2: "addressLine2",
  city: "city",
  state_region: "stateRegion",
  postal_code: "postalCode",
  country: "country",
  notes: "notes",
  first_name: "firstName",
  last_name: "lastName",
  partner_first_name: "partnerFirstName",
  partner_last_name: "partnerLastName",
  kids: "kids",
} as const satisfies Record<SnapshotField, keyof Row>;

export function rowToSnapshot(row: Pick<ContactRow, keyof Row>): Snapshot {
  return Object.fromEntries(
    SNAPSHOT_FIELDS.map((field) => [field, row[SNAPSHOT_COLUMNS[field]]]),
  ) as Snapshot;
}

/** Stored snapshot values back to column values; unknown keys are dropped. */
export function snapshotToRow(snap: Partial<Record<string, unknown>>): Partial<Row> {
  const row: Record<string, unknown> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (field in snap) row[SNAPSHOT_COLUMNS[field]] = snap[field] ?? null;
  }
  return row as Partial<Row>;
}

/** Non-null fields only — keeps create diffs compact. */
export function definedFields(snap: Snapshot): Partial<Snapshot> {
  const out: Partial<Snapshot> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (snap[field] !== null) out[field] = snap[field];
  }
  return out;
}

/** Changed fields only, or undefined for a no-op save (no audit row). */
export function changedFields(before: Snapshot, after: Snapshot): ContactDiff | undefined {
  const diff = { before: {} as Partial<Snapshot>, after: {} as Partial<Snapshot> };
  let changed = false;
  for (const field of SNAPSHOT_FIELDS) {
    if (!sameJsonb(before[field], after[field])) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
      changed = true;
    }
  }
  return changed ? diff : undefined;
}

export type ParsedDetails =
  | { success: true; data: ContactDetailsInput }
  | { success: false; error: string; field?: "partner_email" };

export function parseDetails(values: Partial<ContactFormValues>): ParsedDetails {
  const details = contactDetailsSchema.safeParse(values);
  if (!details.success) {
    const issue = details.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input",
      field: issue?.path[0] === "partner_email" ? "partner_email" : undefined,
    };
  }
  return samePartnerEmail(details.data)
    ? { success: false, error: SAME_PARTNER_EMAIL, field: "partner_email" }
    : details;
}

export const DETAIL_FIELDS = CONTACT_FIELDS.filter(
  (field) => field !== "full_name" && field !== "partner_name" && field !== "kids_names",
);
export type DetailField = (typeof DETAIL_FIELDS)[number];

export function storedNames(row: ContactRow): StoredNames {
  return {
    fullName: row.fullName,
    partnerName: row.partnerName,
    kidsNames: row.kidsNames,
    firstName: row.firstName,
    lastName: row.lastName,
    partnerFirstName: row.partnerFirstName,
    partnerLastName: row.partnerLastName,
    kids: row.kids,
  };
}

function rowToDetailValues(row: ContactRow): Record<DetailField, string> {
  const snap = rowToSnapshot(row);
  return Object.fromEntries(
    DETAIL_FIELDS.map((field) => [field, snap[field] ?? ""]),
  ) as Record<DetailField, string>;
}

const NAMES_CHANGED =
  "This contact's names changed since you opened them. Reload to see the new names.";

/** Name fields to change on top of the stored ones; null clears a field. */
export type NamePatch = Partial<{
  first_name: string;
  last_name: string | null;
  partner_first_name: string | null;
  partner_last_name: string | null;
  kids: Kid[] | null;
}>;

export type PatchRequest = {
  values?: Partial<Record<DetailField, string>>;
  /** The whole household, as the sheet's name editor submits it. */
  household?: HouseholdInput;
  /** The names the sheet's editor started from; a mismatch refuses the save. */
  namesBase?: unknown;
  names?: NamePatch;
};

function mergeNames(existing: ContactRow, names: NamePatch): unknown {
  const prefill = householdPrefill(storedNames(existing));
  const merged = {
    first_name: prefill.first_name,
    last_name: prefill.last_name,
    partner_first_name: prefill.partner?.first,
    partner_last_name: prefill.partner?.last,
    kids: prefill.kids,
    ...names,
  };
  const partnerRemoved = names.partner_first_name === null;
  return {
    ...merged,
    last_name: merged.last_name ?? undefined,
    partner_first_name: merged.partner_first_name?.trim() ? merged.partner_first_name : undefined,
    partner_last_name: partnerRemoved ? undefined : (merged.partner_last_name ?? undefined),
    kids: merged.kids ?? undefined,
  };
}

export type PatchPlan =
  | { kind: "invalid"; error: string }
  | { kind: "ok"; row: Partial<Row>; before: Snapshot; after: Snapshot; diff?: ContactDiff };

/** Validate a patch against the stored row, the same rules for every caller. */
export function planPatch(existing: ContactRow, request: PatchRequest): PatchPlan {
  let household = request.household;
  if (household && !sameJsonb(storedNames(existing), request.namesBase)) {
    return { kind: "invalid", error: NAMES_CHANGED };
  }
  if (request.names && Object.keys(request.names).length > 0) {
    const parsed = householdSchema().safeParse(mergeNames(existing, request.names));
    if (!parsed.success) {
      return { kind: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid name" };
    }
    household = parsed.data;
  }
  const parsed = parseDetails({ ...rowToDetailValues(existing), ...request.values });
  if (!parsed.success) return { kind: "invalid", error: parsed.error };
  const row = {
    ...contactDetailsToRow(parsed.data),
    ...(household ? householdToRow(household) : {}),
  };
  const before = rowToSnapshot(existing);
  const after = rowToSnapshot({ ...existing, ...row });
  return { kind: "ok", row, before, after, diff: changedFields(before, after) };
}

/** Who made a change. `submission` is the owner approving a reply in the review queue. */
export type Actor =
  | { source: "owner" | "submission" }
  | { source: "agent"; tokenId: string; previewId?: string };

export type EventInput = {
  contactId: string;
  diff: Record<string, unknown>;
  /** updated_at as Postgres text (microseconds intact); kept for agent undo. */
  contactUpdatedAt?: string;
};

/**
 * Audit append. contact_events is client-unwritable by design (no insert
 * grant for `authenticated`), so rows go through the admin connection after
 * the RLS-scoped write commits. Best-effort: a failure is logged, never
 * surfaced as an error for a write that committed.
 */
export async function recordContactEvents(
  events: EventInput[],
  actor: Actor,
): Promise<(string | undefined)[]> {
  if (events.length === 0) return [];
  const agent = actor.source === "agent" ? actor : undefined;
  try {
    const rows = await dbAdmin
      .insert(contactEvents)
      .values(
        events.map(({ contactId, diff, contactUpdatedAt }) => ({
          contactId,
          source: actor.source,
          diff,
          agentTokenId: agent?.tokenId,
          agentPreviewId: agent?.previewId,
          contactUpdatedAt:
            agent && contactUpdatedAt !== undefined
              ? sql`${contactUpdatedAt}::timestamptz`
              : undefined,
        })),
      )
      .returning({ id: contactEvents.id });
    return rows.map((row) => row.id);
  } catch (err) {
    logDbError("[ct] [recordContactEvents] audit insert failed", err);
    return events.map(() => undefined);
  }
}

export async function recordContactEvent(event: EventInput, actor: Actor) {
  const [id] = await recordContactEvents([event], actor);
  return id;
}

/** Postgres text keeps microseconds; a JS Date would round them off. */
export const updatedAtText = sql<string>`${contacts.updatedAt}::text`;

export const DUPLICATE_EMAIL = "You already have a contact with this email";
export const GENERIC_ERROR = "Something went wrong. Please try again.";

export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function patchContactAs(
  claims: SessionClaims,
  id: string,
  request: PatchRequest,
  actor: Actor,
): Promise<WriteResult<{ diff?: ContactDiff; eventId?: string }>> {
  type Outcome =
    | { kind: "missing" }
    | { kind: "invalid"; error: string }
    | { kind: "saved"; diff?: ContactDiff; updatedAt?: string };
  let outcome: Outcome;
  try {
    outcome = await withRls(claims, async (tx): Promise<Outcome> => {
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return { kind: "missing" };
      const [existing] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)))
        .limit(1)
        .for("update");
      if (!existing) return { kind: "missing" };
      const plan = planPatch(existing, request);
      if (plan.kind === "invalid") return plan;
      // A no-op save must not bump updated_at.
      if (!plan.diff) return { kind: "saved" };
      const [saved] = await tx
        .update(contacts)
        .set(plan.row)
        .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)))
        .returning({ updatedAt: updatedAtText });
      return { kind: "saved", diff: plan.diff, updatedAt: saved.updatedAt };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: DUPLICATE_EMAIL };
    }
    logDbError("[ct] [patchContactAs] update failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (outcome.kind === "missing") return { ok: false, error: "Contact not found." };
  if (outcome.kind === "invalid") return { ok: false, error: outcome.error };
  const eventId = outcome.diff
    ? await recordContactEvent(
        { contactId: id, diff: outcome.diff, contactUpdatedAt: outcome.updatedAt },
        actor,
      )
    : undefined;
  return { ok: true, value: { diff: outcome.diff, eventId } };
}

export async function createContactAs(
  claims: SessionClaims,
  input: { details: ContactDetailsInput; household: HouseholdInput },
  actor: Actor,
): Promise<WriteResult<{ id: string; eventId?: string }>> {
  const row = { ...householdToRow(input.household), ...contactDetailsToRow(input.details) };
  let inserted: { id: string; updatedAt: string } | undefined;
  try {
    inserted = await withRls(claims, async (tx) => {
      // Resolve the book inside the RLS tx — never trust a client bookId.
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return undefined;
      const [created] = await tx
        .insert(contacts)
        .values({ bookId: book.id, ...row })
        .returning({ id: contacts.id, updatedAt: updatedAtText });
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: DUPLICATE_EMAIL };
    }
    logDbError("[ct] [createContactAs] insert failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!inserted) return { ok: false, error: "Set up your address book first." };
  const eventId = await recordContactEvent(
    {
      contactId: inserted.id,
      diff: { after: definedFields(rowToSnapshot(row)) },
      contactUpdatedAt: inserted.updatedAt,
    },
    actor,
  );
  return { ok: true, value: { id: inserted.id, eventId } };
}
