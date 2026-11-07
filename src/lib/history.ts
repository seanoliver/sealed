import { countryName, getCountry } from "@/lib/address";
import { ADDRESS_FIELDS, fieldLabel, type AddressField } from "@/lib/address/fields";
import { isNoOpReply } from "@/lib/contacts-sheet";
import {
  isHouseholdLabel,
  naiveSplit,
  type StoredNames,
} from "@/lib/names";

// Diff shapes: docs/investigations/2026-11-02-contact-event-diff-shapes.md.
// Recipients write these values: return plain strings only and assume no shape.

export type HistoryRow = { label: string; before: string; after: string };

export type HistoryEntry =
  | { kind: "created" }
  | { kind: "confirmed" }
  | { kind: "changed"; rows: HistoryRow[]; undo: boolean; mergedFrom?: string }
  | { kind: "unknown" };

type Side = Record<string, unknown>;

export const MAX_VALUE_CHARS = 120;
export const EMPTY_VALUE = "none";
const UNREADABLE = "(unreadable)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const isRecord = (value: unknown): value is Side =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const has = (side: Side, key: string) => Object.hasOwn(side, key);

function cap(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

function plain(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return UNREADABLE;
}

// Display names only: a diff that carries the split without them (an imported
// contact's first save) changed nothing visible.
function displayName(side: Side, key: string): string | null | undefined {
  return has(side, key) ? plain(side[key]) : undefined;
}

function country(side: Side): string | null | undefined {
  if (!has(side, "country_code") && !has(side, "country")) return undefined;
  const code = side.country_code;
  if (typeof code === "string" && code !== "") return countryName(code);
  return plain(side.country);
}

const BIRTHDAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function birthday(value: unknown, { year }: { year: boolean }): string | null {
  const text = plain(value);
  const match = text === null ? null : BIRTHDAY.exec(text);
  if (!match) return text;
  const month = MONTHS[Number(match[2]) - 1];
  if (month === undefined) return text;
  const day = `${month} ${Number(match[3])}`;
  return year ? `${day}, ${match[1]}` : day;
}

type FieldReader = {
  key: string;
  label: (code: string | null) => string;
  read: (side: Side, options: { year: boolean }) => string | null | undefined;
};

const simple = (key: string, label: string): FieldReader => ({
  key,
  label: () => label,
  read: (side) => (has(side, key) ? plain(side[key]) : undefined),
});

const addressField = (key: AddressField): FieldReader => ({
  key,
  label: (code) => fieldLabel(key, getCountry(code)),
  read: (side) => (has(side, key) ? plain(side[key]) : undefined),
});

// Same order and labels as the contact form. The name split stays out: the
// display names derive from it (ADR 0001).
const FIELDS: FieldReader[] = [
  { key: "name", label: () => "Name", read: (side) => displayName(side, "full_name") },
  {
    key: "partner",
    label: () => "Partner",
    read: (side) => displayName(side, "partner_name"),
  },
  { key: "kids", label: () => "Kids", read: (side) => displayName(side, "kids_names") },
  simple("email", "Email"),
  simple("partner_email", "Partner email"),
  simple("personal_email", "Personal email"),
  simple("partner_personal_email", "Partner personal email"),
  simple("email_kind", "Email type"),
  simple("partner_email_kind", "Partner email type"),
  {
    key: "birthday",
    label: () => "Birthday",
    read: (side, options) => (has(side, "birthday") ? birthday(side.birthday, options) : undefined),
  },
  { key: "country", label: () => "Country", read: country },
  ...ADDRESS_FIELDS.map(addressField),
  simple("notes", "Notes"),
];

function countryCodeOf(...sides: (Side | undefined)[]): string | null {
  for (const side of sides) {
    const code = side?.country_code;
    if (typeof code === "string" && code !== "") return code;
  }
  return null;
}

function changedRows(before: Side, after: Side, contactCountry: string | null): HistoryRow[] {
  const code = countryCodeOf(after, before) ?? contactCountry;
  const rows: HistoryRow[] = [];
  for (const field of FIELDS) {
    let was = field.read(before, { year: false });
    let now = field.read(after, { year: false });
    // Partial diffs list a key on both sides; a key on one side only says nothing.
    if (was === undefined || now === undefined) continue;
    if (was === now) {
      // Birthdays drop the year, so only the year changed: show it.
      if (field.key !== "birthday" || before.birthday === after.birthday) continue;
      was = field.read(before, { year: true });
      now = field.read(after, { year: true });
    }
    rows.push({
      label: field.label(code),
      before: cap(was ?? EMPTY_VALUE),
      after: cap(now ?? EMPTY_VALUE),
    });
  }
  return rows;
}

/** `countryCode` labels address fields when the diff carries no country. */
export function describeEvent(
  event: { source: string; diff: unknown },
  { countryCode = null }: { countryCode?: string | null } = {},
): HistoryEntry {
  const diff = event.diff;
  if (!isRecord(diff)) return { kind: "unknown" };
  const before = isRecord(diff.before) ? diff.before : undefined;
  const after = isRecord(diff.after) ? diff.after : undefined;

  if (!before) return after ? { kind: "created" } : { kind: "unknown" };
  if (event.source === "token" && isNoOpReply(diff)) return { kind: "confirmed" };

  // Older token replies stored no `after`; their payload doesn't say what was applied.
  if (!after) return { kind: "unknown" };

  const rows = changedRows(before, after, countryCode);
  if (isRecord(diff.merged_from)) {
    const mergedFrom = cap(plain(diff.merged_from.full_name) ?? "another contact");
    return { kind: "changed", rows, undo: false, mergedFrom };
  }
  if (rows.length === 0) {
    // A reply whose visible fields all match is a confirm, even when a
    // hidden field (the name split) moved.
    return event.source === "token" ? { kind: "confirmed" } : { kind: "unknown" };
  }
  return { kind: "changed", rows, undo: typeof diff.undo_of === "string" };
}

type Names = Pick<
  StoredNames,
  "fullName" | "firstName" | "partnerName" | "partnerFirstName"
>;

export function recipientName(
  names: Names,
  { recipient = "primary" }: { recipient?: string | null } = {},
): string {
  if (recipient === "partner") {
    const partner =
      names.partnerFirstName ?? (names.partnerName ? naiveSplit(names.partnerName).first : "");
    if (partner.trim() !== "") return partner;
  }
  const primary =
    names.firstName ??
    (isHouseholdLabel(names.fullName) ? names.fullName.trim() : naiveSplit(names.fullName).first);
  return primary.trim() === "" ? "The recipient" : primary;
}

const SOURCE_LABELS: Record<string, string> = {
  owner: "You",
  submission: "Permalink submission",
};

export function eventActor(
  event: { source: string; recipient?: string | null; agentName?: string | null },
  names: Names,
): string {
  if (event.source === "agent") return `Agent: ${event.agentName ?? "removed token"}`;
  if (event.source === "token") {
    return `${recipientName(names, { recipient: event.recipient })}, through their link`;
  }
  return SOURCE_LABELS[event.source] ?? "Someone";
}
