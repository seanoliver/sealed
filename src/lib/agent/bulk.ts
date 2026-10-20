import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import {
  planPatch,
  recordContactEvents,
  updatedAtText,
  DUPLICATE_EMAIL,
  GENERIC_ERROR,
  type ContactDiff,
  type PatchRequest,
  type Row,
} from "@/app/dashboard/contacts/write";
import { type SessionClaims } from "@/lib/auth";
import { withRls, type RlsTx } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { isUniqueViolation } from "@/lib/db/errors";
import { agentPreviews, agentTokens, books, contactEvents, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { householdLine, pickStoredNames } from "@/lib/names";
import { summarizeDiff } from "./changes";
import { type AgentContext } from "./write";

export const MAX_PREVIEW_CONTACTS = 500;
export const PREVIEW_TTL_MINUTES = 30;
export const DELETE_REQUEST_TTL_DAYS = 7;
const KEEP_FINISHED_DAYS = 30;

type UpdateItem = {
  id: string;
  name: string;
  updatedAt: string;
  row: Partial<Row>;
  diff: ContactDiff;
};

type DeleteItem = {
  id: string;
  name: string;
  updatedAt: string;
  email: string | null;
  partnerEmail: string | null;
  address: string;
};

type Problem = { id: string; error: string };

export type PreviewResult<T> =
  | { preview_id: string; expires_at: Date; count: number; items: T[]; unchanged?: string[] }
  | { preview_id: null; problems: Problem[]; unchanged?: string[] };

async function loadBook(ctx: AgentContext, ids: string[]) {
  return withRls(ctx.claims, async (tx) => {
    const [book] = await tx
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ownerId, ctx.claims.sub))
      .limit(1);
    if (!book) return { found: [], emails: [] };
    const found = await tx
      .select({ contact: contacts, updatedAt: updatedAtText })
      .from(contacts)
      .where(and(eq(contacts.bookId, book.id), inArray(contacts.id, ids)));
    const emails = await tx
      .select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.bookId, book.id), isNotNull(contacts.email)));
    return { found, emails };
  });
}

// Previews hold contact data: drop expired ones and finished ones after 30 days.
async function pruneFinishedPreviews(userId: string) {
  await dbAdmin
    .delete(agentPreviews)
    .where(
      and(
        eq(agentPreviews.userId, userId),
        or(
          and(
            isNull(agentPreviews.appliedAt),
            isNull(agentPreviews.discardedAt),
            lt(agentPreviews.expiresAt, sql`now()`),
          ),
          lt(
            sql`coalesce(${agentPreviews.appliedAt}, ${agentPreviews.discardedAt})`,
            sql`now() - make_interval(days => ${KEEP_FINISHED_DAYS}::int)`,
          ),
        ),
      ),
    );
}

async function storePreview(ctx: AgentContext, kind: "update" | "delete", items: unknown[]) {
  await pruneFinishedPreviews(ctx.claims.sub);
  const [preview] = await dbAdmin
    .insert(agentPreviews)
    .values({
      userId: ctx.claims.sub,
      agentTokenId: ctx.tokenId,
      kind,
      items,
      expiresAt: sql`now() + make_interval(mins => ${PREVIEW_TTL_MINUTES}::int)`,
    })
    .returning({ id: agentPreviews.id, expiresAt: agentPreviews.expiresAt });
  return preview;
}

function duplicateIds(ids: string[]): Problem[] {
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      return [];
    }
    return [{ id, error: "Listed more than once. Combine its fields into one change." }];
  });
}

function emailCollisions(items: UpdateItem[], held: { id: string; email: string | null }[]): Problem[] {
  const holders = new Map(held.map((row) => [row.email!.toLowerCase(), row.id]));
  const claimed = new Map<string, string>();
  const problems: Problem[] = [];
  for (const item of items) {
    const email = item.diff.after.email;
    if (typeof email !== "string") continue;
    const key = email.toLowerCase();
    const holder = holders.get(key);
    if (holder !== undefined && holder !== item.id) {
      problems.push({
        id: item.id,
        error: `${email} belongs to contact ${holder}. To swap emails, clear one in a first bulk update.`,
      });
    } else if (claimed.has(key)) {
      problems.push({ id: item.id, error: `${email} is also given to contact ${claimed.get(key)}.` });
    }
    claimed.set(key, item.id);
  }
  return problems;
}

const NOT_FOUND = "Contact not found.";

