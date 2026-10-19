import {
  formatKids,
  formatPerson,
  householdLine,
  householdPrefill,
  kidsCount,
  kidsSummary,
  isSplit,
  type StoredNames,
} from "@/lib/names";
import { addressLines } from "@/lib/address";
import type { FailureReason } from "@/lib/email/resend";
import type { ContactListRow, SendStatus } from "@/lib/queries/contacts";
import type { Recipient } from "@/lib/recipients";
import type { ContactFormValues } from "@/lib/validation/contact";
import {
  CLEARABLE_FIELDS,
  type SubmissionDisplayFields,
} from "@/lib/validation/submission";
import {
  householdSchema,
  type HouseholdFieldErrors,
  type HouseholdInput,
  type HouseholdValues,
} from "@/lib/validation/household";

export type StatusKey = SendStatus | "updated";

export type SheetField = Extract<
  keyof ContactFormValues,
  | "email"
  | "partner_email"
  | "address_line1"
  | "city"
  | "state_region"
  | "postal_code"
  | "country"
>;

export type SheetValues = Record<SheetField, string>;

export type PersonSend = RecipientSend & { name: string };

export interface SheetRow {
  id: string;
  names: StoredNames;
  values: SheetValues;
  status: StatusKey;
  failureReason: FailureReason | null;
  people: PersonSend[];
  needsAttention: boolean;
  /** The people with an address whose latest send needs a look. */
  attention: { recipient: Recipient; status: SendStatus }[];
  answers: TwoAnswers | null;
  updatedAtIso: string;
  updatedAtLabel: string;
}

/** A reply queued because it collided, already parsed for display. */
export type PendingAnswer = {
  submissionId: string;
  display: SubmissionDisplayFields;
  from: Recipient;
  savedBy: Recipient;
};

export function toSheetRow(
  row: ContactListRow,
  formatDate: (date: Date) => string,
  { answer }: { answer?: PendingAnswer } = {},
): SheetRow {
  const values: SheetValues = {
    email: row.email ?? "",
    partner_email: row.partnerEmail ?? "",
    address_line1: row.addressLine1 ?? "",
    city: row.city ?? "",
    state_region: row.stateRegion ?? "",
    postal_code: row.postalCode ?? "",
    country: row.country ?? "",
  };
  const twoPeople =
    row.partnerEmail !== null || row.sendStatuses.partner.status !== "none";
  return {
    id: row.id,
    names: {
      fullName: row.fullName,
      partnerName: row.partnerName,
      kidsNames: row.kidsNames,
      firstName: row.firstName,
      lastName: row.lastName,
      partnerFirstName: row.partnerFirstName,
      partnerLastName: row.partnerLastName,
      kids: row.kids,
    },
    values,
    status: row.updatedAfterSend ? "updated" : row.sendStatus,
    failureReason: row.sendFailureReason,
    people: twoPeople
      ? (["primary", "partner"] as const).map((recipient) => ({
          name: personName(row, recipient) ?? (recipient === "primary" ? "First" : "Partner"),
          ...row.sendStatuses[recipient],
        }))
      : [],
    needsAttention: !row.updatedAfterSend && row.needsAttention,
    attention: row.updatedAfterSend
      ? []
      : (["primary", "partner"] as const)
          .filter(
            (recipient) =>
              (recipient === "primary" ? row.email : row.partnerEmail) !== null &&
              NEEDS_ATTENTION.has(row.sendStatuses[recipient].status),
          )
          .map((recipient) => ({ recipient, status: row.sendStatuses[recipient].status })),
    answers: answer ? twoAnswers(row, answer) : null,
    updatedAtIso: row.updatedAt.toISOString(),
    updatedAtLabel: formatDate(row.updatedAt),
  };
}

/** Sort rank for the status column: ascending puts problems first. */
export const STATUS_RANK: Record<StatusKey, number> = {
  failed: 0,
  bounced: 1,
  complained: 2,
  unconfirmed: 3,
  none: 4,
  sent: 5,
  delivered: 6,
  opened: 7,
  updated: 8,
};

