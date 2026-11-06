import { notFound } from "next/navigation";
import { z } from "zod";
import { DEFAULT_SENDER_COUNTRY } from "@/lib/address";
import { requireUser } from "@/lib/auth";
import { getOwnBook, getOwnProfile } from "@/lib/queries/books";
import { getContactWithEvents } from "@/lib/queries/contacts";
import { NameWithReading } from "@/components/name-with-reading";
import { householdPrefill } from "@/lib/names";
import { readingsForContact } from "@/lib/pinyin";
import { updateContact } from "../actions";
import { ContactEditor } from "./contact-editor";
import { ContactHistory } from "./contact-history";
import { DeleteContactButton } from "./delete-contact-button";

const uuidSchema = z.uuid();

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const claims = await requireUser();

  // Reject non-UUID ids before they hit a uuid cast in the query.
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const [detail, book, profile] = await Promise.all([
    getContactWithEvents(claims, id),
    getOwnBook(claims),
    getOwnProfile(claims),
  ]);
  // RLS makes another user's contact indistinguishable from a missing one.
  if (!detail) notFound();
  const { contact, version, events } = detail;
  const readings = await readingsForContact(contact);

  return (
    <ContactEditor
      action={updateContact}
      contactId={contact.id}
      version={version}
      from={profile?.displayName ?? ""}
      senderCountry={book?.senderCountry ?? DEFAULT_SENDER_COUNTRY}
      legacyCountry={contact.countryCode ? null : contact.legacyCountry}
      household={householdPrefill(contact)}
      heading={<NameWithReading text={contact.fullName} readings={readings} className="leading-[1.7]" />}
      defaults={{
        full_name: contact.fullName,
        partner_name: contact.partnerName ?? "",
        kids_names: contact.kidsNames ?? "",
        email: contact.email ?? "",
        partner_email: contact.partnerEmail ?? "",
        birthday: contact.birthday ?? "",
        address_line1: contact.addressLine1 ?? "",
        address_line2: contact.addressLine2 ?? "",
        district: contact.district ?? "",
        city: contact.city ?? "",
        state_region: contact.stateRegion ?? "",
        postal_code: contact.postalCode ?? "",
        country_code: contact.countryCode ?? "",
        notes: contact.notes ?? "",
      }}
    >
      <ContactHistory contact={contact} events={events} />

      <div className="mt-6">
        <DeleteContactButton contactId={contact.id} />
      </div>
    </ContactEditor>
  );
}