export async function previewBulkUpdate(
  ctx: AgentContext,
  changes: { id: string; request: PatchRequest }[],
): Promise<PreviewResult<{ id: string; name: string } & ContactDiff>> {
  const ids = changes.map((change) => change.id);
  const problems = duplicateIds(ids);
  const book = await loadBook(ctx, ids);
  const found = new Map(book.found.map((row) => [row.contact.id, row]));
  const items: UpdateItem[] = [];
  const unchanged: string[] = [];
  for (const { id, request } of changes) {
    const stored = found.get(id);
    if (!stored) {
      problems.push({ id, error: NOT_FOUND });
      continue;
    }
    const plan = planPatch(stored.contact, request);
    if (plan.kind === "invalid") {
      problems.push({ id, error: plan.error });
      continue;
    }
    if (!plan.diff) {
      unchanged.push(id);
      continue;
    }
    items.push({
      id,
      name: householdLine(pickStoredNames(stored.contact)),
      updatedAt: stored.updatedAt,
      row: plan.row,
      diff: plan.diff,
    });
  }
  problems.push(...emailCollisions(items, book.emails));
  const extra = unchanged.length > 0 ? { unchanged } : {};
  if (problems.length > 0 || items.length === 0) {
    return { preview_id: null, problems, ...extra };
  }
  const preview = await storePreview(ctx, "update", items);
  return {
    preview_id: preview.id,
    expires_at: preview.expiresAt,
    count: items.length,
    items: items.map(({ id, name, diff }) => ({ id, name, ...diff })),
    ...extra,
  };
}

export async function previewDeleteContacts(
  ctx: AgentContext,
  ids: string[],
): Promise<PreviewResult<Omit<DeleteItem, "updatedAt">>> {
  const problems = duplicateIds(ids);
  const found = new Map((await loadBook(ctx, ids)).found.map((row) => [row.contact.id, row]));
  const items: DeleteItem[] = [];
  for (const id of new Set(ids)) {
    const stored = found.get(id);
    if (!stored) {
      problems.push({ id, error: NOT_FOUND });
      continue;
    }
    const { contact } = stored;
    items.push({
      id,
      name: householdLine(pickStoredNames(contact)),
      updatedAt: stored.updatedAt,
      email: contact.email,
      partnerEmail: contact.partnerEmail,
      address: [contact.addressLine1, contact.city, contact.postalCode, contact.country]
        .filter((part) => (part ?? "").trim() !== "")
        .join(", "),
    });
  }
  if (problems.length > 0) return { preview_id: null, problems };
  const preview = await storePreview(ctx, "delete", items);
  return {
    preview_id: preview.id,
    expires_at: preview.expiresAt,
    count: items.length,
    items: items.map(({ id, name, email, partnerEmail, address }) => ({
      id,
      name,
      email,
      partnerEmail,
      address,
    })),
  };
}

const EXPIRED = "This preview expired. Make a new preview.";

const open = and(isNull(agentPreviews.appliedAt), isNull(agentPreviews.discardedAt));
const live = and(open, gt(agentPreviews.expiresAt, sql`now()`));

type Claimed<T> = { ok: true; items: T[] } | { ok: false; error: string };

