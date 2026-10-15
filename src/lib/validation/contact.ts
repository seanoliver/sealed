import { z } from "zod";

/**
 * Optional free-text field: trimmed, capped at `max` (mirrors the SQL CHECK
 * constraints), and empty-after-trim becomes undefined so the DB stores NULL
 * rather than "".
 */
const opt = (max: number) =>
  z.string().trim().max(max).transform((s) => s === "" ? undefined : s).optional();

/**
 * Calendar-valid YYYY-MM-DD only. Roundtrips through Date because V8 rolls
 * over out-of-range days ("2025-02-30" parses as March 2) — the re-serialized
 * date must equal the input exactly.
 */
const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const contactSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(200),
  partner_name: opt(200),
  kids_names: opt(2000),
  email: z.string().trim().max(320).pipe(z.email().or(z.literal(""))).transform((s) => s === "" ? undefined : s).optional(),
  // refine: shape-valid but calendar-invalid dates ("2025-99-99") must never
  // reach the Postgres date cast — class-22 errors embed the value in logs
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, "Invalid date").or(z.literal("")).transform((s) => s === "" ? undefined : s).optional(),
  address_line1: opt(200), address_line2: opt(200),
  city: opt(120), state_region: opt(120),
  postal_code: opt(20), country: opt(120),
  notes: opt(2000),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const contactDetailsSchema = contactSchema.omit({
  full_name: true,
  partner_name: true,
  kids_names: true,
});
export type ContactDetailsInput = z.infer<typeof contactDetailsSchema>;

/** Form field names in display order; shared by the form, actions, and diffs. */
export const CONTACT_FIELDS = [
  "full_name",
  "partner_name",
  "kids_names",
  "email",
  "birthday",
  "address_line1",
  "address_line2",
  "city",
  "state_region",
  "postal_code",
  "country",
  "notes",
] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

/** Raw form values (all strings), echoed back through action state. */
export type ContactFormValues = Record<ContactField, string>;

/**
 * Recipient-editable fields (/u/[token]): everything except `notes`, which
 * is the owner's private field — recipients must never read or write it.
 */
export const TOKEN_UPDATE_FIELDS = [
  "full_name",
  "partner_name",
  "kids_names",
  "email",
  "birthday",
  "address_line1",
  "address_line2",
  "city",
  "state_region",
  "postal_code",
  "country",
] as const satisfies readonly ContactField[];

export type TokenUpdateField = (typeof TOKEN_UPDATE_FIELDS)[number];

/** contactSchema minus notes; unknown keys (incl. a smuggled `notes`) are stripped. */
export const tokenUpdateSchema = contactSchema.omit({ notes: true });

export const TOKEN_DETAIL_FIELDS = TOKEN_UPDATE_FIELDS.filter(
  (field) => field !== "full_name" && field !== "partner_name" && field !== "kids_names",
);
export const tokenDetailSchema = tokenUpdateSchema.omit({
  full_name: true,
  partner_name: true,
  kids_names: true,
});

/** Raw token-form values (all strings), echoed back through action state. */
export type TokenUpdateValues = Record<TokenUpdateField, string>;

export function readTokenDetails(formData: FormData): TokenUpdateValues {
  return Object.fromEntries(
    TOKEN_UPDATE_FIELDS.map((field) => [
      field,
      (TOKEN_DETAIL_FIELDS as readonly string[]).includes(field) ? String(formData.get(field) ?? "") : "",
    ]),
  ) as TokenUpdateValues;
}
