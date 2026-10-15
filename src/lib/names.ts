/**
 * Household name helpers. formatPerson and formatKids must match
 * private.format_person / private.format_kids in
 * supabase/migrations/00000000000004_household_names.sql exactly: the
 * database derives the stored display strings, and these produce the same
 * strings before a row exists (review queue, insert placeholders). The
 * shared fixture in supabase/tests/database/03_household_names.sql guards
 * both sides.
 */

import { KIDS_MAX, type HouseholdValues } from "@/lib/validation/household";

export type Kid = { first: string; last?: string };

const present = (s: string | null | undefined): s is string =>
  s !== null && s !== undefined && s !== "";

/** "First Last", skipping absent parts; null when both are absent. */
export function formatPerson({
  first,
  last,
}: {
  first?: string | null;
  last?: string | null;
}): string | null {
  const parts = [first, last].filter(present);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Kids who share `familyLast` (or have no last name) appear by first name
 * only; everyone else by full name.
 */
export function formatKids({
  kids,
  familyLast,
}: {
  kids: readonly Kid[] | null | undefined;
  familyLast?: string | null;
}): string | null {
  const names = (kids ?? []).map((kid) =>
    !present(kid.last) || kid.last === familyLast
      ? kid.first
      : formatPerson({ first: kid.first, last: kid.last }),
  );
  const joined = names.join(", ");
  return joined === "" ? null : joined;
}

/** Legacy prefill: the last word is the last name ("Mary Ann Smith" → Mary Ann / Smith). */
export function naiveSplit(fullName: string): { first: string; last: string } {
  const words = fullName.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length <= 1) return { first: words[0] ?? "", last: "" };
  return {
    first: words.slice(0, -1).join(" "),
    last: words[words.length - 1],
  };
}

/** Legacy prefill: "Zoe, Max and Ivy" → ["Zoe", "Max", "Ivy"]. */
export function splitKids(kidsNames: string): string[] {
  return kidsNames
    .split(/,|\s+and\s+/i)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** A contact's names as stored: display strings plus structured groups (null when unsplit). */
export type StoredNames = {
  fullName: string;
  partnerName: string | null;
  kidsNames: string | null;
  firstName: string | null;
  lastName: string | null;
  partnerFirstName: string | null;
  partnerLastName: string | null;
  kids: readonly Kid[] | null;
};

type Person = { first: string; last: string };

const isSplit = (names: StoredNames) =>
  names.firstName !== null && names.lastName !== null;

function contactPerson(names: StoredNames): Person {
  return isSplit(names)
    ? { first: names.firstName ?? "", last: names.lastName ?? "" }
    : naiveSplit(names.fullName);
}

function partnerPerson(names: StoredNames): Person | null {
  if (names.partnerFirstName !== null) {
    return { first: names.partnerFirstName, last: names.partnerLastName ?? "" };
  }
  return present(names.partnerName) ? naiveSplit(names.partnerName) : null;
}

/**
 * One line for the household: "Jen & Mark Holloway" when the partner shares
 * the last name (or has none), "Priya Raman & Daniel Okafor" when not, and
 * the contact's own name when there is no partner.
 */
export function householdLine(names: StoredNames): string {
  const partner = partnerPerson(names);
  if (partner === null) return names.fullName;
  const person = contactPerson(names);
  if (partner.last === "" || partner.last === person.last) {
    return (
      formatPerson({ first: `${person.first} & ${partner.first}`, last: person.last }) ??
      names.fullName
    );
  }
  return isSplit(names)
    ? `${formatPerson(person)} & ${formatPerson(partner)}`
    : `${names.fullName} & ${names.partnerName}`;
}

export function kidsCount(names: StoredNames): number {
  return names.kids?.length ?? splitKids(names.kidsNames ?? "").length;
}

export function kidsSummary(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "1 kid" : `${count} kids`;
}

/**
 * Form prefill. Stored structure wins; a legacy contact gets naiveSplit /
 * splitKids guesses, which are only stored if the form is submitted. Kids
 * (and a legacy one-word partner) follow the contact's last name.
 */
export function householdPrefill(
  names: StoredNames,
  { partner = true, kids = true }: { partner?: boolean; kids?: boolean } = {},
): HouseholdValues {
  const person = contactPerson(names);
  const storedPartner = partner ? partnerPerson(names) : null;
  return {
    first_name: person.first,
    last_name: person.last,
    partner:
      storedPartner === null
        ? null
        : {
            first: storedPartner.first,
            last:
              names.partnerFirstName === null && storedPartner.last === ""
                ? person.last
                : storedPartner.last,
          },
    kids: !kids
      ? []
      : names.kids !== null
        ? names.kids.map((kid) => ({ first: kid.first, last: kid.last ?? person.last }))
        : splitKids(names.kidsNames ?? "")
            .slice(0, KIDS_MAX)
            .map((first) => ({ first, last: person.last })),
  };
}

/** Sort key for "Last name"; undefined for an unsplit contact. */
export function lastNameKey(names: StoredNames): Person | undefined {
  return isSplit(names) ? contactPerson(names) : undefined;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export function compareLastName(a: Person, b: Person): number {
  return collator.compare(a.last, b.last) || collator.compare(a.first, b.first);
}
