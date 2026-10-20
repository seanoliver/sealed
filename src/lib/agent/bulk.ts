import "server-only";
import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
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
import { withRls, type RlsTx } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { isUniqueViolation } from "@/lib/db/errors";
import { agentPreviews, books, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { householdLine, pickStoredNames } from "@/lib/names";
import { type AgentContext } from "./write";

export const MAX_PREVIEW_CONTACTS = 500;
export const PREVIEW_TTL_MINUTES = 30;

type UpdateItem = {
  id: string;
  name: string;
  /** Postgres text, so the stale check compares microseconds. */
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

async function loadOwnContacts(ctx: AgentContext, ids: string[]) {
  return withRls(ctx.claims, async (tx) => {
    const [book] = await tx
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ownerId, ctx.claims.sub))
      .limit(1);
    if (!book) return [];
    return tx
      .select({ contact: contacts, updatedAt: updatedAtText })
      .from(contacts)
      .where(and(eq(contacts.bookId, book.id), inArray(contacts.id, ids)));
  });
}

// userId comes from the verified token, never from tool input.
async function storePreview(ctx: AgentContext, kind: "update" | "delete", items: unknown[]) {
  await dbAdmin
    .delete(agentPreviews)
    .where(
      and(
        eq(agentPreviews.userId, ctx.claims.sub),
        isNull(agentPreviews.appliedAt),
        lt(agentPreviews.expiresAt, sql`now()`),
      ),
    );
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

const NOT_FOUND = "Contact not found.";

export async function previewBulkUpdate(
  ctx: AgentContext,
  changes: { id: string; request: PatchRequest }[],
): Promise<PreviewResult<{ id: string; name: string } & ContactDiff>> {
  const ids = changes.map((change) => change.id);
  const problems = duplicateIds(ids);
  const found = new Map(
    (await loadOwnContacts(ctx, ids)).map((row) => [row.contact.id, row]),
  );
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
  const found = new Map(
    (await loadOwnContacts(ctx, ids)).map((row) => [row.contact.id, row]),
  );
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

type Claimed<T> = { ok: true; items: T[] } | { ok: false; error: string };

/** Mark the preview applied first, so two concurrent applies can't both run it. */
async function claimPreview<T>(
  ctx: AgentContext,
  previewId: string,
  kind: "update" | "delete",
): Promise<Claimed<T>> {
  const mine = and(
    eq(agentPreviews.id, previewId),
    eq(agentPreviews.userId, ctx.claims.sub),
    eq(agentPreviews.agentTokenId, ctx.tokenId),
    eq(agentPreviews.kind, kind),
  );
  const [claimed] = await dbAdmin
    .update(agentPreviews)
    .set({ appliedAt: sql`now()` })
    .where(and(mine, isNull(agentPreviews.appliedAt), gt(agentPreviews.expiresAt, sql`now()`)))
    .returning({ items: agentPreviews.items });
  if (claimed) return { ok: true, items: claimed.items as T[] };
  const [preview] = await dbAdmin
    .select({ appliedAt: agentPreviews.appliedAt })
    .from(agentPreviews)
    .where(mine)
    .limit(1);
  if (!preview) return { ok: false, error: "Preview not found. Make a new preview." };
  if (preview.appliedAt) return { ok: false, error: "This preview was already applied." };
  return { ok: false, error: "This preview expired. Make a new preview." };
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

class StaleError extends Error {
  constructor(readonly ids: string[]) {
    super("stale");
  }
}

function staleMessage(ids: string[]): string {
  return `Nothing was changed: ${ids.length} contact(s) changed or were deleted after the preview (${ids.join(", ")}). Make a new preview.`;
}

/** Lock the rows and refuse if any moved since the preview. Runs inside the apply tx. */
async function lockUnchanged(
  tx: RlsTx,
  items: { id: string; updatedAt: string }[],
) {
  const rows = await tx
    .select({
      id: contacts.id,
      updatedAt: updatedAtText,
    })
    .from(contacts)
    .where(inArray(contacts.id, items.map((item) => item.id)))
    .for("update");
  const fresh = new Map(rows.map((row) => [row.id, row.updatedAt]));
  const stale = items.filter((item) => fresh.get(item.id) !== item.updatedAt).map((item) => item.id);
  if (stale.length > 0) throw new StaleError(stale);
}

export type ApplyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function applyBulkUpdate(
  ctx: AgentContext,
  previewId: string,
): Promise<ApplyResult<{ applied: number; event_ids: (string | undefined)[] }>> {
  const claimed = await claimPreview<UpdateItem>(ctx, previewId, "update");
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
    if (err instanceof StaleError) return { ok: false, error: staleMessage(err.ids) };
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: `Nothing was changed: ${DUPLICATE_EMAIL.toLowerCase()}.` };
    }
    logDbError("[ag] [applyBulkUpdate] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
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

export async function applyDeleteContacts(
  ctx: AgentContext,
  previewId: string,
): Promise<ApplyResult<{ deleted: number }>> {
  const claimed = await claimPreview<DeleteItem>(ctx, previewId, "delete");
  if (!claimed.ok) return claimed;
  const items = claimed.items;
  try {
    await withRls(ctx.claims, async (tx) => {
      await lockUnchanged(tx, items);
      await tx.delete(contacts).where(inArray(contacts.id, items.map((item) => item.id)));
    });
  } catch (err) {
    await releasePreview(previewId);
    if (err instanceof StaleError) return { ok: false, error: staleMessage(err.ids) };
    logDbError("[ag] [applyDeleteContacts] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true, value: { deleted: items.length } };
}