/** Latest sends the owner should look at: failed, bounced or never confirmed. */
export const NEEDS_ATTENTION: ReadonlySet<StatusKey> = new Set([
  "failed",
  "bounced",
  "complained",
  "unconfirmed",
]);

export type RecipientSend = {
  status: SendStatus;
  failureReason: FailureReason | null;
};

export function combineSends(
  primary: RecipientSend,
  partner: RecipientSend,
): RecipientSend & { needsAttention: boolean } {
  const sends = [primary, partner].filter((send) => send.status !== "none");
  const best =
    sends.length === 0
      ? primary
      : sends.reduce((a, b) => (STATUS_RANK[b.status] > STATUS_RANK[a.status] ? b : a));
  return {
    ...best,
    needsAttention: sends.some((send) => NEEDS_ATTENTION.has(send.status)),
  };
}

/**
 * The status column's sort rank. A row needing attention ranks by its worst
 * person, so "Failed / Delivered" sorts with the problems.
 */
export function statusRank(row: Pick<SheetRow, "status" | "people" | "needsAttention">): number {
  const ranks = row.needsAttention
    ? row.people.filter((person) => person.status !== "none").map((person) => STATUS_RANK[person.status])
    : [];
  return Math.min(STATUS_RANK[row.status], ...ranks);
}

/** Statuses whose recipient holds a live link that a new email replaces. */
const HAS_LINK: ReadonlySet<StatusKey> = new Set(["sent", "delivered", "opened", "unconfirmed"]);

export type SendPlan = {
  input: { contactIds: string[] } | { recipients: { contactId: string; recipient: Recipient }[] };
  /** Contacts that get at least one email. */
  contacts: number;
  emails: number;
  /** Contacts with no email at all. */
  skipped: number;
  replacedLinks: number;
};

/**
 * What a send to these rows emails. With `attentionOnly`, only the people
 * whose last email needs a look: the other person keeps their live link.
 */
export function sendPlan(
  rows: SheetRow[],
  { attentionOnly }: { attentionOnly: boolean },
): SendPlan {
  if (attentionOnly) {
    const targets = rows.flatMap((row) =>
      row.attention.map((person) => ({ row, ...person })),
    );
    return {
      input: {
        recipients: targets.map(({ row, recipient }) => ({ contactId: row.id, recipient })),
      },
      contacts: rows.filter((row) => row.attention.length > 0).length,
      emails: targets.length,
      skipped: 0,
      replacedLinks: targets.filter((target) => HAS_LINK.has(target.status)).length,
    };
  }
  const emailable = rows.filter((row) => emailCount(row.values) > 0);
  return {
    input: { contactIds: rows.map((row) => row.id) },
    contacts: emailable.length,
    emails: emailable.reduce((sum, row) => sum + emailCount(row.values), 0),
    skipped: rows.length - emailable.length,
    replacedLinks: rows.filter((row) => HAS_LINK.has(row.status)).length,
  };
}

export function emailCount(values: Pick<SheetValues, "email" | "partner_email">): number {
  return (values.email === "" ? 0 : 1) + (values.partner_email === "" ? 0 : 1);
}

function personName(names: StoredNames, recipient: Recipient): string | null {
  const first = recipient === "primary" ? names.firstName : names.partnerFirstName;
  const full = recipient === "primary" ? names.fullName : names.partnerName;
  return first ?? full?.trim().split(/\s+/)[0] ?? null;
}

export type AnswerPart = { text: string; changed: boolean };
export type AnswerLine = { label: string | null; parts: AnswerPart[] };
export type AnswerSide = { name: string | null; lines: AnswerLine[] };
export type TwoAnswers = {
  submissionId: string;
  saved: AnswerSide;
  incoming: AnswerSide;
};

const ADDRESS_FIELDS = [
  ["address_line1", "Street"],
  ["address_line2", "Line 2"],
  ["city", "City"],
  ["state_region", "State"],
  ["postal_code", "Postal code"],
  ["country", "Country"],
] as const;

const CLEARABLE: ReadonlySet<string> = new Set(CLEARABLE_FIELDS);

const REMOVED = "(removed)";

