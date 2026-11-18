import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnBook, getOwnProfile } from "@/lib/queries/books";
import { BLANK_HOUSEHOLD_VALUES } from "@/lib/validation/household";
import { createContact } from "../actions";
import { ContactEditor } from "../[id]/contact-editor";

export default async function NewContactPage() {
  const claims = await requireUser();
  const [book, profile] = await Promise.all([getOwnBook(claims), getOwnProfile(claims)]);

  // Onboarding: no book yet → set one up first.
  if (!book) redirect("/onboarding");

  return (
    <ContactEditor
      action={createContact}
      from={profile?.displayName ?? ""}
      senderCountry={book.senderCountry}
      legacyCountry={null}
      household={BLANK_HOUSEHOLD_VALUES}
      heading="Add a contact"
      intro="Only the name is required. You can fill in the rest later, or send them an invite."
      defaults={{
        full_name: "",
        partner_name: "",
        kids_names: "",
        email: "",
        partner_email: "",
        personal_email: "",
        partner_personal_email: "",
        email_kind: "",
        partner_email_kind: "",
        birthday: "",
        address_line1: "",
        address_line2: "",
        district: "",
        city: "",
        state_region: "",
        postal_code: "",
        country_code: "",
        notes: "",
      }}
    />
  );
}
