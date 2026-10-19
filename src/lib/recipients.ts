export type Recipient = "primary" | "partner";

export type AddressRecipient = {
  recipient: Recipient;
  email: string;
  firstName: string | null;
};

export function addressRecipients(contact: {
  email: string | null;
  partnerEmail: string | null;
  firstName: string | null;
  partnerFirstName: string | null;
}): AddressRecipient[] {
  const out: AddressRecipient[] = [];
  if (contact.email !== null) {
    out.push({ recipient: "primary", email: contact.email, firstName: contact.firstName });
  }
  if (contact.partnerEmail !== null) {
    out.push({
      recipient: "partner",
      email: contact.partnerEmail,
      firstName: contact.partnerFirstName,
    });
  }
  return out;
}
