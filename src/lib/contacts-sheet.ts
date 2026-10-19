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
import type { FailureReason } from "@/lib/email/resend";
import type { ContactListRow, SendStatus } from "@/lib/queries/contacts";
import type { ContactFormValues } from "@/lib/validation/contact";
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
  | "address_line1"
  | "city"
  | "state_region"
  | "postal_code"
  | "country"
>;

export type SheetValues = Record<SheetField, string>;

export interface SheetRow {
  id: string;
  names: StoredNames;
  values: SheetValues;
  status: StatusKey;
  failureReason: FailureReason | null;
  updatedAtIso: string;
  updatedAtLabel: string;
}

export function toSheetRow(
  row: ContactListRow,
  formatDate: (date: Date) => string,
): SheetRow {
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
    values: {
      email: row.email ?? "",
      address_line1: row.addressLine1 ?? "",
      city: row.city ?? "",
      state_region: row.stateRegion ?? "",
      postal_code: row.postalCode ?? "",
      country: row.country ?? "",
    },
    status: row.updatedAfterSend ? "updated" : row.sendStatus,
    failureReason: row.sendFailureReason,
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
