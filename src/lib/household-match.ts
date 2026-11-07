import { isHouseholdLabel, isSplit, type StoredNames } from "@/lib/names";

/** A match only flags a pair: two people can share a name, so never merge or skip on one. */

export type MatchableNames = Pick<
  StoredNames,
  "fullName" | "partnerName" | "firstName" | "lastName" | "partnerFirstName" | "partnerLastName"
>;

export type HouseholdMatch = "same_people" | "shares_person";

export type ContactPair = { a: string; b: string };
export type DuplicatePair = ContactPair & { match: HouseholdMatch };

type Person = { first: string; rest: string };

function normalize(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

const nameWords = (name: string) => normalize(name).split(" ").filter((word) => word !== "");

const couples = (name: string) => name.split(/\s*[&+/]\s*|\s+and\s+/i);

type NamedPerson = Person & { slot: Slot; label: boolean };

export type Slot = "primary" | "partner";

function namedPeople(names: MatchableNames): NamedPerson[] {
  const labelled = !isSplit(names) && isHouseholdLabel(names.fullName);
  const label = labelled ? normalize(names.fullName) : "";
  const primary = isSplit(names)
    ? [names.firstName, names.lastName].filter(Boolean).join(" ")
    : names.fullName;
  const partner =
    names.partnerFirstName !== null
      ? [names.partnerFirstName, names.partnerLastName].filter(Boolean).join(" ")
      : (names.partnerName ?? "");
  const inSlot = (name: string, slot: Slot) =>
    couples(name).map((text) => ({ words: nameWords(text), slot }));
  const named = [...(labelled ? [] : inSlot(primary, "primary")), ...inSlot(partner, "partner")].filter(
    ({ words }) => words.length > 0,
  );

  const surnamed = named.findLast(({ words }) => words.length > 1);
  const surname =
    isSplit(names) && names.lastName ? normalize(names.lastName) : surnamed?.words.at(-1);
  const people = named.map(({ words: [first, ...rest], slot }) => ({
    first,
    rest: rest.length > 0 ? rest.join(" ") : (surname ?? ""),
    slot,
    label: false,
  }));
  return label === ""
    ? people
    : [{ first: label, rest: "", slot: "primary", label: true }, ...people];
}

const peopleIn = (names: MatchableNames): Person[] => namedPeople(names);

const samePerson = (a: Person, b: Person) =>
  a.first === b.first && (a.rest === b.rest || a.rest === "" || b.rest === "");

function compareSets(a: Person[], b: Person[]): HouseholdMatch | null {
  if (a.length === 0 || b.length === 0) return null;
  const unmatched = [...b];
  let paired = 0;
  for (const person of a) {
    const index = unmatched.findIndex((other) => samePerson(person, other));
    if (index === -1) continue;
    unmatched.splice(index, 1);
    paired += 1;
  }
  if (paired === 0) return null;
  return paired === a.length && a.length === b.length ? "same_people" : "shares_person";
}

export function compareHouseholds(a: MatchableNames, b: MatchableNames): HouseholdMatch | null {
  return compareSets(peopleIn(a), peopleIn(b));
}

/** An update names the same contact only when its people sit in the same slots. */
export function sameSlots(contact: MatchableNames, update: MatchableNames): boolean {
  const onlyIn = (people: NamedPerson[], slot: Slot) => {
    const found = people.filter((person) => person.slot === slot);
    return found.length === 1 && !found[0].label ? found[0] : null;
  };
  const kept = namedPeople(contact);
  const sent = namedPeople(update);
  const person = onlyIn(sent, "primary");
  const keptPerson = onlyIn(kept, "primary");
  if (!person || !keptPerson || !samePerson(keptPerson, person)) return false;
  if (!sent.some((candidate) => candidate.slot === "partner")) return true;
  const partner = onlyIn(sent, "partner");
  const keptPartner = onlyIn(kept, "partner");
  return partner !== null && keptPartner !== null && samePerson(keptPartner, partner);
}

const strongestFirst = <T extends { match: HouseholdMatch }>(a: T, b: T) =>
  Number(a.match === "shares_person") - Number(b.match === "shares_person");

export function orderedPair(first: string, second: string): ContactPair {
  return first < second ? { a: first, b: second } : { a: second, b: first };
}

const pairKey = ({ a, b }: ContactPair) => `${a}:${b}`;

/** Pairs grow with the square of contacts sharing a first word, so both are bounded. */
export const MAX_PAIRS = 500;
export const MAX_SHARED_FIRST = 300;

export function detectDuplicates(
  contacts: readonly (MatchableNames & { id: string })[],
  { dismissed = [] }: { dismissed?: readonly ContactPair[] } = {},
): DuplicatePair[] {
  const skipped = new Set(dismissed.map(pairKey));
  const households = new Map(contacts.map((contact) => [contact.id, peopleIn(contact)]));
  const sharingFirst = new Map<string, string[]>();
  for (const [id, people] of households) {
    for (const first of new Set(people.map((person) => person.first))) {
      const ids = sharingFirst.get(first);
      if (ids) ids.push(id);
      else sharingFirst.set(first, [id]);
    }
  }

  const pairs = new Map<string, DuplicatePair>();
  search: for (const ids of sharingFirst.values()) {
    if (ids.length > MAX_SHARED_FIRST) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (pairs.size >= MAX_PAIRS) break search;
        const pair = orderedPair(ids[i], ids[j]);
        const key = pairKey(pair);
        if (pairs.has(key) || skipped.has(key)) continue;
        const match = compareSets(households.get(pair.a) ?? [], households.get(pair.b) ?? []);
        if (match) pairs.set(key, { ...pair, match });
      }
    }
  }
  return [...pairs.values()]
    .sort((x, y) => pairKey(x).localeCompare(pairKey(y)))
    .sort(strongestFirst);
}

export function duplicateRows(
  rows: readonly MatchableNames[],
  book: readonly (MatchableNames & { id: string })[],
): number[] {
  const seen = book.map((names) => peopleIn(names));
  return rows.flatMap((row, index) => {
    const people = peopleIn(row);
    const matched = seen.some((other) => compareSets(people, other) !== null);
    seen.push(people);
    return matched ? [index] : [];
  });
}

export type ParsedBook = { id: string; people: Person[] }[];

export const parseBook = (contacts: readonly (MatchableNames & { id: string })[]): ParsedBook =>
  contacts.map((contact) => ({ id: contact.id, people: peopleIn(contact) }));

export function matchInBook(
  candidate: MatchableNames,
  book: ParsedBook,
): { id: string; match: HouseholdMatch }[] {
  const people = peopleIn(candidate);
  return book
    .flatMap(({ id, people: other }) => {
      const match = compareSets(people, other);
      return match ? [{ id, match }] : [];
    })
    .sort(strongestFirst);
}
