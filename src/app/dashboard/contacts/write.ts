import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls, type RlsTx } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { contactDetailsToRow, householdToRow, legacyCountryAfter } from "@/lib/db/contact-row";
import { isUniqueViolation } from "@/lib/db/errors";
import { sameJsonb } from "@/lib/db/jsonb";
import { books, contactEvents, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { householdLine, pickStoredNames, type Kid, type StoredNames } from "@/lib/names";
import {
  checkAddress,
  CONTACT_FIELDS,
  contactDetailsSchema,
  type ContactDetailsInput,
  type ContactFormValues,
  SAME_PARTNER_EMAIL,
  samePartnerEmail,
} from "@/lib/validation/contact";
import {
  draftFromNames,
  draftToValues,
  validateHousehold,
  type HouseholdDraft,
} from "@/lib/contacts-sheet";
import { type HouseholdInput, type HouseholdValues } from "@/lib/validation/household";

/**
 * Never re-export these from a "use server" module: they trust the `claims`
 * they are handed, so a client could call them with forged ones.
 */

export const NAME_FIELDS = [
  "first_name",
  "last_name",
  "partner_first_name",
  "partner_last_name",
  "kids",
] as const;
// `country` is the text no code matched, kept so undo can bring it back.
export const SNAPSHOT_FIELDS = [...CONTACT_FIELDS, ...NAME_FIELDS, "country"] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Field snapshot keyed by form/schema names, for audit diffs. */
export type Snapshot = Record<SnapshotField, string | readonly Kid[] | null>;
export type ContactDiff = { before: Partial<Snapshot>; after: Partial<Snapshot> };

export type ContactRow = typeof contacts.$inferSelect;
export type Row = ReturnType<typeof householdToRow> & ReturnType<typeof contactDetailsToRow>;

const SNAPSHOT_COLUMNS = {
  full_name: "fullName",
  partner_name: "partnerName",
  kids_names: "kidsNames",
  email: "email",
  partner_email: "partnerEmail",
  birthday: "birthday",
  address_line1: "addressLine1",
  address_line2: "addressLine2",
  district: "district",
  city: "city",
  state_region: "stateRegion",
  postal_code: "postalCode",
  country_code: "countryCode",
  notes: "notes",
  first_name: "firstName",
  last_name: "lastName",
  partner_first_name: "partnerFirstName",
  partner_last_name: "partnerLastName",
  kids: "kids",
  country: "legacyCountry",
} as const satisfies Record<SnapshotField, keyof Row>;

export function rowToSnapshot(row: Pick<ContactRow, (typeof SNAPSHOT_COLUMNS)[SnapshotField]>): Snapshot {
  return Object.fromEntries(
    SNAPSHOT_FIELDS.map((field) => [field, row[SNAPSHOT_COLUMNS[field]]]),
  ) as Snapshot;
}

export function snapshotToRow(snap: Partial<Record<string, unknown>>): Partial<Row> {
  const row: Record<string, unknown> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (field in snap) row[SNAPSHOT_COLUMNS[field]] = snap[field] ?? null;
  }
  return row as Partial<Row>;
}

/** Non-null fields only — keeps create diffs compact. */
export function definedFields(snap: Snapshot): Partial<Snapshot> {
  const out: Partial<Snapshot> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (snap[field] !== null) out[field] = snap[field];
  }
  return out;
}

/** Changed fields only, or undefined for a no-op save (no audit row). */
export function changedFields(before: Snapshot, after: Snapshot): ContactDiff | undefined {
  const diff = { before: {} as Partial<Snapshot>, after: {} as Partial<Snapshot> };
  let changed = false;
  for (const field of SNAPSHOT_FIELDS) {
    if (!sameJsonb(before[field], after[field])) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
      changed = true;
    }
  }
  return changed ? diff : undefined;
}

export type ParsedDetails =
  | { success: true; data: ContactDetailsInput }
  | { success: false; error: string; field?: "partner_email" | "postal_code" | "country_code" };

export function parseDetails(
  values: Partial<ContactFormValues>,
  { stored }: { stored?: Pick<ContactRow, "postalCode" | "countryCode"> } = {},
): ParsedDetails {
  const details = contactDetailsSchema.safeParse(values);
  if (!details.success) {
    const issue = details.error.issues[0];
    const field = issue?.path[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input",
      field: field === "partner_email" || field === "country_code" ? field : undefined,
    };
  }
  if (samePartnerEmail(details.data)) {
    return { success: false, error: SAME_PARTNER_EMAIL, field: "partner_email" };
  }
  const address = checkAddress(details.data, {
    stored: stored && { postal_code: stored.postalCode, country_code: stored.countryCode },
  });
  return address.ok
    ? { success: true, data: address.data }
    : { success: false, error: address.error, field: address.field };
}

