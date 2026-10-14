import type { ContactListRow, SendStatus } from "@/lib/queries/contacts";
import type { ContactFormValues } from "@/lib/validation/contact";

export type StatusKey = SendStatus | "updated";

export type SheetField = Extract<
  keyof ContactFormValues,
  | "full_name"
  | "partner_name"
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
  values: SheetValues;
  status: StatusKey;
  updatedAtIso: string;
  updatedAtLabel: string;
}

export function toSheetRow(
  row: ContactListRow,
  formatDate: (date: Date) => string,
): SheetRow {
  return {
    id: row.id,
    values: {
      full_name: row.fullName,
      partner_name: row.partnerName ?? "",
      email: row.email ?? "",
      address_line1: row.addressLine1 ?? "",
      city: row.city ?? "",
      state_region: row.stateRegion ?? "",
      postal_code: row.postalCode ?? "",
      country: row.country ?? "",
    },
    status: row.updatedAfterSend ? "updated" : row.sendStatus,
    updatedAtIso: row.updatedAt.toISOString(),
    updatedAtLabel: formatDate(row.updatedAt),
  };
}

/** Sort rank for the status column: ascending puts problems first. */
export const STATUS_RANK: Record<StatusKey, number> = {
  bounced: 0,
  complained: 1,
  none: 2,
  sent: 3,
  delivered: 4,
  opened: 5,
  updated: 6,
};

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

export function parseStoredLayout(raw: string | null): {
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
  const visibility = parsed.columnVisibility;
  const sizing = parsed.columnSizing;
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
