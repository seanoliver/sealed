"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { contactDetailsToRow, householdToRow } from "@/lib/db/contact-row";
import { isUniqueViolation } from "@/lib/db/errors";
import { sameJsonb } from "@/lib/db/jsonb";
import { books, contactEvents, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { isUntouchedPrefill, type Kid, type StoredNames } from "@/lib/names";
import {
  CONTACT_FIELDS,
  contactDetailsSchema,
  type ContactDetailsInput,
  type ContactFormValues,
  SAME_PARTNER_EMAIL,
  samePartnerEmail,
} from "@/lib/validation/contact";
import {
  householdSchema,
  parseHouseholdForm,
  readHouseholdValues,
  type HouseholdFieldErrors,
  type HouseholdInput,
  type HouseholdValues,
} from "@/lib/validation/household";

export type ContactFormState = {
  error?: string;
  saved?: boolean;
  /**
   * Submitted values, echoed back on error. React 19 resets uncontrolled
   * inputs to their defaultValue after a form action completes — the form
   * uses these as defaults so a failed save doesn't wipe the user's input.
   */
  values?: ContactFormValues;
  household?: HouseholdValues;
  fieldErrors?: HouseholdFieldErrors;
};

export type DeleteContactState = { error?: string };

const uuidSchema = z.uuid();

function readContactForm(formData: FormData): ContactFormValues {
  return Object.fromEntries(
    CONTACT_FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
  ) as ContactFormValues;
}

const NAME_FIELDS = [
  "first_name",
  "last_name",
  "partner_first_name",
  "partner_last_name",
  "kids",
] as const;
const SNAPSHOT_FIELDS = [...CONTACT_FIELDS, ...NAME_FIELDS] as const;
type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Field snapshot keyed by form/schema names, for audit diffs. */
type Snapshot = Record<SnapshotField, string | readonly Kid[] | null>;

type ContactRow = typeof contacts.$inferSelect;
type Row = ReturnType<typeof householdToRow> & ReturnType<typeof contactDetailsToRow>;

function rowToSnapshot(row: Pick<ContactRow, keyof Row>): Snapshot {
  return {
    full_name: row.fullName,
    partner_name: row.partnerName,
    kids_names: row.kidsNames,
    email: row.email,
    partner_email: row.partnerEmail,
    birthday: row.birthday,
    address_line1: row.addressLine1,
    address_line2: row.addressLine2,
    city: row.city,
    state_region: row.stateRegion,
    postal_code: row.postalCode,
    country: row.country,
    notes: row.notes,
    first_name: row.firstName,
    last_name: row.lastName,
    partner_first_name: row.partnerFirstName,
    partner_last_name: row.partnerLastName,
    kids: row.kids,
  };
}

function inputToRow(details: ContactDetailsInput, household: HouseholdInput): Row {
  return { ...householdToRow(household), ...contactDetailsToRow(details) };
}

/** Non-null fields only — keeps create diffs compact. */
function definedFields(snap: Snapshot): Partial<Snapshot> {
  const out: Partial<Snapshot> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (snap[field] !== null) out[field] = snap[field];
  }
  return out;
}