export const DETAIL_FIELDS = CONTACT_FIELDS.filter(
  (field) => field !== "full_name" && field !== "partner_name" && field !== "kids_names",
);
export type DetailField = (typeof DETAIL_FIELDS)[number];

export function storedNames(row: ContactRow): StoredNames {
  return {
    fullName: row.fullName,
    partnerName: row.partnerName,
    kidsNames: row.kidsNames,
    firstName: row.firstName,
    lastName: row.lastName,
    partnerFirstName: row.partnerFirstName,
    partnerLastName: row.partnerLastName,
    kids: row.kids,
  };
}

function rowToDetailValues(row: ContactRow): Record<DetailField, string> {
  const snap = rowToSnapshot(row);
  return Object.fromEntries(
    DETAIL_FIELDS.map((field) => [field, snap[field] ?? ""]),
  ) as Record<DetailField, string>;
}

const NAMES_CHANGED =
  "This contact's names changed since you opened them. Reload to see the new names.";

export type NamePatch = Partial<{
  first_name: string;
  last_name: string | null;
  partner_first_name: string | null;
  partner_last_name: string | null;
  kids: Kid[] | null;
}>;

export type PatchRequest = {
  values?: Partial<Record<DetailField, string>>;
  household?: HouseholdInput;
  /** The names the sheet's editor started from; a mismatch refuses the save. */
  namesBase?: unknown;
  names?: NamePatch;
};

const BLANK_DRAFT: HouseholdDraft = { first_name: "", last_name: "", partner: null, kids: [] };

/** Same household rules as the sheet's name editor: unedited surnames follow last_name. */
export function mergeNames(existing: ContactRow | null, names: NamePatch): HouseholdValues {
  const draft = existing ? draftFromNames(storedNames(existing)) : structuredClone(BLANK_DRAFT);
  if ("first_name" in names) draft.first_name = names.first_name ?? "";
  if ("last_name" in names) draft.last_name = names.last_name ?? "";
  if ("partner_first_name" in names && (names.partner_first_name ?? "").trim() === "") {
    draft.partner = null;
  } else if ("partner_first_name" in names || "partner_last_name" in names) {
    const kept = draft.partner;
    draft.partner = {
      first: names.partner_first_name ?? kept?.first ?? "",
      last: "partner_last_name" in names ? (names.partner_last_name ?? "") : (kept?.last ?? ""),
      lastEdited: "partner_last_name" in names || (kept?.lastEdited ?? false),
    };
  }
  if ("kids" in names) {
    draft.kids = (names.kids ?? []).map((kid) => ({
      first: kid.first,
      last: kid.last ?? "",
      lastEdited: kid.last !== undefined,
    }));
  }
  return draftToValues(draft);
}

export type PatchPlan =
  | { kind: "invalid"; error: string }
  | { kind: "ok"; row: Partial<Row>; before: Snapshot; after: Snapshot; diff?: ContactDiff };

export function planPatch(existing: ContactRow, request: PatchRequest): PatchPlan {
  let household = request.household;
  if (household && !sameJsonb(storedNames(existing), request.namesBase)) {
    return { kind: "invalid", error: NAMES_CHANGED };
  }
  if (request.names && Object.keys(request.names).length > 0) {
    const parsed = validateHousehold(mergeNames(existing, request.names));
    if (!parsed.ok) {
      return { kind: "invalid", error: Object.values(parsed.errors)[0] ?? "Invalid name" };
    }
    household = parsed.data;
  }
  const parsed = parseDetails({ ...rowToDetailValues(existing), ...request.values }, { stored: existing });
  if (!parsed.success) return { kind: "invalid", error: parsed.error };
  const details = contactDetailsToRow(parsed.data);
  const row = {
    ...details,
    legacyCountry: legacyCountryAfter(existing, details.countryCode),
    ...(household ? householdToRow(household) : {}),
  };
  const before = rowToSnapshot(existing);
  const after = rowToSnapshot({ ...existing, ...row });
  return { kind: "ok", row, before, after, diff: changedFields(before, after) };
}

