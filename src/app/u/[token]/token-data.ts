import { z } from "zod";
import { type PostalAddress } from "@/lib/address";
import { householdPrefill, type StoredNames } from "@/lib/names";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";

/** Fails closed: drift in get_contact_for_token's jsonb must never reach the recipient's DOM. */
export const tokenDataSchema = z.object({
  contact: z.object({
    full_name: z.string().nullable(),
    partner_name: z.string().nullable(),
    kids_names: z.string().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    partner_first_name: z.string().nullable(),
    partner_last_name: z.string().nullable(),
    kids: z
      .array(z.object({ first: z.string(), last: z.string().optional() }))
      .nullable(),
    email: z.string().nullable(),
    birthday: z.string().nullable(),
    address_line1: z.string().nullable(),
    address_line2: z.string().nullable(),
    district: z.string().nullable(),
    city: z.string().nullable(),
    state_region: z.string().nullable(),
    postal_code: z.string().nullable(),
    country_code: z.string().nullable(),
    country: z.string().nullable(),
  }),
  enabled_fields: z.object({
    partner_name: z.boolean(),
    kids_names: z.boolean(),
    birthday: z.boolean(),
  }),
  owner_name: z.string(),
  /** Full names for the "From ..." line, e.g. "Sean Oliver and Tina Hee"; null falls back to owner_name. */
  sender_full_names: z.string().nullable(),
  sender_country: z.string(),
  recipient: z.enum(["primary", "partner"]),
  /** A string, not a Date: a Date drops the microseconds seen_at is compared at. */
  updated_at: z.string(),
});

export type TokenData = z.infer<typeof tokenDataSchema>;

// Postgres jsonb timestamptz: 2026-10-19T12:34:56.123456+00:00
const SEEN_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;

export function readSeenAt(formData: FormData): string | null {
  const value = formData.get("seen_at");
  return typeof value === "string" && SEEN_AT.test(value) ? value : null;
}
type TokenContact = TokenData["contact"];

export const tokenAddress = (contact: TokenContact): PostalAddress => ({
  addressLine1: contact.address_line1,
  addressLine2: contact.address_line2,
  district: contact.district,
  city: contact.city,
  stateRegion: contact.state_region,
  postalCode: contact.postal_code,
  countryCode: contact.country_code,
  legacyCountry: contact.country_code ? null : contact.country,
});

export const storedNames = (contact: TokenContact): StoredNames => ({
  fullName: contact.full_name ?? "",
  partnerName: contact.partner_name,
  kidsNames: contact.kids_names,
  firstName: contact.first_name,
  lastName: contact.last_name,
  partnerFirstName: contact.partner_first_name,
  partnerLastName: contact.partner_last_name,
  kids: contact.kids,
});

// PII: blank a disabled field's stored value here, don't just hide it. Form
// props are embedded in the RSC payload, so it would show in the page source.
export function recipientPrefill(data: TokenData): {
  household: HouseholdValues;
  defaults: TokenUpdateValues;
} {
  const { contact, enabled_fields } = data;
  return {
    household: householdPrefill(storedNames(contact), {
      partner: enabled_fields.partner_name,
      kids: enabled_fields.kids_names,
    }),
    defaults: {
      full_name: "",
      partner_name: "",
      kids_names: "",
      email: contact.email ?? "",
      birthday: enabled_fields.birthday ? (contact.birthday ?? "") : "",
      address_line1: contact.address_line1 ?? "",
      address_line2: contact.address_line2 ?? "",
      district: contact.district ?? "",
      city: contact.city ?? "",
      state_region: contact.state_region ?? "",
      postal_code: contact.postal_code ?? "",
      country_code: contact.country_code ?? "",
    },
  };
}
