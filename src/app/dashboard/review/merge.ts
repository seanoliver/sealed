import "server-only";
import { contactInputToRow as toRow } from "@/lib/db/contact-row";
import { sameJsonb } from "@/lib/db/jsonb";
import { type contacts } from "@/lib/db/schema";
import { formatPerson, type Kid } from "@/lib/names";
import {
  TOKEN_UPDATE_FIELDS,
  type TokenUpdateField,
} from "@/lib/validation/contact";
import {
  isHouseholdPayload,
  type SubmissionPayload,
} from "@/lib/validation/submission";

const NAME_FIELDS = [
  "first_name",
  "last_name",
  "partner_first_name",
  "partner_last_name",
  "kids",
] as const;

export const SNAPSHOT_FIELDS = [...TOKEN_UPDATE_FIELDS, ...NAME_FIELDS] as const;
type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Field snapshot keyed by schema names. No `notes`: it can never arrive via a submission. */
export type Snapshot = Record<TokenUpdateField, string | null> & {
  first_name: string | null;
  last_name: string | null;
  partner_first_name: string | null;
  partner_last_name: string | null;
  kids: Kid[] | null;
};

export function rowToSnapshot(row: typeof contacts.$inferSelect): Snapshot {
  return {
    full_name: row.fullName,
    partner_name: row.partnerName,
    kids_names: row.kidsNames,
    email: row.email,
    birthday: row.birthday,
    address_line1: row.addressLine1,
    address_line2: row.addressLine2,
    city: row.city,
    state_region: row.stateRegion,
    postal_code: row.postalCode,
    country: row.country,
    first_name: row.firstName,
    last_name: row.lastName,
    partner_first_name: row.partnerFirstName,
    partner_last_name: row.partnerLastName,
    kids: row.kids,
  };
}


export function definedFields(snap: Snapshot): Partial<Snapshot> {
  const out: Partial<Record<SnapshotField, unknown>> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (snap[field] !== null) out[field] = snap[field];
  }
  return out as Partial<Snapshot>;
}

type SnapshotDiff = { before: Partial<Snapshot>; after: Partial<Snapshot> };

export function changedFields(
  before: Snapshot,
  after: Snapshot,
): SnapshotDiff | undefined {
  const diff = {
    before: {} as Partial<Record<SnapshotField, unknown>>,
    after: {} as Partial<Record<SnapshotField, unknown>>,
  };
  let changed = false;
  for (const field of SNAPSHOT_FIELDS) {
    if (!sameJsonb(before[field], after[field])) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
      changed = true;
    }
  }
  return changed ? (diff as SnapshotDiff) : undefined;
}

const FIELD_TO_COLUMN = {
  full_name: "fullName",
  partner_name: "partnerName",
  kids_names: "kidsNames",
  email: "email",
  birthday: "birthday",
  address_line1: "addressLine1",
  address_line2: "addressLine2",
  city: "city",
  state_region: "stateRegion",
  postal_code: "postalCode",
  country: "country",
  first_name: "firstName",
  last_name: "lastName",
  partner_first_name: "partnerFirstName",
  partner_last_name: "partnerLastName",
  kids: "kids",
} as const satisfies Record<SnapshotField, keyof typeof contacts.$inferInsert>;

export function toInsertRow(payload: SubmissionPayload) {
  if (!isHouseholdPayload(payload)) return toRow(payload);
  const {
    first_name,
    last_name,
    partner_first_name,
    partner_last_name,
    kids,
    ...rest
  } = payload;
  return {
    ...toRow({
      ...rest,
      full_name: formatPerson({ first: first_name, last: last_name }) ?? "",
    }),
    firstName: first_name,
    lastName: last_name,
    partnerFirstName: partner_first_name ?? null,
    partnerLastName: partner_last_name ?? null,
    kids: kids ?? null,
  };
}

// A submitted partner replaces the whole group, so one with no last name
// clears the stored last name.
function mergePatch(payload: SubmissionPayload): Partial<Snapshot> {
  const patch: Partial<Record<SnapshotField, unknown>> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) patch[key as SnapshotField] = value;
  }
  if (isHouseholdPayload(payload) && payload.partner_first_name !== undefined) {
    patch.partner_last_name = payload.partner_last_name ?? null;
  }
  return patch as Partial<Snapshot>;
}

export function mergeUpdate(
  before: Snapshot,
  payload: SubmissionPayload,
): Partial<typeof contacts.$inferInsert> | undefined {
  const patch = mergePatch(payload);
  const set: Partial<Record<string, unknown>> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (field in patch && !sameJsonb(before[field], patch[field])) {
      set[FIELD_TO_COLUMN[field]] = patch[field];
    }
  }
  return Object.keys(set).length > 0
    ? (set as Partial<typeof contacts.$inferInsert>)
    : undefined;
}