export type AgentActor = { source: "agent"; tokenId: string };
export type Actor = { source: "owner" } | AgentActor;
type OwnerSource = "owner" | "submission";

export type EventInput = { contactId: string; diff: Record<string, unknown> };

/**
 * Owner history, appended after the owner's write commits. Never throws: an
 * error here would report a saved change as failed, so it is logged instead.
 */
export async function recordContactEvent(
  { contactId, diff }: EventInput,
  source: OwnerSource,
): Promise<string | undefined> {
  try {
    const [row] = await dbAdmin
      .insert(contactEvents)
      .values({ contactId, source, diff })
      .returning({ id: contactEvents.id });
    return row.id;
  } catch (err) {
    logDbError("[ct] [recordContactEvent] audit insert failed", err);
    return undefined;
  }
}

/**
 * Inside the contact write's transaction, so both commit or neither does: never
 * move this after commit.
 */
export async function insertAgentEvent(
  tx: RlsTx,
  { contactId, diff, tokenId, previewId }: EventInput & { tokenId: string; previewId?: string },
): Promise<string> {
  // Only the granted columns: a drizzle insert would also list id and created_at.
  const [event] = await tx.execute<{ id: string }>(sql`
    insert into public.contact_events
      (contact_id, source, diff, agent_token_id, agent_preview_id, contact_updated_at)
    values (${contactId}, 'agent', ${JSON.stringify(diff)}::jsonb, ${tokenId}, ${previewId ?? null},
      (select c.updated_at from public.contacts c where c.id = ${contactId}))
    returning id`);
  return event.id;
}

/** Postgres text keeps microseconds; a JS Date would round them off. */
export const updatedAtText = sql<string>`${contacts.updatedAt}::text`;

export const DUPLICATE_EMAIL = "You already have a contact with this email";
export const GENERIC_ERROR = "Something went wrong. Please try again.";

export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const EMAIL_FIELDS = ["email", "partner_email"] as const;
export type EmailField = (typeof EMAIL_FIELDS)[number];
export type EmailChange = Partial<Record<EmailField, [string | null, string | null]>>;
export const EMAIL_REQUEST_TTL_DAYS = 7;

export type PatchOutcome = {
  diff?: ContactDiff;
  eventId?: string;
  emailRequest?: { id: string; changes: EmailChange };
  emailWithdrawn?: boolean;
};

