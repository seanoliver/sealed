export type PostalAddress = {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  country: string | null;
};

const clean = (value: string | null) => value?.trim() ?? "";

/** Envelope lines, or null when there is no street line to mail to. */
export function addressLines(address: PostalAddress): string[] | null {
  const street = [clean(address.addressLine1), clean(address.addressLine2)]
    .filter(Boolean)
    .join(", ");
  if (!clean(address.addressLine1)) return null;
  const region = [clean(address.stateRegion), clean(address.postalCode)]
    .filter(Boolean)
    .join(" ");
  const locality = [clean(address.city), region].filter(Boolean).join(", ");
  return [street, locality, clean(address.country)].filter(Boolean);
}
