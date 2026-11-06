import { householdSize, pairSlots, type Slot } from "@/lib/household-match";
import { type StoredNames } from "@/lib/names";

export type MergeContact = StoredNames & {
  email: string | null;
  partnerEmail: string | null;
  birthday: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  district: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  countryCode: string | null;
  legacyCountry: string | null;
  notes: string | null;
};

export type MergeLine = { label: string; value: string };

export type MergePlan = {
  /** Columns to set on the kept contact. Names and filled fields never appear here. */
  set: Partial<MergeContact>;
  carried: MergeLine[];
  /** Values that go with the deleted contact. The confirm step must show these. */
  notKept: MergeLine[];
};

const ADDRESS_COLUMNS = [
  "addressLine1",
  "addressLine2",
  "district",
  "city",
  "stateRegion",
  "postalCode",
  "countryCode",
  "legacyCountry",
] as const;

const NOTES_MAX = 2000;

const sameEmail = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

const addressOf = (contact: MergeContact) =>
  [
    contact.addressLine1,
    contact.addressLine2,
    contact.district,
    contact.city,
    contact.stateRegion,
    contact.postalCode,
    contact.countryCode ?? contact.legacyCountry,
  ]
    .filter((part) => part !== null)
    .join(", ");

const EMAIL_COLUMN = { primary: "email", partner: "partnerEmail" } as const;
const SLOTS = ["primary", "partner"] as const;

/** Fills what the kept contact lacks. It never replaces a value or changes a name. */
export function planDuplicateMerge(keep: MergeContact, remove: MergeContact): MergePlan {
  const set: Partial<MergeContact> = {};
  const carried: MergeLine[] = [];
  const notKept: MergeLine[] = [];
  const { target, absent, single } = pairSlots(keep, remove);
  const slotName = (slot: Slot) => (slot === "primary" ? remove.fullName : remove.partnerName);

  // Only a lone contact gains a partner: the one person the other contact adds to them.
  const gainsPartner =
    keep.partnerName === null && keep.partnerFirstName === null && householdSize(keep) === 1;
  const gained = gainsPartner
    ? SLOTS.find((slot) => {
        const otherSlot = slot === "primary" ? "partner" : "primary";
        return single[slot] && absent[slot] && target[otherSlot] === "primary";
      })
    : undefined;
  if (gained) {
    const name = slotName(gained);
    set.partnerName = name;
    set.partnerFirstName = gained === "primary" ? remove.firstName : remove.partnerFirstName;
    set.partnerLastName = gained === "primary" ? remove.lastName : remove.partnerLastName;
    carried.push({ label: "Partner", value: name ?? "" });
  }
  for (const slot of SLOTS) {
    const name = slotName(slot);
    if (absent[slot] && slot !== gained && name !== null) notKept.push({ label: "Person", value: name });
  }

  // A value moves only with the person who owns it, so it can never land on someone else.
  const owner = (slot: Slot): Slot | null => target[slot] ?? (slot === gained ? "partner" : null);

  for (const slot of SLOTS) {
    const value = slot === "primary" ? remove.email : remove.partnerEmail;
    if (value === null) continue;
    const held = [keep.email, keep.partnerEmail, set.email ?? null, set.partnerEmail ?? null];
    if (held.some((email) => sameEmail(email, value))) continue;
    const to = owner(slot);
    const column = to && EMAIL_COLUMN[to];
    if (column && keep[column] === null && set[column] === undefined) {
      set[column] = value;
      carried.push({ label: column === "email" ? "Email" : "Partner email", value });
    } else {
      notKept.push({ label: "Email", value });
    }
  }

  // The birthday column belongs to the contact's own person.
  if (remove.birthday !== null && remove.birthday !== keep.birthday) {
    if (keep.birthday === null && target.primary === "primary") {
      set.birthday = remove.birthday;
      carried.push({ label: "Birthday", value: remove.birthday });
    } else {
      notKept.push({ label: "Birthday", value: remove.birthday });
    }
  }

  const keepHasAddress = ADDRESS_COLUMNS.some((column) => keep[column] !== null);
  const removeHasAddress = ADDRESS_COLUMNS.some((column) => remove[column] !== null);
  if (removeHasAddress && !keepHasAddress) {
    for (const column of ADDRESS_COLUMNS) {
      if (remove[column] !== null) set[column] = remove[column];
    }
    carried.push({ label: "Address", value: addressOf(remove) });
  } else if (removeHasAddress && ADDRESS_COLUMNS.some((column) => keep[column] !== remove[column])) {
    notKept.push({ label: "Address", value: addressOf(remove) });
  }

  if (remove.kidsNames !== null && remove.kidsNames !== keep.kidsNames) {
    if (keep.kidsNames === null && keep.kids === null) {
      set.kids = remove.kids;
      set.kidsNames = remove.kidsNames;
      carried.push({ label: "Kids", value: remove.kidsNames });
    } else {
      notKept.push({ label: "Kids", value: remove.kidsNames });
    }
  }

  if (remove.notes !== null && remove.notes !== keep.notes) {
    const notes = keep.notes === null ? remove.notes : `${keep.notes}\n\n${remove.notes}`;
    if (notes.length <= NOTES_MAX) {
      set.notes = notes;
      carried.push({ label: "Notes", value: remove.notes });
    } else {
      notKept.push({ label: "Notes", value: remove.notes });
    }
  }

  return { set, carried, notKept };
}
