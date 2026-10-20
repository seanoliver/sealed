import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  recordContactEvent,
  snapshotToRow,
  updatedAtText,
  DUPLICATE_EMAIL,
  GENERIC_ERROR,
  type Actor,
  type SnapshotField,
  type WriteResult,
} from "@/app/dashboard/contacts/write";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { agentPreviews, agentTokens, contactEvents, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { householdLine, pickStoredNames, type Kid } from "@/lib/names";

const FIELD_LABELS: Record<SnapshotField, string> = {
  full_name: "Name",
  partner_name: "Partner",
  kids_names: "Kids",
  email: "Email",
  partner_email: "Partner email",
  birthday: "Birthday",
  address_line1: "Street",
  address_line2: "Address line 2",
  city: "City",
  state_region: "State or region",
  postal_code: "Postal code",
  country: "Country",
  notes: "Notes",
  first_name: "First name",
  last_name: "Last name",
  partner_first_name: "Partner first name",
  partner_last_name: "Partner last name",
  kids: "Kids",
};

const DERIVED: Partial<Record<SnapshotField, SnapshotField[]>> = {
  full_name: ["first_name", "last_name"],
  partner_name: ["partner_first_name", "partner_last_name"],
  kids_names: ["kids"],
};

const MAX_VALUE = 40;

function display(value: unknown): string {
  const text = Array.isArray(value)
    ? (value as Kid[]).map((kid) => kid.first).join(", ")
    : String(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

const blank = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

type Diff = { before?: Record<string, unknown>; after?: Record<string, unknown>; undo_of?: string };

function asDiff(value: unknown): Diff {
  return value !== null && typeof value === "object" ? (value as Diff) : {};
}

export function summarizeDiff(raw: unknown): string {
  const diff = asDiff(raw);
  const after = diff.after ?? {};
  if (!diff.before) return "Added the contact";
  const fields = (Object.keys(FIELD_LABELS) as SnapshotField[]).filter(
    (field) => field in after && !(DERIVED[field] ?? []).some((name) => name in after),
  );
  const parts = fields.map((field) => {
    const label = FIELD_LABELS[field];
    const was = diff.before?.[field];
    const now = after[field];
    if (blank(was)) return `Added ${label.toLowerCase()} ${display(now)}`;
    if (blank(now)) return `Removed ${label.toLowerCase()}`;
    return `${label} ${display(was)} → ${display(now)}`;
  });
  const prefix = diff.undo_of ? "Undid: " : "";
  if (parts.length <= 2) return prefix + (parts.join("; ") || "No visible change");
  return `${prefix}${parts.slice(0, 2).join("; ")} and ${parts.length - 2} more`;
}

export type UndoState = { canUndo: true } | { canUndo: false; reason: string };

export type ChangeEntry = {
  eventId: string;
  contactId: string;
  contactName: string;
  summary: string;
  at: Date;
  undo: UndoState;
};

export type FeedEntry =
  | ({ kind: "change"; tokenName: string | null } & ChangeEntry)
  | {
      kind: "bulk";
      previewId: string;
      tokenName: string | null;
      at: Date;
      /** Contacts in the apply, from its preview, since `changes` can leave some out. */
      count: number;
      changes: ChangeEntry[];
    }
  | { kind: "deleted"; previewId: string; tokenName: string | null; at: Date; names: string[] };

const CHANGED_SINCE = "Changed since";

function undoState(row: { hasBefore: boolean; current: boolean; undone: boolean }): UndoState {
  if (row.undone) return { canUndo: false, reason: "Already undone" };
  if (!row.hasBefore) return { canUndo: false, reason: "Added by the agent" };
  if (!row.current) return { canUndo: false, reason: CHANGED_SINCE };
  return { canUndo: true };
}

const groupKey = sql<string>`coalesce(${contactEvents.agentPreviewId}, ${contactEvents.id})`;

/** Newest first; a bulk apply is one entry and counts once toward `limit`. */
export async function listAgentChanges(
  claims: SessionClaims,
  { limit = 50 }: { limit?: number } = {},
): Promise<FeedEntry[]> {
  const { events, deletes } = await withRls(claims, async (tx) => {
    const groups = await tx
      .select({ key: groupKey })
      .from(contactEvents)
      .where(eq(contactEvents.source, "agent"))
      .groupBy(groupKey)
      .orderBy(desc(sql`max(${contactEvents.createdAt})`))
      .limit(limit);
    const events =
      groups.length === 0
        ? []
        : await tx
            .select({
              id: contactEvents.id,
              contactId: contactEvents.contactId,
              diff: contactEvents.diff,
              at: contactEvents.createdAt,
              previewId: contactEvents.agentPreviewId,
              previewCount: sql<number | null>`jsonb_array_length(${agentPreviews.items})`,
              tokenName: agentTokens.name,
              contact: {
                fullName: contacts.fullName,
                partnerName: contacts.partnerName,
                kidsNames: contacts.kidsNames,
                firstName: contacts.firstName,
                lastName: contacts.lastName,
                partnerFirstName: contacts.partnerFirstName,
                partnerLastName: contacts.partnerLastName,
                kids: contacts.kids,
              },
              hasBefore: sql<boolean>`${contactEvents.diff} ? 'before'`,
              current: sql<boolean>`coalesce(${contacts.updatedAt} = ${contactEvents.contactUpdatedAt}, false)`,
              undone: sql<boolean>`exists (
                select 1 from public.contact_events u
                where u.contact_id = ${contactEvents.contactId}
                  and u.diff ->> 'undo_of' = ${contactEvents.id}::text)`,
            })
            .from(contactEvents)
            .innerJoin(contacts, eq(contacts.id, contactEvents.contactId))
            .leftJoin(agentTokens, eq(agentTokens.id, contactEvents.agentTokenId))
            .leftJoin(agentPreviews, eq(agentPreviews.id, contactEvents.agentPreviewId))
            .where(
              and(
                eq(contactEvents.source, "agent"),
                inArray(groupKey, groups.map((group) => group.key)),
              ),
            )
            .orderBy(desc(contactEvents.createdAt), desc(contactEvents.id));
    const deletes = await tx
      .select({
        id: agentPreviews.id,
        at: agentPreviews.appliedAt,
        items: agentPreviews.items,
        tokenName: agentTokens.name,
      })
      .from(agentPreviews)
      .leftJoin(agentTokens, eq(agentTokens.id, agentPreviews.agentTokenId))
      .where(and(eq(agentPreviews.kind, "delete"), isNotNull(agentPreviews.appliedAt)))
      .orderBy(desc(agentPreviews.appliedAt))
      .limit(limit);
    return { events, deletes };
  });

  const feed: FeedEntry[] = [];
  const bulks = new Map<string, Extract<FeedEntry, { kind: "bulk" }>>();
  for (const event of events) {
    const change: ChangeEntry = {
      eventId: event.id,
      contactId: event.contactId,
      contactName: householdLine(pickStoredNames(event.contact)),
      summary: summarizeDiff(event.diff),
      at: event.at,
      undo: undoState(event),
    };
    if (event.previewId === null) {
      feed.push({ kind: "change", tokenName: event.tokenName, ...change });
      continue;
    }
    const bulk = bulks.get(event.previewId);
    if (bulk) {
      bulk.changes.push(change);
      continue;
    }
    const entry = {
      kind: "bulk" as const,
      previewId: event.previewId,
      tokenName: event.tokenName,
      at: event.at,
      count: event.previewCount ?? 0,
      changes: [change],
    };
    bulks.set(event.previewId, entry);
    feed.push(entry);
  }
  for (const bulk of bulks.values()) bulk.count = Math.max(bulk.count, bulk.changes.length);
  for (const preview of deletes) {
    feed.push({
      kind: "deleted",
      previewId: preview.id,
      tokenName: preview.tokenName,
      at: preview.at!,
      names: (preview.items as { name?: string }[]).map((item) => item.name ?? "Unnamed"),
    });
  }
  feed.sort((a, b) => b.at.getTime() - a.at.getTime());
  return feed.slice(0, limit);
}

/** Undo every change of one bulk apply that can still be undone. */
export async function undoAgentBatch(
  claims: SessionClaims,
  previewId: string,
  actor: Actor,
): Promise<{ undone: number; skipped: number }> {
  const events = await withRls(claims, (tx) =>
    tx
      .select({ id: contactEvents.id })
      .from(contactEvents)
      .where(and(eq(contactEvents.source, "agent"), eq(contactEvents.agentPreviewId, previewId)))
      .orderBy(desc(contactEvents.createdAt), desc(contactEvents.id)),
  );
  let undone = 0;
  for (const event of events) {
    if ((await undoAgentChange(claims, event.id, actor)).ok) undone += 1;
  }
  return { undone, skipped: events.length - undone };
}

export async function undoAgentChange(
  claims: SessionClaims,
  eventId: string,
  actor: Actor,
): Promise<WriteResult<{ contactId: string; eventId?: string; restored: Record<string, unknown> }>> {
  type Outcome =
    | { kind: "refused"; error: string }
    | { kind: "ok"; contactId: string; diff: Diff; updatedAt: string };
  let outcome: Outcome;
  try {
    outcome = await withRls(claims, async (tx): Promise<Outcome> => {
      const [event] = await tx
        .select({
          contactId: contactEvents.contactId,
          source: contactEvents.source,
          diff: contactEvents.diff,
        })
        .from(contactEvents)
        .where(eq(contactEvents.id, eventId))
        .limit(1);
      if (!event) return { kind: "refused", error: "Change not found." };
      if (event.source !== "agent") {
        return { kind: "refused", error: "Only changes made by an agent can be undone here." };
      }
      const diff = asDiff(event.diff);
      if (!diff.before) {
        return {
          kind: "refused",
          error: "This change added the contact. Delete the contact instead of undoing it.",
        };
      }
      const [contact] = await tx
        .select({
          current: sql<boolean>`coalesce(${contacts.updatedAt} = (
            select e.contact_updated_at from public.contact_events e where e.id = ${eventId}), false)`,
        })
        .from(contacts)
        .where(eq(contacts.id, event.contactId))
        .for("update");
      if (!contact?.current) {
        return {
          kind: "refused",
          error:
            "This contact changed after the agent's edit, so undoing it would overwrite newer values. Edit the contact instead.",
        };
      }
      const [saved] = await tx
        .update(contacts)
        .set(snapshotToRow(diff.before))
        .where(eq(contacts.id, event.contactId))
        .returning({ updatedAt: updatedAtText });
      return { kind: "ok", contactId: event.contactId, diff, updatedAt: saved.updatedAt };
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: `${DUPLICATE_EMAIL}, so the old email can't come back.` };
    }
    logDbError("[ag] [undoAgentChange] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (outcome.kind === "refused") return { ok: false, error: outcome.error };

  const newEventId = await recordContactEvent(
    {
      contactId: outcome.contactId,
      diff: { before: outcome.diff.after ?? {}, after: outcome.diff.before, undo_of: eventId },
      contactUpdatedAt: outcome.updatedAt,
    },
    actor,
  );
  return {
    ok: true,
    value: { contactId: outcome.contactId, eventId: newEventId, restored: outcome.diff.before! },
  };
}
