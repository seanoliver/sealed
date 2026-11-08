import { formatPerson } from "@/lib/names";
import { type HouseholdDraft, type Person } from "@/components/envelope-names";

export type ReplySnapshot = {
  household: HouseholdDraft;
  address: string[];
  email: string;
  personalEmail: string;
  birthday: string;
};

export type Change =
  | { kind: "added"; name: string }
  | { kind: "removed"; name: string }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "address"; from: string; to: string }
  | { kind: "email"; from: string; to: string }
  | { kind: "personal_email"; from: string; to: string }
  | { kind: "birthday"; from: string; to: string };

const personName = (person: Person | undefined): string | null =>
  person === undefined ? null : formatPerson({ first: person.first.trim(), last: person.last.trim() });

const people = ({ primary, partner, kids }: HouseholdDraft): Person[] =>
  partner ? [primary, partner, ...kids] : [primary, ...kids];

function personChange(from: string | null, to: string | null): Change | null {
  if (from === to) return null;
  if (from === null) return to === null ? null : { kind: "added", name: to };
  if (to === null) return { kind: "removed", name: from };
  return { kind: "renamed", from, to };
}

export function whatChanged(before: ReplySnapshot, after: ReplySnapshot): Change[] {
  const changes: Change[] = [];
  const push = (change: Change | null) => {
    if (change) changes.push(change);
  };

  // People are matched by draft key, so a name edit is one rename even when a last name followed the household.
  const was = people(before.household);
  const now = people(after.household);
  for (const person of was) {
    push(personChange(personName(person), personName(now.find((p) => p.key === person.key))));
  }
  for (const person of now) {
    if (!was.some((p) => p.key === person.key)) push(personChange(null, personName(person)));
  }

  const from = before.address.join(", ");
  const to = after.address.join(", ");
  if (from !== to) push({ kind: "address", from, to });

  if (before.email.trim() !== after.email.trim()) {
    push({ kind: "email", from: before.email.trim(), to: after.email.trim() });
  }
  if (before.personalEmail.trim() !== after.personalEmail.trim()) {
    push({
      kind: "personal_email",
      from: before.personalEmail.trim(),
      to: after.personalEmail.trim(),
    });
  }
  if (before.birthday !== after.birthday) {
    push({ kind: "birthday", from: before.birthday, to: after.birthday });
  }
  return changes;
}