const MARK_START = "\u0001";
const MARK_END = "\u0002";
// split() with a capture group alternates plain and marked text.
const MARKED = /\u0001(.*?)\u0002/;

const OTHER_FIELDS = [
  ["full_name", "Name"],
  ["partner_name", "Partner"],
  ["kids_names", "Kids"],
  ["birthday", "Birthday"],
  ["email", "Email"],
  ["partner_email", "Partner email"],
] as const;

type AnswerField =
  | (typeof ADDRESS_FIELDS)[number][0]
  | (typeof OTHER_FIELDS)[number][0];

export function twoAnswers(
  row: ContactListRow,
  { submissionId, display, from, savedBy }: PendingAnswer,
): TwoAnswers {
  const saved: Record<AnswerField, string> = {
    full_name: row.fullName,
    partner_name: row.partnerName ?? "",
    kids_names: row.kidsNames ?? "",
    birthday: row.birthday ?? "",
    email: row.email ?? "",
    partner_email: row.partnerEmail ?? "",
    address_line1: row.addressLine1 ?? "",
    address_line2: row.addressLine2 ?? "",
    city: row.city ?? "",
    state_region: row.stateRegion ?? "",
    postal_code: row.postalCode ?? "",
    country: row.country ?? "",
  };
  const reply = (field: AnswerField) => {
    const value = display[field];
    return value === undefined || (value === "" && !CLEARABLE.has(field))
      ? saved[field]
      : value;
  };
  const changed = (field: AnswerField) => reply(field) !== saved[field];

  const address = (value: (field: AnswerField) => string, mark: boolean) => {
    const at = (field: AnswerField) => {
      const text = value(field);
      if (text === "") return null;
      return mark && changed(field) ? `${MARK_START}${text}${MARK_END}` : text;
    };
    const lines =
      addressLines({
        addressLine1: at("address_line1"),
        addressLine2: at("address_line2"),
        city: at("city"),
        stateRegion: at("state_region"),
        postalCode: at("postal_code"),
        country: at("country"),
      }) ?? ADDRESS_FIELDS.map(([field]) => at(field)).filter((text) => text !== null);
    return {
      label: null,
      parts: lines
        .join(", ")
        .split(MARKED)
        .map((text, i) => ({ text, changed: i % 2 === 1 }))
        .filter((part) => part.text !== ""),
    };
  };
  const others = OTHER_FIELDS.filter(([field]) => changed(field));
  const removedAddress = ADDRESS_FIELDS.filter(
    ([field]) => changed(field) && reply(field) === "",
  );
  return {
    submissionId,
    saved: {
      name: personName(row, savedBy),
      lines: [
        address((field) => saved[field], false),
        ...others.map(([field, label]) => ({
          label,
          parts: [{ text: saved[field] || "—", changed: false }],
        })),
      ],
    },
    incoming: {
      name: personName(row, from),
      lines: [
        address(reply, true),
        ...[...removedAddress, ...others].map(([field, label]) => ({
          label,
          parts: [{ text: reply(field) || REMOVED, changed: true }],
        })),
      ],
    },
  };
}


export function changedValues(
  values: SheetValues,
  draft: Partial<SheetValues>,
): Partial<SheetValues> {
  const patch: Partial<SheetValues> = {};
  for (const [field, value] of Object.entries(draft) as [
    SheetField,
    string,
  ][]) {
    if (value !== values[field]) patch[field] = value;
  }
  return patch;
}

export type RowKey =
  "ArrowUp" | "ArrowDown" | "Home" | "End" | "PageUp" | "PageDown";

const PAGE_STEP = 10;

export function moveCursor(
  key: RowKey,
  current: number,
  count: number,
): number {
  if (count === 0) return -1;
  const target = {
    ArrowUp: current - 1,
    ArrowDown: current + 1,
    Home: 0,
    End: count - 1,
    PageUp: current - PAGE_STEP,
    PageDown: current + PAGE_STEP,
  }[key];
  return Math.min(Math.max(target, 0), count - 1);
}

