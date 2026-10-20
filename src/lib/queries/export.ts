import "server-only";
import { asc, eq } from "drizzle-orm";
import { countryName, DEFAULT_SENDER_COUNTRY, envelopeLines, rowAddress } from "@/lib/address";
import { type SessionClaims } from "@/lib/auth";
import { type ContactCsvRow } from "@/lib/csv/export";
import { withRls } from "@/lib/db";
import { books, contacts } from "@/lib/db/schema";
import { householdLine, pickStoredNames } from "@/lib/names";

export async function listCsvRows(claims: SessionClaims): Promise<ContactCsvRow[]> {
  const { rows, senderCountry } = await withRls(claims, async (tx) => {
    const [book] = await tx
      .select({ senderCountry: books.senderCountry })
      .from(books)
      .where(eq(books.ownerId, claims.sub))
      .limit(1);
    const found = await tx
      .select()
      .from(contacts)
      .orderBy(asc(contacts.fullName), asc(contacts.id));
    return { rows: found, senderCountry: book?.senderCountry ?? DEFAULT_SENDER_COUNTRY };
  });
  return rows.map((row) => {
    const address = rowAddress(row);
    return {
      full_name: row.fullName,
      partner_name: row.partnerName,
      kids_names: row.kidsNames,
      first_name: row.firstName,
      last_name: row.lastName,
      partner_first_name: row.partnerFirstName,
      partner_last_name: row.partnerLastName,
      email: row.email,
      partner_email: row.partnerEmail,
      birthday: row.birthday,
      address_line1: row.addressLine1,
      address_line2: row.addressLine2,
      district: row.district,
      city: row.city,
      state_region: row.stateRegion,
      postal_code: row.postalCode,
      country_code: row.countryCode,
      country: row.countryCode ? countryName(row.countryCode) : address.legacyCountry,
      notes: row.notes,
      envelope:
        envelopeLines(address, { name: householdLine(pickStoredNames(row)), senderCountry })?.join(
          "\n",
        ) ?? null,
    };
  });
}
