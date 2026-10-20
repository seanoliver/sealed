"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { contactDetailsToRow, householdToRow } from "@/lib/db/contact-row";
import { isUniqueViolation } from "@/lib/db/errors";
import { books, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { isUntouchedPrefill, type StoredNames } from "@/lib/names";
import {
  CONTACT_FIELDS,
  type ContactDetailsInput,
  type ContactFormValues,
} from "@/lib/validation/contact";
import {
  householdSchema,
  parseHouseholdForm,
  readHouseholdValues,
  type HouseholdFieldErrors,
  type HouseholdInput,
  type HouseholdValues,
} from "@/lib/validation/household";
import {
  changedFields,
  type ContactRow,
  createContactAs,
  DETAIL_FIELDS,
  type DetailField,
  DUPLICATE_EMAIL,
  GENERIC_ERROR,
  parseDetails,
  type ParsedDetails,
  patchContactAs,
  recordContactEvent,
  type Row,
  rowToSnapshot,
  storedNames,
  updatedAtText,
} from "./write";

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

export type PatchContactResult = { error?: string };

const uuidSchema = z.uuid();

const CHANGED_SINCE_OPENED = "This contact changed since you opened it. Reload to see the latest.";

function readContactForm(formData: FormData): ContactFormValues {
  return Object.fromEntries(
    CONTACT_FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
  ) as ContactFormValues;
}

function inputToRow(details: ContactDetailsInput, household: HouseholdInput): Row {
  return { ...householdToRow(household), ...contactDetailsToRow(details) };
}

type ParsedContactForm =
  | { ok: true; details: ContactDetailsInput; household: HouseholdInput }
  | { ok: false; state: ContactFormState };

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
  const created = await createContactAs(
    claims,
    { details: parsed.details, household: parsed.household },
    { source: "owner" },
  );
  if (!created.ok) return { error: created.error, ...echo };
  const inserted = created.value;

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

  const version = String(formData.get("version") ?? "");
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
      const [locked] = await tx
        .select({ contact: contacts, version: updatedAtText })
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)))
        .limit(1)
        .for("update");
      if (!locked) return undefined;
      const existing = locked.contact;
      if (locked.version !== version) {
        invalid = { error: CHANGED_SINCE_OPENED, ...echo };
        return existing;
      }
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
      if (changedFields(rowToSnapshot(existing), rowToSnapshot({ ...existing, ...row }))) {
        await tx
          .update(contacts)
          .set(row)
          .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)));
      }
      return existing;
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { error: DUPLICATE_EMAIL, ...echo };
    }
    logDbError("[ct] [updateContact] update failed", err);
    return { error: GENERIC_ERROR, ...echo };
  }
  if (!before) {
    return { error: "Contact not found.", ...echo };
  }
  if (invalid) return invalid;

  const diff = changedFields(rowToSnapshot(before), rowToSnapshot({ ...before, ...row }));
  if (diff) await recordContactEvent({ contactId: id, diff }, { source: "owner" });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${id}`);
  return { saved: true, ...echo };
}

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

export async function patchContact(
  id: string,
  patch: ContactPatch,
): Promise<PatchContactResult> {
  const claims = await requireUser();
  if (!uuidSchema.safeParse(id).success) return { error: "Contact not found." };
  const fields = patchSchema.safeParse(patch);
  if (!fields.success) return { error: "Invalid input" };

  const result = await patchContactAs(claims, id, fields.data, { source: "owner" });
  if (!result.ok) return { error: result.error };

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
