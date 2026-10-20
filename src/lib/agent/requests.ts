import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  insertAgentEvent,
  planPatch,
  updatedAtText,
  DUPLICATE_EMAIL,
  GENERIC_ERROR,
  type EmailChange,
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


export const MAX_DELETE_CONTACTS = 500;
export const PREVIEW_TTL_MINUTES = 30;
export const REQUEST_TTL_DAYS = 7;
const KEEP_FINISHED_DAYS = 30;

export const AWAITING_OWNER = "Waiting for the owner to approve on the Agents page.";

type DeleteItem = {
  id: string;
  name: string;
  updatedAt: string;
  email: string | null;
  partnerEmail: string | null;
  address: string;
};

type EmailItem = { id: string; name: string; updatedAt: string; changes: EmailChange };

type Problem = { id: string; error: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const open = and(isNull(agentPreviews.appliedAt), isNull(agentPreviews.discardedAt));
const live = and(open, gt(agentPreviews.expiresAt, sql`now()`));

export const finishedItems = sql`(
  select jsonb_agg(case when ${agentPreviews.kind} = 'email'
    then jsonb_build_object('id', e->'id', 'name', e->'name')
    else jsonb_build_object('name', e->'name') end)
  from jsonb_array_elements(${agentPreviews.items}) e)`;

/** Requests hold contact data: drop unfinished ones once expired, finished ones after 30 days. */
export async function pruneFinishedRequests(userId: string) {
  await dbAdmin
    .delete(agentPreviews)
    .where(
      and(
        eq(agentPreviews.userId, userId),
        or(
          and(open, lt(agentPreviews.expiresAt, sql`now()`)),
          lt(
            sql`coalesce(${agentPreviews.appliedAt}, ${agentPreviews.discardedAt})`,
            sql`now() - make_interval(days => ${KEEP_FINISHED_DAYS}::int)`,
          ),
        ),
      ),
    );
}

const NOT_FOUND = "Contact not found.";

export async function previewDeleteContacts(ctx: AgentContext, ids: string[]) {
  const seen = new Set<string>();
  const problems: Problem[] = ids.flatMap((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      return [];
    }
    return [{ id, error: "Listed more than once." }];
  });
  const found = await withRls(ctx.claims, async (tx) => {
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
  const byId = new Map(found.map((row) => [row.contact.id, row]));
  const items: DeleteItem[] = [];
  for (const id of seen) {
    const stored = byId.get(id);
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
  await pruneFinishedRequests(ctx.claims.sub);
  // user_id and the token come from the verified bearer token, never from input.
  const [preview] = await dbAdmin
    .insert(agentPreviews)
    .values({
      userId: ctx.claims.sub,
      agentTokenId: ctx.tokenId,
      kind: "delete",
      items,
      expiresAt: sql`now() + make_interval(mins => ${PREVIEW_TTL_MINUTES}::int)`,
    })
    .returning({ id: agentPreviews.id, expiresAt: agentPreviews.expiresAt });
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

/** The agent's last step for a delete: ask the owner. Nothing is deleted here. */
export async function requestDeleteContacts(
  ctx: AgentContext,
  previewId: string,
): Promise<Result<{ status: "pending"; count: number; message: string }>> {
  const mine = and(
    eq(agentPreviews.id, previewId),
    eq(agentPreviews.userId, ctx.claims.sub),
    eq(agentPreviews.agentTokenId, ctx.tokenId),
    eq(agentPreviews.kind, "delete"),
  );
  const [requested] = await dbAdmin
    .update(agentPreviews)
    .set({
      requestedAt: sql`now()`,
      expiresAt: sql`now() + make_interval(days => ${REQUEST_TTL_DAYS}::int)`,
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
  return { ok: false, error: "This preview expired. Make a new preview." };
}

export const REQUEST_NOT_FOUND = "Request not found.";
export const REQUEST_FINISHED = "This request was already approved or discarded.";
export const REQUEST_EXPIRED = "This request expired. Ask the agent to make a new one.";

class Refusal extends Error {}

async function staleNames(tx: RlsTx, items: { id: string; name: string; updatedAt: string }[]) {
  const rows = await tx
    .select({ id: contacts.id, version: updatedAtText })
    .from(contacts)
    .where(inArray(contacts.id, items.map((item) => item.id)))
    .orderBy(contacts.id)
    .for("update");
  const current = new Map(rows.map((row) => [row.id, row.version]));
  return items.filter((item) => current.get(item.id) !== item.updatedAt).map((item) => item.name);
}

const changedSince = (names: string[]) =>
  `${names.join(", ")} changed since the agent asked. Discard this request and ask the agent again.`;

/**
 * The owner's approval, all in one transaction: lock the request, check it is
 * still open and the contacts unchanged, write, record history, mark it applied.
 */
export async function approveRequest(
  claims: SessionClaims,
  previewId: string,
): Promise<Result<{ kind: "delete" | "email"; count: number }>> {
  try {
    const value = await withRls(claims, async (tx) => {
      const [request] = await tx
        .select({
          kind: agentPreviews.kind,
          items: agentPreviews.items,
          tokenId: agentPreviews.agentTokenId,
          finished: sql<boolean>`${agentPreviews.appliedAt} is not null or ${agentPreviews.discardedAt} is not null`,
          expired: sql<boolean>`${agentPreviews.expiresAt} <= now()`,
        })
        .from(agentPreviews)
        .where(and(eq(agentPreviews.id, previewId), isNotNull(agentPreviews.requestedAt)))
        .for("update");
      // FOR UPDATE sees only open requests (the update policy), so tell finished from missing.
      if (!request) {
        const [seen] = await tx
          .select({ id: agentPreviews.id })
          .from(agentPreviews)
          .where(and(eq(agentPreviews.id, previewId), isNotNull(agentPreviews.requestedAt)));
        throw new Refusal(seen ? REQUEST_FINISHED : REQUEST_NOT_FOUND);
      }
      if (request.finished) throw new Refusal(REQUEST_FINISHED);
      if (request.expired) throw new Refusal(REQUEST_EXPIRED);

      if (request.kind === "delete") {
        const items = request.items as DeleteItem[];
        const stale = await staleNames(tx, items);
        if (stale.length > 0) throw new Refusal(`Nothing was deleted: ${changedSince(stale)}`);
        await tx.delete(contacts).where(inArray(contacts.id, items.map((item) => item.id)));
      } else {
        const [item] = request.items as EmailItem[];
        const stale = await staleNames(tx, [item]);
        if (stale.length > 0) throw new Refusal(changedSince(stale));
        const [existing] = await tx.select().from(contacts).where(eq(contacts.id, item.id));
        const values = Object.fromEntries(
          Object.entries(item.changes).map(([field, [, proposed]]) => [field, proposed ?? ""]),
        );
        const plan = planPatch(existing, { values });
        if (plan.kind === "invalid") throw new Refusal(plan.error);
        if (plan.diff) {
          await tx.update(contacts).set(plan.row).where(eq(contacts.id, item.id));
          await insertAgentEvent(tx, {
            contactId: item.id,
            diff: plan.diff,
            tokenId: request.tokenId,
            previewId,
          });
        }
      }
      await tx
        .update(agentPreviews)
        .set({ appliedAt: sql`now()`, items: finishedItems })
        .where(eq(agentPreviews.id, previewId));
      return { kind: request.kind, count: (request.items as unknown[]).length };
    });
    return { ok: true, value };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, error: err.message };
    if (isUniqueViolation(err, "contacts_book_email_unique")) {
      return { ok: false, error: `Nothing was changed: ${DUPLICATE_EMAIL.toLowerCase()}.` };
    }
    logDbError("[ag] [approveRequest] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function discardRequest(
  claims: SessionClaims,
  previewId: string,
): Promise<Result<Record<string, never>>> {
  try {
    return await withRls(claims, async (tx) => {
      const [discarded] = await tx
        .update(agentPreviews)
        .set({ discardedAt: sql`now()`, items: finishedItems })
        .where(and(eq(agentPreviews.id, previewId), isNotNull(agentPreviews.requestedAt), open))
        .returning({ id: agentPreviews.id });
      if (discarded) return { ok: true as const, value: {} };
      const [request] = await tx
        .select({ id: agentPreviews.id })
        .from(agentPreviews)
        .where(and(eq(agentPreviews.id, previewId), isNotNull(agentPreviews.requestedAt)));
      return { ok: false as const, error: request ? REQUEST_FINISHED : REQUEST_NOT_FOUND };
    });
  } catch (err) {
    logDbError("[ag] [discardRequest] failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function discardTokenRequests(tx: RlsTx, tokenId: string) {
  await tx
    .update(agentPreviews)
    .set({ discardedAt: sql`now()`, items: finishedItems })
    .where(and(eq(agentPreviews.agentTokenId, tokenId), isNotNull(agentPreviews.requestedAt), open));
}

export type PendingContact = {
  name: string;
  email: string | null;
  partnerEmail: string | null;
  address: string;
  agentEdit: { at: Date; summary: string } | null;
};

type PendingBase = { previewId: string; tokenName: string | null; requestedAt: Date; expiresAt: Date };

export type PendingRequest =
  | (PendingBase & { kind: "delete"; contacts: PendingContact[] })
  | (PendingBase & { kind: "email"; contactName: string; changes: EmailChange });

export async function listPendingRequests(claims: SessionClaims): Promise<PendingRequest[]> {
  return withRls(claims, async (tx) => {
    const rows = await tx
      .select({
        previewId: agentPreviews.id,
        kind: agentPreviews.kind,
        tokenId: agentPreviews.agentTokenId,
        tokenName: agentTokens.name,
        requestedAt: agentPreviews.requestedAt,
        expiresAt: agentPreviews.expiresAt,
        items: agentPreviews.items,
      })
      .from(agentPreviews)
      .leftJoin(agentTokens, eq(agentTokens.id, agentPreviews.agentTokenId))
      .where(and(isNotNull(agentPreviews.requestedAt), live))
      .orderBy(desc(agentPreviews.requestedAt));
    return Promise.all(
      rows.map(async ({ items, requestedAt, tokenId, kind, ...row }): Promise<PendingRequest> => {
        const base = { ...row, requestedAt: requestedAt! };
        if (kind === "email") {
          const [item] = items as EmailItem[];
          return { ...base, kind, contactName: item.name, changes: item.changes };
        }
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
          ...base,
          kind,
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
