import { formatPerson } from "@/lib/names";
import { type HouseholdValues } from "@/lib/validation/household";

export type ReplySnapshot = {
  household: HouseholdValues;
  address: string[];
  email: string;
  birthday: string;
};

export type Change =
  | { kind: "added"; name: string }
  | { kind: "removed"; name: string }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "address"; from: string; to: string }
  | { kind: "email"; from: string; to: string }
  | { kind: "birthday"; from: string; to: string };

const personName = (person: { first: string; last: string } | null): string | null =>
  person === null
    ? null
    : formatPerson({ first: person.first.trim(), last: person.last.trim() });

function personChange(from: string | null, to: string | null): Change | null {
  if (from === to) return null;
  if (from === null) return to === null ? null : { kind: "added", name: to };
  if (to === null) return { kind: "removed", name: from };
  return { kind: "renamed", from, to };
}

function without(list: string[], drop: string[]): string[] {
  const left = [...drop];
  return list.filter((item) => {
    const at = left.indexOf(item);
    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
}

export function whatChanged(before: ReplySnapshot, after: ReplySnapshot): Change[] {
  const changes: Change[] = [];
  const push = (change: Change | null) => {
    if (change) changes.push(change);
  };

  const primary = ({ household }: ReplySnapshot) =>
    personName({ first: household.first_name, last: household.last_name });
  push(personChange(primary(before), primary(after)));
  push(personChange(personName(before.household.partner), personName(after.household.partner)));
  const kidsBefore = before.household.kids.map(personName).filter((n): n is string => n !== null);
  const kidsAfter = after.household.kids.map(personName).filter((n): n is string => n !== null);
  for (const name of without(kidsBefore, kidsAfter)) push({ kind: "removed", name });
  for (const name of without(kidsAfter, kidsBefore)) push({ kind: "added", name });

  const from = before.address.join(", ");
  const to = after.address.join(", ");
  if (from !== to) push({ kind: "address", from, to });

  if (before.email.trim() !== after.email.trim()) {
    push({ kind: "email", from: before.email.trim(), to: after.email.trim() });
  }
  if (before.birthday !== after.birthday) {
    push({ kind: "birthday", from: before.birthday, to: after.birthday });
  }
  return changes;
}
