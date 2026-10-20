import { z } from "zod";
import { isCountryCode } from "@/lib/address/countries";
import { normalizeAddress, postcodeProblem, type AddressInput } from "@/lib/address/rules";
import "./zod-locale";

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

const countryCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => s === "" || isCountryCode(s), "Pick a country from the list")
  .transform((s) => (s === "" ? undefined : s))
  .optional();

const optEmail = z.string().trim().max(320).pipe(z.email().or(z.literal(""))).transform((s) => s === "" ? undefined : s).optional();

export const contactSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(200),
  partner_name: opt(200),
  kids_names: opt(2000),
  email: optEmail,
  partner_email: optEmail,
  // refine: shape-valid but calendar-invalid dates ("2025-99-99") must never
  // reach the Postgres date cast — class-22 errors embed the value in logs
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, "Invalid date").or(z.literal("")).transform((s) => s === "" ? undefined : s).optional(),
  address_line1: opt(200), address_line2: opt(200), district: opt(120),
  city: opt(120), state_region: opt(120),
  postal_code: opt(20), country_code: countryCode,
  notes: opt(2000),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const SAME_PARTNER_EMAIL = "The partner's email must differ from the email";

/** Mirrors contacts_partner_email_differs, which compares ignoring case. */
export function samePartnerEmail(d: { email?: string; partner_email?: string }): boolean {
  return (
    d.email !== undefined &&
    d.partner_email !== undefined &&
    d.email.toLowerCase() === d.partner_email.toLowerCase()
  );
}

export function withoutSamePartnerEmail(d: ContactInput): ContactInput {
  return samePartnerEmail(d) ? { ...d, partner_email: undefined } : d;
}

export type AddressCheck<T> =
  | { ok: true; data: T }
  | { ok: false; field: "postal_code"; error: string };

export function checkAddress<T extends AddressInput>(
  data: T,
  { stored }: { stored?: { postal_code?: string | null; country_code?: string | null } } = {},
): AddressCheck<T> {
  const normalized = normalizeAddress(data);
  const unchanged =
    stored !== undefined &&
    (stored.postal_code ?? undefined) === normalized.postal_code &&
    (stored.country_code ?? undefined) === normalized.country_code;
  const problem = unchanged ? null : postcodeProblem(normalized.country_code, normalized.postal_code);
  return problem ? { ok: false, field: "postal_code", error: problem } : { ok: true, data: normalized };
}

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
  "partner_email",
  "birthday",
  "address_line1",
  "address_line2",
  "district",
  "city",
  "state_region",
  "postal_code",
  "country_code",
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
  "district",
  "city",
  "state_region",
  "postal_code",
  "country_code",
] as const satisfies readonly ContactField[];

export type TokenUpdateField = (typeof TOKEN_UPDATE_FIELDS)[number];

/** Unknown keys (incl. a smuggled `notes`) are stripped. No `partner_email`:
 *  each recipient edits only their own address, through `email`. */
export const tokenUpdateSchema = contactSchema.omit({ notes: true, partner_email: true });

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
