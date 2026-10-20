import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { type ServerContext } from "@modelcontextprotocol/server";
import { dbAdmin } from "@/lib/db/admin";
import { agentPreviews, contactEvents, contacts } from "@/lib/db/schema";
import { listAgentChanges, summarizeDiff, undoAgentChange } from "./changes";
import { agentContext } from "./mcp";
import {
  approveRequest,
  AWAITING_OWNER,
  discardRequest,
  listPendingRequests,
  previewDeleteContacts,
  pruneFinishedRequests,
  REQUEST_EXPIRED,
  REQUEST_FINISHED,
  REQUEST_NOT_FOUND,
  requestDeleteContacts,
} from "./requests";
import { AgentScopeError } from "./scopes";
import { mintAgentToken, revokeAgentToken } from "./tokens";
import {
  agentActor,
  createContact,
  createContactInput,
  ToolError,
  updateContact,
  updateContactInput,
  type AgentContext,
} from "./write";

const U = "00000000-0000-4000-8000-0000000d7001";
const OTHER = "00000000-0000-4000-8000-0000000d7002";
const B = "10000000-0000-4000-8000-0000000d7001";
const OTHER_B = "10000000-0000-4000-8000-0000000d7002";
const ANA = "20000000-0000-4000-8000-0000000d7001";
const CARA = "20000000-0000-4000-8000-0000000d7002";
const DEV = "20000000-0000-4000-8000-0000000d7003";
const FOREIGN = "20000000-0000-4000-8000-0000000d7009";
const UNKNOWN = "40000000-0000-4000-8000-0000000d70ff";

let ctx: AgentContext;

const stored = async (id: string) =>
  (await dbAdmin.select().from(contacts).where(eq(contacts.id, id)))[0];
const version = async (id: string) =>
  (
    await dbAdmin
      .select({ version: sql<string>`${contacts.updatedAt}::text` })
      .from(contacts)
      .where(eq(contacts.id, id))
  )[0].version;
const eventsOf = (id: string) =>
  dbAdmin.select().from(contactEvents).where(eq(contactEvents.contactId, id));
const update = (input: object) => updateContact(ctx, updateContactInput.parse(input));
const create = (fields: object) => createContact(ctx, createContactInput.parse({ fields }));

async function requestDeletion(ids: string[]) {
  const preview = await previewDeleteContacts(ctx, ids);
  const id = preview.preview_id!;
  await requestDeleteContacts(ctx, id);
  return id;
}

async function requestEmail(id: string, email: string) {
  const result = await update({ id, fields: { email } });
  return result.pending_email_change!.request_id;
}