/** Changed fields only, or undefined for a no-op save (no audit row). */
function changedFields(
  before: Snapshot,
  after: Snapshot,
): { before: Partial<Snapshot>; after: Partial<Snapshot> } | undefined {
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

type ParsedContactForm =
  | { ok: true; details: ContactDetailsInput; household: HouseholdInput }
  | { ok: false; state: ContactFormState };

type ParsedDetails =
  | { success: true; data: ContactDetailsInput }
  | { success: false; error: string; field?: "partner_email" };

function parseDetails(values: Partial<ContactFormValues>): ParsedDetails {
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

function detailsErrorState(
  details: Extract<ParsedDetails, { success: false }>,
): Pick<ContactFormState, "error" | "fieldErrors"> {
  return details.field
    ? { fieldErrors: { [details.field]: details.error } }
    : { error: details.error };
}

function withStoredPartnerEmail(
  formData: FormData,
  values: ContactFormValues,
  existing: ContactRow,
): ContactFormValues {
  return formData.has("partner_email")
    ? values
    : { ...values, partner_email: existing.partnerEmail ?? "" };
}

function parseContactForm(
  formData: FormData,
  { values = readContactForm(formData) }: { values?: ContactFormValues } = {},
): ParsedContactForm {
  const household = parseHouseholdForm(formData);
  const details = parseDetails(values);
  if (household.ok && details.success) {
    return { ok: true, details: details.data, household: household.data };
  }
  const detailErrors = details.success ? {} : detailsErrorState(details);
  const fieldErrors = {
    ...(household.ok ? {} : household.fieldErrors),
    ...detailErrors.fieldErrors,
  };
  return {
    ok: false,
    state: {
      error: detailErrors.error ?? (household.ok ? undefined : household.error),
      fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
      values,
      household: household.values,
    },
  };
}

/**
 * Audit append — the ONLY sanctioned dbAdmin use in this module.
 * contact_events is client-unwritable by design (no insert policy/grant for
 * `authenticated`), so the row is written via the admin connection after the
 * RLS-scoped write has already succeeded. Best-effort: an audit failure is
 * logged, never surfaced as a user-facing error for a write that committed.
 */
async function recordContactEvent(
  contactId: string,
  diff: Record<string, unknown>,
): Promise<void> {
  try {
    await dbAdmin
      .insert(contactEvents)
      .values({ contactId, source: "owner", diff });
  } catch (err) {
    logDbError("[ct] [recordContactEvent] audit insert failed", err);
  }
}

export async function createContact(
  _prevState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const claims = await requireUser();

  const parsed = parseContactForm(formData);
  if (!parsed.ok) return parsed.state;
  const echo = {
    values: readContactForm(formData),
    household: readHouseholdValues(formData),
  };
  const row = inputToRow(parsed.details, parsed.household);

  let inserted: { id: string } | undefined;
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
        .returning({ id: contacts.id });
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return {
        error: "You already have a contact with this email",
        ...echo,
      };
    }
    logDbError("[ct] [createContact] insert failed", err);
    return {
      error: "Something went wrong. Please try again.",
      ...echo,
    };
  }
  if (!inserted) {
    return { error: "Set up your address book first.", ...echo };
  }

  await recordContactEvent(inserted.id, {
    after: definedFields(rowToSnapshot(row)),
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${inserted.id}`);
  redirect("/dashboard");
}

export async function updateContact(
  _prevState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const claims = await requireUser();

  const echo = {
    values: readContactForm(formData),
    household: readHouseholdValues(formData),
  };
  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) {
    return { error: "Contact not found.", ...echo };
  }

  let before: ContactRow | undefined;
  let row: Partial<Row> | undefined;
  let invalid: ContactFormState | undefined;
  try {
    before = await withRls(claims, async (tx) => {
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return undefined;
      // Scoped by id AND bookId (RLS backstops the same predicate).
      const [existing] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)))
        .limit(1);
      if (!existing) return undefined;
      const values = withStoredPartnerEmail(formData, echo.values, existing);
      const keepNames = isUntouchedPrefill(
        storedNames(existing),
        readHouseholdValues(formData, { kidsLimit: Infinity }),
      );
      if (keepNames) {
        const details = parseDetails(values);
        if (!details.success) {
          invalid = { ...detailsErrorState(details), ...echo };
          return existing;
        }
        row = contactDetailsToRow(details.data);
      } else {
        const parsed = parseContactForm(formData, { values });
        if (!parsed.ok) {
          invalid = parsed.state;
          return existing;
        }
        row = inputToRow(parsed.details, parsed.household);
      }
      await tx
        .update(contacts)
        .set(row)
        .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)));
      return existing;
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return {
        error: "You already have a contact with this email",
        ...echo,
      };
    }
    logDbError("[ct] [updateContact] update failed", err);
    return {
      error: "Something went wrong. Please try again.",
      ...echo,
    };
  }
  if (!before) {
    return { error: "Contact not found.", ...echo };
  }
  if (invalid) return invalid;

  const diff = changedFields(rowToSnapshot(before), rowToSnapshot({ ...before, ...row }));
  if (diff) await recordContactEvent(id, diff);

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${id}`);
  return { saved: true, ...echo };
}

export type PatchContactResult = { error?: string };

const DETAIL_FIELDS = CONTACT_FIELDS.filter(
  (field) => field !== "full_name" && field !== "partner_name" && field !== "kids_names",
);
type DetailField = (typeof DETAIL_FIELDS)[number];

// No name fields here: writing full_name alone clears the structured names.
const patchSchema = z.strictObject({
  values: z
    .strictObject(
      Object.fromEntries(
        DETAIL_FIELDS.map((field) => [field, z.string().optional()]),
      ) as Record<DetailField, z.ZodOptional<z.ZodString>>,
    )
    .optional(),
  household: householdSchema().optional(),
  namesBase: z.unknown().optional(),
});

export type ContactPatch = {
  values?: Partial<Record<DetailField, string>>;
  household?: z.input<ReturnType<typeof householdSchema>>;
  namesBase?: StoredNames;
};

const NAMES_CHANGED =
  "This contact's names changed since you opened them. Reload to see the new names.";

function storedNames(row: ContactRow): StoredNames {
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

export async function patchContact(
  id: string,
  patch: ContactPatch,
): Promise<PatchContactResult> {
  const claims = await requireUser();
  if (!uuidSchema.safeParse(id).success) return { error: "Contact not found." };
  const fields = patchSchema.safeParse(patch);
  if (!fields.success) return { error: "Invalid input" };
  const names = fields.data.household;

  type Outcome =
    | { kind: "missing" }
    | { kind: "invalid"; error: string }
    | { kind: "saved"; before: Snapshot; after: Snapshot };
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
      if (names && !sameJsonb(storedNames(existing), fields.data.namesBase)) {
        return { kind: "invalid", error: NAMES_CHANGED };
      }
      const parsed = parseDetails({
        ...rowToDetailValues(existing),
        ...fields.data.values,
      });
      if (!parsed.success) return { kind: "invalid", error: parsed.error };
      const row = {
        ...contactDetailsToRow(parsed.data),
        ...(names ? householdToRow(names) : {}),
      };
      const before = rowToSnapshot(existing);
      const after = rowToSnapshot({ ...existing, ...row });
      // A no-op save must not bump updated_at.
      if (changedFields(before, after)) {
        await tx
          .update(contacts)
          .set(row)
          .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)));
      }
      return { kind: "saved", before, after };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { error: "You already have a contact with this email" };
    }
    logDbError("[ct] [patchContact] update failed", err);
    return { error: "Something went wrong. Please try again." };
  }
  if (outcome.kind === "missing") return { error: "Contact not found." };
  if (outcome.kind === "invalid") return { error: outcome.error };

  const diff = changedFields(outcome.before, outcome.after);
  if (diff) await recordContactEvent(id, diff);

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${id}`);
  return {};
}

export async function deleteContact(
  _prevState: DeleteContactState,
  formData: FormData,
): Promise<DeleteContactState> {
  const claims = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) {
    return { error: "Contact not found." };
  }

  let deleted: { id: string } | undefined;
  try {
    deleted = await withRls(claims, async (tx) => {
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return undefined;
      const [row] = await tx
        .delete(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)))
        .returning({ id: contacts.id });
      return row;
    });
  } catch (err) {
    logDbError("[ct] [deleteContact] delete failed", err);
    return { error: "Something went wrong. Please try again." };
  }
  if (!deleted) {
    return { error: "Contact not found." };
  }

  // No audit row for deletes: contact_events.contact_id references
  // contacts(id) ON DELETE CASCADE, so a delete-audit row would either
  // violate the FK (inserted after) or be cascade-removed with the contact
  // (inserted before). The trail intentionally lives and dies with the
  // contact.

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