/** Mark the preview applied first, so two concurrent applies can't both run it. */
async function claimPreview<T>(mine: SQL | undefined, alreadyFinished: string): Promise<Claimed<T>> {
  try {
    const [claimed] = await dbAdmin
      .update(agentPreviews)
      .set({ appliedAt: sql`now()` })
      .where(and(mine, live))
      .returning({ items: agentPreviews.items });
    if (claimed) return { ok: true, items: claimed.items as T[] };
    const [preview] = await dbAdmin
      .select({ appliedAt: agentPreviews.appliedAt, discardedAt: agentPreviews.discardedAt })
      .from(agentPreviews)
      .where(mine)
      .limit(1);
    if (!preview) return { ok: false, error: "Preview not found. Make a new preview." };
    if (preview.appliedAt || preview.discardedAt) return { ok: false, error: alreadyFinished };
    return { ok: false, error: EXPIRED };
  } catch (err) {
    logDbError("[ag] [claimPreview] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

async function releasePreview(previewId: string) {
  try {
    await dbAdmin
      .update(agentPreviews)
      .set({ appliedAt: null })
      .where(eq(agentPreviews.id, previewId));
  } catch (err) {
    logDbError("[ag] [releasePreview] failed", err);
  }
}

async function shrinkPreview(previewId: string, { keepIds }: { keepIds: boolean }) {
  try {
    await dbAdmin
      .update(agentPreviews)
      .set({
        items: keepIds
          ? sql`(select jsonb_agg(jsonb_build_object('id', e->'id', 'name', e->'name')) from jsonb_array_elements(${agentPreviews.items}) e)`
          : sql`(select jsonb_agg(jsonb_build_object('name', e->'name')) from jsonb_array_elements(${agentPreviews.items}) e)`,
      })
      .where(eq(agentPreviews.id, previewId));
  } catch (err) {
    logDbError("[ag] [shrinkPreview] failed", err);
  }
}

class StaleError extends Error {
  constructor(readonly ids: string[]) {
    super("stale");
  }
}

function staleMessage(ids: string[], { remedy }: { remedy: string }): string {
  return `Nothing was changed: ${ids.length === 1 ? "1 contact" : `${ids.length} contacts`} changed or were deleted after the preview (${ids.join(", ")}). ${remedy}`;
}

async function lockUnchanged(tx: RlsTx, items: { id: string; updatedAt: string }[]) {
  const rows = await tx
    .select({ id: contacts.id, updatedAt: updatedAtText })
    .from(contacts)
    .where(inArray(contacts.id, items.map((item) => item.id)))
    .orderBy(contacts.id)
    .for("update");
  const fresh = new Map(rows.map((row) => [row.id, row.updatedAt]));
  const stale = items.filter((item) => fresh.get(item.id) !== item.updatedAt).map((item) => item.id);
  if (stale.length > 0) throw new StaleError(stale);
}

export type ApplyResult<T> = { ok: true; value: T } | { ok: false; error: string };

const tokenPreview = (ctx: AgentContext, previewId: string, kind: "update" | "delete") =>
  and(
    eq(agentPreviews.id, previewId),
    eq(agentPreviews.userId, ctx.claims.sub),
    eq(agentPreviews.agentTokenId, ctx.tokenId),
    eq(agentPreviews.kind, kind),
  );

export async function applyBulkUpdate(
  ctx: AgentContext,
  previewId: string,
): Promise<ApplyResult<{ applied: number; event_ids: (string | undefined)[] }>> {
  const claimed = await claimPreview<UpdateItem>(
    tokenPreview(ctx, previewId, "update"),
    "This preview was already applied.",
  );
  if (!claimed.ok) return claimed;
  const items = claimed.items;
  let saved: { id: string; updatedAt: string }[];
  try {
    saved = await withRls(ctx.claims, async (tx) => {
      await lockUnchanged(tx, items);
      const out: { id: string; updatedAt: string }[] = [];
      for (const item of items) {
        const [row] = await tx
          .update(contacts)
          .set(item.row)
          .where(eq(contacts.id, item.id))
          .returning({ id: contacts.id, updatedAt: updatedAtText });
        out.push(row);
      }
      return out;
    });
  } catch (err) {
    await releasePreview(previewId);
    if (err instanceof StaleError) {
      return { ok: false, error: staleMessage(err.ids, { remedy: "Make a new preview." }) };
    }
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: `Nothing was changed: ${DUPLICATE_EMAIL.toLowerCase()}.` };
    }
    logDbError("[ag] [applyBulkUpdate] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  await shrinkPreview(previewId, { keepIds: true });
  const updatedAt = new Map(saved.map((row) => [row.id, row.updatedAt]));
  const eventIds = await recordContactEvents(
    items.map((item) => ({
      contactId: item.id,
      diff: item.diff,
      contactUpdatedAt: updatedAt.get(item.id),
    })),
    { source: "agent", tokenId: ctx.tokenId, previewId },
  );
  return { ok: true, value: { applied: items.length, event_ids: eventIds } };
}

export const AWAITING_OWNER = "Waiting for the owner to approve on the Agents page.";

/** The agent's last step for a delete: ask the owner. Nothing is deleted here. */
export async function requestDeleteContacts(
  ctx: AgentContext,
  previewId: string,
): Promise<ApplyResult<{ status: "pending"; count: number; message: string }>> {
  const mine = tokenPreview(ctx, previewId, "delete");
  const [requested] = await dbAdmin
    .update(agentPreviews)
    .set({
      requestedAt: sql`now()`,
      expiresAt: sql`now() + make_interval(days => ${DELETE_REQUEST_TTL_DAYS}::int)`,
    })
    .where(and(mine, live, isNull(agentPreviews.requestedAt)))
    .returning({ count: sql<number>`jsonb_array_length(${agentPreviews.items})` });
  if (requested) {
    return { ok: true, value: { status: "pending", count: requested.count, message: AWAITING_OWNER } };
  }
  const [preview] = await dbAdmin
    .select({
      requestedAt: agentPreviews.requestedAt,
      appliedAt: agentPreviews.appliedAt,
      discardedAt: agentPreviews.discardedAt,
    })
    .from(agentPreviews)
    .where(mine)
    .limit(1);
  if (!preview) return { ok: false, error: "Preview not found. Make a new preview." };
  if (preview.appliedAt) return { ok: false, error: "The owner already deleted these contacts." };
  if (preview.discardedAt) return { ok: false, error: "The owner discarded this deletion." };
  if (preview.requestedAt) return { ok: false, error: `Already requested. ${AWAITING_OWNER}` };
  return { ok: false, error: EXPIRED };
}

const pendingFor = (claims: SessionClaims, previewId: string) =>
  and(
    eq(agentPreviews.id, previewId),
    eq(agentPreviews.userId, claims.sub),
    eq(agentPreviews.kind, "delete"),
    isNotNull(agentPreviews.requestedAt),
  );

export async function approveDeletion(
  claims: SessionClaims,
  previewId: string,
): Promise<ApplyResult<{ deleted: number }>> {
  const claimed = await claimPreview<DeleteItem>(
    pendingFor(claims, previewId),
    "This deletion was already approved or discarded.",
  );
  if (!claimed.ok) {
    return claimed.error === EXPIRED
      ? { ok: false, error: "This request expired. Ask the agent to make a new one." }
      : claimed;
  }
  const items = claimed.items;
  try {
    await withRls(claims, async (tx) => {
      await lockUnchanged(tx, items);
      await tx.delete(contacts).where(inArray(contacts.id, items.map((item) => item.id)));
    });
  } catch (err) {
    await releasePreview(previewId);
    if (err instanceof StaleError) {
      return {
        ok: false,
        error: staleMessage(err.ids, { remedy: "Discard this request and ask the agent for a new one." }),
      };
    }
    logDbError("[ag] [approveDeletion] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  await shrinkPreview(previewId, { keepIds: false });
  return { ok: true, value: { deleted: items.length } };
}

export async function discardDeletion(
  claims: SessionClaims,
  previewId: string,
): Promise<ApplyResult<Record<string, never>>> {
  let discarded: { id: string } | undefined;
  try {
    [discarded] = await dbAdmin
      .update(agentPreviews)
      .set({ discardedAt: sql`now()` })
      .where(and(pendingFor(claims, previewId), open))
      .returning({ id: agentPreviews.id });
  } catch (err) {
    logDbError("[ag] [discardDeletion] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!discarded) return { ok: false, error: "This deletion was already approved or discarded." };
  await shrinkPreview(previewId, { keepIds: false });
  return { ok: true, value: {} };
}

export type PendingContact = {
  name: string;
  email: string | null;
  partnerEmail: string | null;
  address: string;
  agentEdit: { at: Date; summary: string } | null;
};

export type PendingDeletion = {
  previewId: string;
  tokenName: string | null;
  requestedAt: Date;
  expiresAt: Date;
  contacts: PendingContact[];
};

export async function listPendingDeletions(claims: SessionClaims): Promise<PendingDeletion[]> {
  return withRls(claims, async (tx) => {
    const rows = await tx
      .select({
        previewId: agentPreviews.id,
        tokenId: agentPreviews.agentTokenId,
        tokenName: agentTokens.name,
        requestedAt: agentPreviews.requestedAt,
        expiresAt: agentPreviews.expiresAt,
        items: agentPreviews.items,
      })
      .from(agentPreviews)
      .leftJoin(agentTokens, eq(agentTokens.id, agentPreviews.agentTokenId))
      .where(and(eq(agentPreviews.kind, "delete"), isNotNull(agentPreviews.requestedAt), live))
      .orderBy(desc(agentPreviews.requestedAt));
    return Promise.all(
      rows.map(async ({ items, requestedAt, tokenId, ...row }) => {
        const listed = items as DeleteItem[];
        const edits = await tx
          .selectDistinctOn([contactEvents.contactId], {
            contactId: contactEvents.contactId,
            at: contactEvents.createdAt,
            diff: contactEvents.diff,
          })
          .from(contactEvents)
          .where(
            and(
              eq(contactEvents.source, "agent"),
              eq(contactEvents.agentTokenId, tokenId),
              inArray(contactEvents.contactId, listed.map((item) => item.id)),
            ),
          )
          .orderBy(contactEvents.contactId, desc(contactEvents.createdAt));
        const byContact = new Map(edits.map((edit) => [edit.contactId, edit]));
        return {
          ...row,
          requestedAt: requestedAt!,
          contacts: listed.map((item) => {
            const edit = byContact.get(item.id);
            return {
              name: item.name,
              email: item.email,
              partnerEmail: item.partnerEmail,
              address: item.address,
              agentEdit: edit ? { at: edit.at, summary: summarizeDiff(edit.diff) } : null,
            };
          }),
        };
      }),
    );
  });
}