export function parseStoredLayout(
  raw: string | null,
  { columnIds }: { columnIds?: readonly string[] } = {},
): {
  columnVisibility?: Record<string, boolean>;
  columnSizing?: Record<string, number>;
} {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const known = (record: unknown) =>
    isRecord(record) && columnIds
      ? Object.fromEntries(
          Object.entries(record).filter(([id]) => columnIds.includes(id)),
        )
      : record;
  const visibility = known(parsed.columnVisibility);
  const sizing = known(parsed.columnSizing);
  return {
    columnVisibility:
      isRecord(visibility) &&
      Object.values(visibility).every((v) => typeof v === "boolean")
        ? (visibility as Record<string, boolean>)
        : undefined,
    columnSizing:
      isRecord(sizing) &&
      Object.values(sizing).every(
        (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
      )
        ? (sizing as Record<string, number>)
        : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sheetName(names: StoredNames): {
  line: string;
  kids: string | null;
  split: boolean;
} {
  return {
    line: householdLine(names),
    kids: kidsSummary(kidsCount(names)),
    split: isSplit(names),
  };
}

export type PanelRow = { first: string; last: string; lastEdited: boolean };

export type HouseholdDraft = {
  first_name: string;
  last_name: string;
  partner: PanelRow | null;
  kids: PanelRow[];
};

function toPanelRow(row: { first: string; last: string }, familyLast: string): PanelRow {
  return { ...row, lastEdited: row.last !== familyLast };
}

export function draftFromNames(names: StoredNames): HouseholdDraft {
  const values = householdPrefill(names);
  return {
    first_name: values.first_name,
    last_name: values.last_name,
    partner: values.partner ? toPanelRow(values.partner, values.last_name) : null,
    kids: values.kids.map((kid) => toPanelRow(kid, values.last_name)),
  };
}

export function draftToValues(draft: HouseholdDraft): HouseholdValues {
  const resolve = (row: PanelRow) => ({
    first: row.first,
    last: row.lastEdited ? row.last : draft.last_name,
  });
  return {
    first_name: draft.first_name,
    last_name: draft.last_name,
    partner: draft.partner ? resolve(draft.partner) : null,
    kids: draft.kids.map(resolve),
  };
}

export function householdEdited(names: StoredNames, draft: HouseholdDraft): boolean {
  // An unsplit contact's draft is a proposed split, so it always saves.
  if (!isSplit(names)) return true;
  return (
    JSON.stringify(draftToValues(draft)) !==
    JSON.stringify(draftToValues(draftFromNames(names)))
  );
}

export function householdPatchInput(values: HouseholdValues) {
  return {
    first_name: values.first_name,
    last_name: values.last_name,
    ...(values.partner
      ? { partner_first_name: values.partner.first, partner_last_name: values.partner.last }
      : {}),
    ...(values.kids.length > 0 ? { kids: values.kids } : {}),
  };
}

export function validateHousehold(
  values: HouseholdValues,
): { ok: true; data: HouseholdInput } | { ok: false; errors: HouseholdFieldErrors } {
  const parsed = householdSchema().safeParse(householdPatchInput(values));
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: HouseholdFieldErrors = {};
  for (const issue of parsed.error.issues) {
    errors[issue.path.join(".")] ??= issue.message;
  }
  return { ok: false, errors };
}

export function namesFromValues(values: HouseholdValues): StoredNames {
  const first = values.first_name.trim();
  const last = values.last_name.trim();
  const partnerFirst = values.partner?.first.trim() ?? "";
  const partnerLast = values.partner?.last.trim() ?? "";
  const kids = values.kids
    .map((kid) => ({ first: kid.first.trim(), last: kid.last.trim() }))
    .filter((kid) => kid.first !== "")
    .map((kid) => (kid.last === "" ? { first: kid.first } : kid));
  return {
    fullName: formatPerson({ first, last }) ?? "",
    partnerName: formatPerson({ first: partnerFirst, last: partnerLast }),
    kidsNames: formatKids({ kids, familyLast: last }),
    firstName: first,
    lastName: last,
    partnerFirstName: partnerFirst === "" ? null : partnerFirst,
    partnerLastName: partnerLast === "" ? null : partnerLast,
    kids: kids.length === 0 ? null : kids,
  };
}
