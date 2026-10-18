import "server-only";
import { formatKids, formatPerson } from "@/lib/names";
import {
  type ContactDetailsInput,
  type ContactInput,
} from "@/lib/validation/contact";
import { type HouseholdInput } from "@/lib/validation/household";

/**
 * Parsed contact input → drizzle column values (cleared optionals become
 * NULL). Shared by the single-contact CRUD actions and the CSV import.
 */
export function contactInputToRow(d: ContactInput) {
  return {
    fullName: d.full_name,
    partnerName: d.partner_name ?? null,
    kidsNames: d.kids_names ?? null,
    ...contactDetailsToRow(d),
  };
}

// Write the display strings too: the trigger never clears one when its
// partner or kids group is removed.
export function householdToRow(h: HouseholdInput) {
  return {
    firstName: h.first_name,
    lastName: h.last_name ?? null,
    fullName: formatPerson({ first: h.first_name, last: h.last_name }) ?? h.first_name,
    partnerFirstName: h.partner_first_name ?? null,
    partnerLastName: h.partner_last_name ?? null,
    partnerName: formatPerson({ first: h.partner_first_name, last: h.partner_last_name }),
    kids: h.kids ?? null,
    kidsNames: formatKids({ kids: h.kids, familyLast: h.last_name }),
  };
}

export function contactDetailsToRow(d: ContactDetailsInput) {
  return {
    email: d.email ?? null,
    birthday: d.birthday ?? null,
    addressLine1: d.address_line1 ?? null,
    addressLine2: d.address_line2 ?? null,
    city: d.city ?? null,
    stateRegion: d.state_region ?? null,
    postalCode: d.postal_code ?? null,
    country: d.country ?? null,
    notes: d.notes ?? null,
  };
}
