import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { contactsToCsv } from "@/lib/csv/export";
import { withRls } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

/**
 * Downloads all of the caller's contacts as CSV. Unauthenticated requests are
 * redirected to the entry page by requireUser (redirect() works in route handlers).
 * RLS scopes the select to the caller's own book.
 */
export async function GET(): Promise<Response> {
  const claims = await requireUser();

  const rows = await withRls(claims, (tx) =>
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

  // UTF-8 BOM so Excel decodes accented names correctly; parseContactsCsv
  // strips it on re-import, so round-tripping is unaffected.
  return new Response("\uFEFF" + contactsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="address-book.csv"',
      "Cache-Control": "no-store",
    },
  });
}