export async function patchContactAs(
  claims: SessionClaims,
  id: string,
  request: PatchRequest,
  actor: Actor,
  { holdEmails = false }: { holdEmails?: boolean } = {},
): Promise<WriteResult<PatchOutcome>> {
  type Outcome =
    | { kind: "missing" }
    | { kind: "invalid"; error: string }
    | ({ kind: "saved" } & PatchOutcome);
  let outcome: Outcome;
  try {
    outcome = await withRls(claims, async (tx): Promise<Outcome> => {
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return { kind: "missing" };
      const [existing] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)))
        .limit(1)
        .for("update");
      if (!existing) return { kind: "missing" };
      let plan = planPatch(existing, request);
      if (plan.kind === "invalid") return plan;

      const held: EmailChange = {};
      if (holdEmails && plan.diff) {
        for (const field of EMAIL_FIELDS) {
          if (field in plan.diff.after) {
            held[field] = [plan.diff.before[field] as string | null, plan.diff.after[field] as string | null];
          }
        }
      }
      const holding = Object.keys(held).length > 0;
      if (holding) {
        for (const [field, [, proposed]] of Object.entries(held)) {
          if (proposed === null) continue;
          const [taken] = await tx
            .select({ id: contacts.id })
            .from(contacts)
            .where(
              and(
                eq(contacts.bookId, book.id),
                sql`lower(${contacts.email}) = lower(${proposed})`,
                sql`${contacts.id} <> ${id}`,
              ),
            )
            .limit(1);
          if (taken) return { kind: "invalid", error: `${DUPLICATE_EMAIL} (${field.replace("_", " ")}).` };
        }
        const values = Object.fromEntries(
          Object.entries(request.values ?? {}).filter(([field]) => !(field in held)),
        );
        plan = planPatch(existing, { ...request, values });
        if (plan.kind === "invalid") return plan;
      }

      let eventId: string | undefined;
      // A no-op save must not bump updated_at.
      if (plan.diff) {
        await tx
          .update(contacts)
          .set(plan.row)
          .where(and(eq(contacts.id, id), eq(contacts.bookId, book.id)));
        if (actor.source === "agent") {
          eventId = await insertAgentEvent(tx, { contactId: id, diff: plan.diff, tokenId: actor.tokenId });
        }
      }
      let emailRequest: PatchOutcome["emailRequest"];
      let emailWithdrawn = false;
      const mentioned = EMAIL_FIELDS.filter((field) => field in (request.values ?? {}));
      if (holdEmails && actor.source === "agent" && mentioned.length > 0) {
        // One open email change per contact and token. The new one replaces it and
        // keeps an old change only for a field this call didn't mention that is
        // still what the old change saw, so a field set back to its value is withdrawn.
        const open = await tx.execute<{ id: string; changes: EmailChange }>(sql`
          select id, items->0->'changes' as changes from public.agent_previews
          where agent_token_id = ${actor.tokenId} and kind = 'email' and items->0->>'id' = ${id}
            and requested_at is not null and applied_at is null and discarded_at is null
          for update`);
        const stored: Record<EmailField, string | null> = {
          email: existing.email,
          partner_email: existing.partnerEmail,
        };
        const changes: EmailChange = {};
        for (const previous of open) {
          for (const field of EMAIL_FIELDS) {
            const change = previous.changes[field];
            if (change && !mentioned.includes(field) && change[0] === stored[field]) {
              changes[field] = change;
            }
          }
        }
        Object.assign(changes, held);
        if (open.length > 0) {
          await tx.execute(sql`
            update public.agent_previews
            set discarded_at = now(),
              items = jsonb_build_array(jsonb_build_object('id', items->0->'id', 'name', items->0->'name'))
            where id in ${open.map((row) => row.id)}`);
        }
        if (Object.keys(changes).length > 0) {
          const items = [{ id, name: householdLine(pickStoredNames(existing)), changes }];
          const [queued] = await tx.execute<{ id: string }>(sql`
            insert into public.agent_previews
              (user_id, agent_token_id, kind, items, requested_at, expires_at)
            values (${claims.sub}, ${actor.tokenId}, 'email', ${JSON.stringify(items)}::jsonb, now(),
              now() + make_interval(days => ${EMAIL_REQUEST_TTL_DAYS}::int))
            returning id`);
          emailRequest = { id: queued.id, changes };
        } else {
          emailWithdrawn = open.length > 0;
        }
      }
      return { kind: "saved", diff: plan.diff, eventId, emailRequest, emailWithdrawn };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: DUPLICATE_EMAIL };
    }
    logDbError("[ct] [patchContactAs] update failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (outcome.kind === "missing") return { ok: false, error: "Contact not found." };
  if (outcome.kind === "invalid") return { ok: false, error: outcome.error };
  const { diff, emailRequest, emailWithdrawn } = outcome;
  const eventId =
    actor.source === "agent"
      ? outcome.eventId
      : diff
        ? await recordContactEvent({ contactId: id, diff }, "owner")
        : undefined;
  return { ok: true, value: { diff, eventId, emailRequest, emailWithdrawn } };
}

export async function createContactAs(
  claims: SessionClaims,
  input: { details: ContactDetailsInput; household: HouseholdInput },
  actor: Actor,
): Promise<WriteResult<{ id: string; eventId?: string }>> {
  const row = { ...householdToRow(input.household), ...contactDetailsToRow(input.details) };
  const diff = { after: definedFields(rowToSnapshot(row)) };
  let inserted: { id: string; eventId?: string } | undefined;
  try {
    inserted = await withRls(claims, async (tx) => {
      // Resolve the book inside the RLS tx — never trust a client bookId.
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return undefined;
      const [created] = await tx
        .insert(contacts)
        .values({ bookId: book.id, ...row })
        .returning({ id: contacts.id });
      if (actor.source !== "agent") return created;
      const eventId = await insertAgentEvent(tx, { contactId: created.id, diff, tokenId: actor.tokenId });
      return { ...created, eventId };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: DUPLICATE_EMAIL };
    }
    logDbError("[ct] [createContactAs] insert failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!inserted) return { ok: false, error: "Set up your address book first." };
  const eventId =
    actor.source === "agent"
      ? inserted.eventId
      : await recordContactEvent({ contactId: inserted.id, diff }, "owner");
  return { ok: true, value: { id: inserted.id, eventId } };
}
