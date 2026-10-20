import "server-only";
import { asc } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { type ContactCsvRow } from "@/lib/csv/export";
import { withRls } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

export async function listCsvRows(claims: SessionClaims): Promise<ContactCsvRow[]> {
  return withRls(claims, (tx) =>
    tx
      .select({
        full_name: contacts.fullName,
        partner_name: contacts.partnerName,
        kids_names: contacts.kidsNames,
        first_name: contacts.firstName,
        last_name: contacts.lastName,
        partner_first_name: contacts.partnerFirstName,
        partner_last_name: contacts.partnerLastName,
        email: contacts.email,
        partner_email: contacts.partnerEmail,
        birthday: contacts.birthday,
        address_line1: contacts.addressLine1,
        address_line2: contacts.addressLine2,
        city: contacts.city,
        state_region: contacts.stateRegion,
        postal_code: contacts.postalCode,
        country: contacts.country,
        notes: contacts.notes,
      })
      .from(contacts)
      .orderBy(asc(contacts.fullName), asc(contacts.id)),
  );
}
