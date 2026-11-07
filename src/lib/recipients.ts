export type Recipient = "primary" | "partner";

export type AddressRecipient = {
  recipient: Recipient;
  email: string;
  firstName: string | null;
};

type ContactEmails = {
  email: string | null;
  partnerEmail: string | null;
  personalEmail?: string | null;
  partnerPersonalEmail?: string | null;
};

export function inviteAddresses(contact: ContactEmails): Partial<Record<Recipient, string>> {
  const primary = contact.personalEmail ?? contact.email;
  const partner = contact.partnerPersonalEmail ?? contact.partnerEmail;
  return {
    ...(primary !== null ? { primary } : {}),
    ...(partner !== null && partner.toLowerCase() !== primary?.toLowerCase() ? { partner } : {}),
  };
}

export function addressRecipients(
  contact: ContactEmails & { firstName: string | null; partnerFirstName: string | null },
): AddressRecipient[] {
  const { primary, partner } = inviteAddresses(contact);
  const out: AddressRecipient[] = [];
  if (primary !== undefined) {
    out.push({ recipient: "primary", email: primary, firstName: contact.firstName });
  }
  if (partner !== undefined) {
    out.push({ recipient: "partner", email: partner, firstName: contact.partnerFirstName });
  }
  return out;
}