async function duringConcurrentEdit<T>(
  contactId: string,
  act: () => Promise<T>,
  edit: Partial<typeof contacts.$inferInsert> = { notes: "edited meanwhile" },
): Promise<T> {
  let running: Promise<T> | undefined;
  await dbAdmin.transaction(async (tx) => {
    await tx.update(contacts).set(edit).where(eq(contacts.id, contactId));
    running = act();
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  return running!;
}

async function seed() {
  await dbAdmin.execute(sql`delete from public.books where id in (${B}, ${OTHER_B})`);
  await dbAdmin.execute(sql`delete from public.agent_previews where user_id = ${U}`);
  await dbAdmin.execute(sql`
    insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'wt-book'), (${OTHER_B}, ${OTHER}, 'wt-other')`);
  await dbAdmin.execute(sql`
    insert into public.contacts (id, book_id, full_name, first_name, last_name, email, partner_email, city, postal_code)
    values
      (${ANA}, ${B}, 'Ana Reyes', 'Ana', 'Reyes', 'ana@wt.test', null, 'Portland', '97211'),
      (${CARA}, ${B}, 'Cara Diaz', null, null, 'cara@wt.test', null, 'Austin', null),
      (${DEV}, ${B}, 'Dev Patel', 'Dev', 'Patel', 'dev@wt.test', null, 'Toronto', null),
      (${FOREIGN}, ${OTHER_B}, 'Not Mine', 'Not', 'Mine', 'nm@wt.test', null, null, null)`);
}

describe("agent write tools", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'wt-owner@wt.test'), (${OTHER}, 'wt-other@wt.test')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id = ${U}`);
    const { summary } = await mintAgentToken(U, { name: "Claude Code", scopes: ["read", "write"] });
    ctx = { claims: { sub: U, agent_token_id: summary.id }, tokenId: summary.id };
  });

  beforeEach(seed);

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id in (${B}, ${OTHER_B})`);
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id = ${U}`);
  });

  it("refuses a write tool's context to a read-only token", () => {
    const serverContext = (scopes: string[]) =>
      ({
        http: { authInfo: { token: "t", clientId: ctx.tokenId, scopes, extra: { claims: ctx.claims } } },
      }) as unknown as ServerContext;
    expect(() => agentContext(serverContext(["read"]), "write")).toThrow(AgentScopeError);
    expect(agentContext(serverContext(["write"]), "write")).toEqual(ctx);
  });

  describe("update_contact", () => {
    it("applies the sheet's rules and records its history in the same transaction", async () => {
      const result = await update({ id: ANA, fields: { postal_code: "97211-3417", city: null } });
      expect(result).toMatchObject({
        changed: true,
        before: { postal_code: "97211", city: "Portland" },
        after: { postal_code: "97211-3417", city: null },
      });
      const [event] = await eventsOf(ANA);
      expect(event).toMatchObject({ id: result.event_id, source: "agent", agentTokenId: ctx.tokenId });
      expect(event.contactUpdatedAt).toEqual((await stored(ANA)).updatedAt);
    });

    it("saves nothing when its history can't be written", async () => {
      const { summary } = await mintAgentToken(U, { name: "Revoked", scopes: ["write"] });
      await dbAdmin.execute(sql`update public.agent_tokens set revoked_at = now() where id = ${summary.id}`);
      const revoked = { claims: ctx.claims, tokenId: summary.id };
      await expect(
        updateContact(revoked, updateContactInput.parse({ id: ANA, fields: { city: "Bend" } })),
      ).rejects.toThrow("Something went wrong");
      expect((await stored(ANA)).city).toBe("Portland");
    });

    it("refuses what the dashboard refuses", async () => {
      await expect(update({ id: ANA, fields: { partner_email: "ANA@wt.test" } })).rejects.toThrow(
        "The partner's email must differ from the email",
      );
      await expect(update({ id: ANA, fields: { email: "not-an-email" } })).rejects.toThrow(ToolError);
      await expect(update({ id: ANA, fields: { first_name: "" } })).rejects.toThrow(ToolError);
      await expect(update({ id: FOREIGN, fields: { city: "X" } })).rejects.toThrow("Contact not found.");
      expect(await eventsOf(ANA)).toHaveLength(0);
    });

    it("leaves updated_at alone and writes no history for a no-op", async () => {
      const before = await version(ANA);
      expect(await update({ id: ANA, fields: { city: "Portland" } })).toEqual({ id: ANA, changed: false });
      expect(await version(ANA)).toBe(before);
      expect(await eventsOf(ANA)).toHaveLength(0);
    });

    it("moves an unedited partner and kids to a new last name, as the sheet does", async () => {
      await update({ id: ANA, fields: { partner_first_name: "Ben", kids: [{ first: "Kit" }, { first: "Lu", last: "Ono" }] } });
      expect(await stored(ANA)).toMatchObject({ partnerLastName: "Reyes", partnerName: "Ben Reyes" });
      await update({ id: ANA, fields: { last_name: "Lopez" } });
      expect(await stored(ANA)).toMatchObject({
        fullName: "Ana Lopez",
        partnerLastName: "Lopez",
        kids: [{ first: "Kit", last: "Lopez" }, { first: "Lu", last: "Ono" }],
      });
      await update({ id: ANA, fields: { partner_first_name: "" } });
      expect(await stored(ANA)).toMatchObject({ partnerFirstName: null, partnerName: null });
    });
  });

  describe("email changes", () => {
    it("queues a change to an existing email and saves the other fields", async () => {
      const result = await update({ id: ANA, fields: { email: "ana.new@wt.test", city: "Bend" } });
      expect(result).toMatchObject({
        changed: true,
        after: { city: "Bend" },
        pending_email_change: { changes: { email: ["ana@wt.test", "ana.new@wt.test"] } },
      });
      expect(result.after).not.toHaveProperty("email");
      expect(await stored(ANA)).toMatchObject({ email: "ana@wt.test", city: "Bend" });
      const [pending] = await listPendingRequests(ctx.claims);
      expect(pending).toMatchObject({
        kind: "email",
        contactName: "Ana Reyes",
        tokenName: "Claude Code",
        changes: { email: ["ana@wt.test", "ana.new@wt.test"] },
      });
    });

    it("applies an approved change with history, all at once", async () => {
      const requestId = await requestEmail(ANA, "ana.new@wt.test");
      expect(await approveRequest(ctx.claims, requestId)).toEqual({ ok: true, value: { kind: "email", count: 1 } });
      expect((await stored(ANA)).email).toBe("ana.new@wt.test");
      const [event] = await eventsOf(ANA);
      expect(event).toMatchObject({
        source: "agent",
        agentPreviewId: requestId,
        diff: { before: { email: "ana@wt.test" }, after: { email: "ana.new@wt.test" } },
      });
      expect(await listPendingRequests(ctx.claims)).toEqual([]);
      expect(await approveRequest(ctx.claims, requestId)).toEqual({ ok: false, error: REQUEST_FINISHED });
    });

    it("keeps the email when the owner discards the change", async () => {
      const requestId = await requestEmail(ANA, "ana.new@wt.test");
      expect(await discardRequest(ctx.claims, requestId)).toEqual({ ok: true, value: {} });
      expect((await stored(ANA)).email).toBe("ana@wt.test");
    });

    it("refuses an approval, by name, when the email changed since", async () => {
      const requestId = await requestEmail(ANA, "ana.new@wt.test");
      await dbAdmin.update(contacts).set({ email: "ana.other@wt.test" }).where(eq(contacts.id, ANA));
      expect(await approveRequest(ctx.claims, requestId)).toEqual({
        ok: false,
        error: "Ana Reyes changed since the agent asked. Discard this request and ask the agent again.",
      });
      expect((await stored(ANA)).email).toBe("ana.other@wt.test");
    });

    it("still applies after other fields of the contact changed", async () => {
      const requestId = await requestEmail(ANA, "ana.new@wt.test");
      await update({ id: ANA, fields: { notes: "met at the reunion" } });
      await dbAdmin.update(contacts).set({ city: "Bend" }).where(eq(contacts.id, ANA));
      expect(await approveRequest(ctx.claims, requestId)).toMatchObject({ ok: true });
      expect(await stored(ANA)).toMatchObject({ email: "ana.new@wt.test", notes: "met at the reunion", city: "Bend" });
    });

    it("keeps one open request per contact and token when the agent retries", async () => {
      const first = await requestEmail(ANA, "ana.new@wt.test");
      const second = await requestEmail(ANA, "ana.new@wt.test");
      const pending = await listPendingRequests(ctx.claims);
      expect(pending.map((request) => request.previewId)).toEqual([second]);
      expect(await approveRequest(ctx.claims, first)).toEqual({ ok: false, error: REQUEST_FINISHED });
    });

    it("can clear an email, with a history row once approved", async () => {
      const requestId = (await update({ id: ANA, fields: { email: null } })).pending_email_change!.request_id;
      expect((await stored(ANA)).email).toBe("ana@wt.test");
      expect(await approveRequest(ctx.claims, requestId)).toMatchObject({ ok: true });
      expect((await stored(ANA)).email).toBeNull();
      const [event] = await eventsOf(ANA);
      expect(event).toMatchObject({
        source: "agent",
        agentPreviewId: requestId,
        diff: { before: { email: "ana@wt.test" }, after: { email: null } },
      });
    });

    it("locks the contact while approving, so an email change committed meanwhile refuses it", async () => {
      const requestId = await requestEmail(ANA, "ana.new@wt.test");
      const result = await duringConcurrentEdit(ANA, () => approveRequest(ctx.claims, requestId), {
        email: "ana.meanwhile@wt.test",
      });
      expect(result).toMatchObject({ ok: false });
      expect((await stored(ANA)).email).toBe("ana.meanwhile@wt.test");
    });

    it("refuses an email another contact holds before queuing it", async () => {
      await expect(update({ id: ANA, fields: { email: "CARA@wt.test" } })).rejects.toThrow(
        "You already have a contact with this email",
      );
      expect(await listPendingRequests(ctx.claims)).toEqual([]);
    });

    it("lets create_contact set emails directly", async () => {
      const created = await create({ first_name: "Zed", email: "zed@wt.test", partner_email: "zoe@wt.test" });
      expect(await stored(created.id)).toMatchObject({ email: "zed@wt.test", partnerEmail: "zoe@wt.test" });
      expect(await listPendingRequests(ctx.claims)).toEqual([]);
    });

    it("can only be undone by the owner", async () => {
      const requestId = await requestEmail(ANA, "ana.new@wt.test");
      await approveRequest(ctx.claims, requestId);
      const [event] = await eventsOf(ANA);
      expect(await undoAgentChange(ctx.claims, event.id, agentActor(ctx))).toEqual({
        ok: false,
        error: "Only the owner can undo an email change, on the Agents page.",
      });
      expect(await undoAgentChange(ctx.claims, event.id, { source: "owner" })).toMatchObject({ ok: true });
      expect((await stored(ANA)).email).toBe("ana@wt.test");
    });
  });

  describe("create_contact", () => {
    it("adds a contact with its history in the same transaction", async () => {
      const created = await create({ first_name: "Zed", last_name: "New", email: "zed@wt.test", kids: [{ first: "Kit" }] });
      expect(await stored(created.id)).toMatchObject({ fullName: "Zed New", kidsNames: "Kit", bookId: B });
      const [event] = await eventsOf(created.id);
      expect(event).toMatchObject({ id: created.event_id, source: "agent", agentTokenId: ctx.tokenId });
    });

    it("gives a new partner without a last name the family surname", async () => {
      const created = await create({ first_name: "Jen", last_name: "Holloway", partner_first_name: "Mark" });
      expect(await stored(created.id)).toMatchObject({
        partnerFirstName: "Mark",
        partnerLastName: "Holloway",
        partnerName: "Mark Holloway",
      });
    });

    it("refuses a duplicate email and a missing first name", async () => {
      await expect(create({ first_name: "A", email: "ana@wt.test" })).rejects.toThrow(
        "You already have a contact with this email",
      );
      await expect(create({ first_name: " " })).rejects.toThrow(ToolError);
      expect(() => createContactInput.parse({ fields: { city: "X" } })).toThrow();
    });
  });

  describe("deletions", () => {
    const pendingNames = async () =>
      (await listPendingRequests(ctx.claims)).map((request) =>
        request.kind === "delete" ? request.contacts.map((contact) => contact.name) : [],
      );

    it("only asks the owner; the owner's approval deletes exactly those contacts", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA, DEV]);
      expect(await requestDeleteContacts(ctx, preview.preview_id!)).toEqual({
        ok: true,
        value: { status: "pending", count: 2, message: AWAITING_OWNER },
      });
      expect(await stored(CARA)).toBeDefined();
      expect(await pendingNames()).toEqual([["Cara Diaz", "Dev Patel"]]);
      expect(await approveRequest(ctx.claims, preview.preview_id!)).toEqual({
        ok: true,
        value: { kind: "delete", count: 2 },
      });
      expect(await stored(CARA)).toBeUndefined();
      expect(await stored(DEV)).toBeUndefined();
      expect(await stored(ANA)).toBeDefined();
    });

    it("keeps only names once approved, in the same transaction as the delete", async () => {
      const requestId = await requestDeletion([CARA]);
      await approveRequest(ctx.claims, requestId);
      const [row] = await dbAdmin
        .select({ items: agentPreviews.items, appliedAt: agentPreviews.appliedAt })
        .from(agentPreviews)
        .where(eq(agentPreviews.id, requestId));
      expect(row).toMatchObject({ items: [{ name: "Cara Diaz" }], appliedAt: expect.any(Date) });
    });

    it("discarding keeps every contact", async () => {
      const requestId = await requestDeletion([CARA]);
      expect(await discardRequest(ctx.claims, requestId)).toEqual({ ok: true, value: {} });
      expect(await stored(CARA)).toBeDefined();
      expect(await pendingNames()).toEqual([]);
    });

    it("refuses an approval, naming the contacts that changed since", async () => {
      const requestId = await requestDeletion([CARA, DEV]);
      await dbAdmin.update(contacts).set({ city: "Waterloo" }).where(eq(contacts.id, DEV));
      expect(await approveRequest(ctx.claims, requestId)).toEqual({
        ok: false,
        error: "Nothing was deleted: Dev Patel changed since the agent asked. Discard this request and ask the agent again.",
      });
      expect(await stored(CARA)).toBeDefined();
    });

    it("locks the contacts while approving, so an edit committed meanwhile refuses it", async () => {
      const requestId = await requestDeletion([CARA]);
      const result = await duringConcurrentEdit(CARA, () => approveRequest(ctx.claims, requestId));
      expect(result).toMatchObject({ ok: false });
      expect(await stored(CARA)).toBeDefined();
      const [row] = await dbAdmin
        .select({ appliedAt: agentPreviews.appliedAt })
        .from(agentPreviews)
        .where(eq(agentPreviews.id, requestId));
      expect(row.appliedAt).toBeNull();
    });

    it("shows each contact's email and address, and flags this agent's edits", async () => {
      await update({ id: ANA, fields: { first_name: "Zed" } });
      await requestDeletion([ANA, CARA]);
      const [request] = await listPendingRequests(ctx.claims);
      expect(request.kind === "delete" && request.contacts).toEqual([
        {
          name: "Zed Reyes",
          email: "ana@wt.test",
          partnerEmail: null,
          address: "Portland, 97211",
          agentEdit: { at: expect.any(Date), summary: "First name Ana → Zed" },
        },
        { name: "Cara Diaz", email: "cara@wt.test", partnerEmail: null, address: "Austin", agentEdit: null },
      ]);
    });

    it("lets a request expire after 7 days", async () => {
      const requestId = await requestDeletion([CARA]);
      await dbAdmin.execute(sql`
        update public.agent_previews set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        where id = ${requestId}`);
      expect(await pendingNames()).toEqual([]);
      expect(await approveRequest(ctx.claims, requestId)).toEqual({ ok: false, error: REQUEST_EXPIRED });
      expect(await stored(CARA)).toBeDefined();
    });

    it("refuses another owner's contact and another owner's approval", async () => {
      expect(await previewDeleteContacts(ctx, [FOREIGN])).toMatchObject({
        preview_id: null,
        problems: [{ id: FOREIGN, error: "Contact not found." }],
      });
      const requestId = await requestDeletion([CARA]);
      expect(await approveRequest({ sub: OTHER }, requestId)).toEqual({ ok: false, error: REQUEST_NOT_FOUND });
      expect(await stored(CARA)).toBeDefined();
    });

    it("binds a preview to the token that made it", async () => {
      const { summary } = await mintAgentToken(U, { name: "Second agent", scopes: ["write"] });
      const second = { claims: { sub: U }, tokenId: summary.id };
      const preview = await previewDeleteContacts(ctx, [CARA]);
      expect(await requestDeleteContacts(second, preview.preview_id!)).toEqual({
        ok: false,
        error: "Preview not found. Make a new preview.",
      });
    });

    it("gives a request 7 days from when it was asked", async () => {
      const requestId = await requestDeletion([CARA]);
      const [row] = await dbAdmin
        .select({ seconds: sql<number>`extract(epoch from ${agentPreviews.expiresAt} - ${agentPreviews.requestedAt})::int` })
        .from(agentPreviews)
        .where(eq(agentPreviews.id, requestId));
      expect(row.seconds).toBe(7 * 24 * 60 * 60);
    });

    it("refuses to request an unrequested preview that expired", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA]);
      await dbAdmin.execute(sql`
        update public.agent_previews set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        where id = ${preview.preview_id}`);
      expect(await requestDeleteContacts(ctx, preview.preview_id!)).toEqual({
        ok: false,
        error: "This preview expired. Make a new preview.",
      });
    });

    it.each([
      ["request: not found", "none", () => requestDeleteContacts(ctx, UNKNOWN), "Preview not found. Make a new preview."],
      ["request: already deleted", "approved", (id: string) => requestDeleteContacts(ctx, id), "The owner already deleted these contacts."],
      ["request: discarded", "discarded", (id: string) => requestDeleteContacts(ctx, id), "The owner discarded this deletion."],
      ["request: already requested", "requested", (id: string) => requestDeleteContacts(ctx, id), `Already requested. ${AWAITING_OWNER}`],
      ["approve: not found", "none", () => approveRequest(ctx.claims, UNKNOWN), REQUEST_NOT_FOUND],
      ["approve: already approved", "approved", (id: string) => approveRequest(ctx.claims, id), REQUEST_FINISHED],
      ["approve: discarded", "discarded", (id: string) => approveRequest(ctx.claims, id), REQUEST_FINISHED],
      ["discard: not found", "none", () => discardRequest(ctx.claims, UNKNOWN), REQUEST_NOT_FOUND],
      ["discard: already approved", "approved", (id: string) => discardRequest(ctx.claims, id), REQUEST_FINISHED],
    ] as const)("%s", async (_label, state, act, error) => {
      const preview = await previewDeleteContacts(ctx, [CARA]);
      const id = preview.preview_id!;
      if (state !== "none") await requestDeleteContacts(ctx, id);
      if (state === "approved") await approveRequest(ctx.claims, id);
      if (state === "discarded") await discardRequest(ctx.claims, id);
      expect(await act(id)).toEqual({ ok: false, error });
    });
  });

  it("discards a token's open requests when it is revoked", async () => {
    const { summary } = await mintAgentToken(U, { name: "Short lived", scopes: ["write"] });
    const short = { claims: { sub: U }, tokenId: summary.id };
    const preview = await previewDeleteContacts(short, [CARA]);
    await requestDeleteContacts(short, preview.preview_id!);
    const kept = await requestDeletion([DEV]);
    expect(await revokeAgentToken({ sub: U }, summary.id)).toBe(true);
    const [row] = await dbAdmin
      .select({ discardedAt: agentPreviews.discardedAt })
      .from(agentPreviews)
      .where(eq(agentPreviews.id, preview.preview_id!));
    expect(row.discardedAt).not.toBeNull();
    expect((await listPendingRequests(ctx.claims)).map((request) => request.previewId)).toEqual([kept]);
  });

  it("prunes expired and long-finished requests", async () => {
    const expired = await requestDeletion([CARA]);
    const finished = await requestDeletion([DEV]);
    const live = await requestDeletion([ANA]);
    await discardRequest(ctx.claims, finished);
    await dbAdmin.execute(sql`
      update public.agent_previews set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
      where id = ${expired}`);
    await dbAdmin.execute(sql`
      update public.agent_previews set discarded_at = now() - interval '31 days' where id = ${finished}`);
    await pruneFinishedRequests(U);
    const left = await dbAdmin
      .select({ id: agentPreviews.id })
      .from(agentPreviews)
      .where(eq(agentPreviews.userId, U));
    expect(left.map((row) => row.id)).toEqual([live]);
  });

  describe("undo_agent_change", () => {
    it("restores the replaced values, with its history in the same transaction", async () => {
      const result = await update({ id: ANA, fields: { postal_code: "97211-3417" } });
      const undone = await undoAgentChange(ctx.claims, result.event_id!, agentActor(ctx));
      expect(undone).toMatchObject({ ok: true, value: { contactId: ANA, restored: { postal_code: "97211" } } });
      expect((await stored(ANA)).postalCode).toBe("97211");
      const undoEvent = (await eventsOf(ANA)).find((event) => event.id === (undone.ok && undone.value.eventId));
      expect(undoEvent).toMatchObject({ source: "agent", diff: { undo_of: result.event_id } });
      expect(await undoAgentChange(ctx.claims, result.event_id!, agentActor(ctx))).toMatchObject({
        ok: false,
        error: expect.stringContaining("changed after the agent's edit"),
      });
    });

    it("locks the contact, so an edit committed meanwhile refuses the undo", async () => {
      const result = await update({ id: ANA, fields: { postal_code: "97211-3417" } });
      const undone = await duringConcurrentEdit(ANA, () =>
        undoAgentChange(ctx.claims, result.event_id!, agentActor(ctx)),
      );
      expect(undone).toMatchObject({ ok: false, error: expect.stringContaining("changed after") });
      expect((await stored(ANA)).postalCode).toBe("97211-3417");
    });

    it("refuses a create, an owner change, and another owner's event", async () => {
      const created = await create({ first_name: "Q" });
      expect(await undoAgentChange(ctx.claims, created.event_id!, agentActor(ctx))).toMatchObject({
        ok: false,
        error: expect.stringContaining("added the contact"),
      });
      const [ownerEvent] = await dbAdmin
        .insert(contactEvents)
        .values({ contactId: ANA, source: "owner", diff: { before: { city: "X" }, after: { city: "Y" } } })
        .returning({ id: contactEvents.id });
      expect(await undoAgentChange(ctx.claims, ownerEvent.id, agentActor(ctx))).toMatchObject({ ok: false });
      expect(await undoAgentChange({ sub: OTHER }, ownerEvent.id, { source: "owner" })).toEqual({
        ok: false,
        error: "Change not found.",
      });
    });
  });

  it("lists agent changes and approved deletions, newest first", async () => {
    const edit = await update({ id: ANA, fields: { city: "Salem" } });
    await dbAdmin.update(contacts).set({ notes: "hand edit" }).where(eq(contacts.id, ANA));
    const requestId = await requestDeletion([DEV]);
    await approveRequest(ctx.claims, requestId);
    const feed = await listAgentChanges(ctx.claims);
    expect(feed).toMatchObject([
      { kind: "deleted", names: ["Dev Patel"], tokenName: "Claude Code" },
      {
        kind: "change",
        eventId: edit.event_id,
        summary: "City Portland → Salem",
        undo: { canUndo: false, reason: "Changed since" },
      },
    ]);
    expect(await listAgentChanges({ sub: OTHER })).toEqual([]);
  });

  it("summarizes a diff in the owner's words", () => {
    expect(summarizeDiff({ before: { postal_code: "97211" }, after: { postal_code: "97211-3417" } })).toBe(
      "Postal code 97211 → 97211-3417",
    );
    expect(summarizeDiff({ after: { full_name: "Zed" } })).toBe("Added the contact");
    expect(
      summarizeDiff({
        before: { city: "A", country: "B", email: "c@d.e" },
        after: { city: "X", country: "Y", email: null },
      }),
    ).toBe("Removed email; City A → X and 1 more");
  });
});
