import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { type ServerContext } from "@modelcontextprotocol/server";
import { dbAdmin } from "@/lib/db/admin";
import { agentPreviews, contactEvents, contacts, submissions } from "@/lib/db/schema";
import {
  applyBulkUpdate,
  approveDeletion,
  AWAITING_OWNER,
  discardDeletion,
  listPendingDeletions,
  previewBulkUpdate,
  previewDeleteContacts,
  requestDeleteContacts,
} from "./bulk";
import { listAgentChanges, summarizeDiff, undoAgentBatch, undoAgentChange } from "./changes";
import { agentContext } from "./mcp";
import { AgentScopeError } from "./scopes";
import { mintAgentToken } from "./tokens";
import {
  agentActor,
  createContact,
  createContactInput,
  previewBulkUpdateInput,
  resolveReviewItem,
  toPatchRequest,
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

let ctx: AgentContext;
let otherTokenCtx: AgentContext;

const stored = async (id: string) =>
  (await dbAdmin.select().from(contacts).where(eq(contacts.id, id)))[0];
const eventsOf = (id: string) =>
  dbAdmin.select().from(contactEvents).where(eq(contactEvents.contactId, id));

const update = (input: object) => updateContact(ctx, updateContactInput.parse(input));
const changes = (input: object) =>
  previewBulkUpdateInput
    .parse(input)
    .changes.map((change) => ({ id: change.id, request: toPatchRequest(change.fields) }));

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
    const { summary: second } = await mintAgentToken(U, { name: "Other agent", scopes: ["write"] });
    ctx = { claims: { sub: U, agent_token_id: summary.id }, tokenId: summary.id };
    otherTokenCtx = { claims: { sub: U, agent_token_id: second.id }, tokenId: second.id };
  });

  beforeEach(seed);

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id in (${B}, ${OTHER_B})`);
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id = ${U}`);
  });

  describe("scope enforcement", () => {
    const serverContext = (scopes: string[]) =>
      ({
        http: { authInfo: { token: "t", clientId: ctx.tokenId, scopes, extra: { claims: ctx.claims } } },
      }) as unknown as ServerContext;

    it("refuses a write tool's context to a read-only token", () => {
      expect(() => agentContext(serverContext(["read"]), "write")).toThrow(AgentScopeError);
      expect(agentContext(serverContext(["write"]), "write")).toEqual(ctx);
    });
  });

  describe("update_contact", () => {
    it("applies the sheet's rules and records an undoable agent event", async () => {
      const result = await update({ id: ANA, fields: { postal_code: "97211-3417", city: null } });
      expect(result).toMatchObject({
        changed: true,
        before: { postal_code: "97211", city: "Portland" },
        after: { postal_code: "97211-3417", city: null },
      });
      expect(await stored(ANA)).toMatchObject({ postalCode: "97211-3417", city: null });
      const [event] = await eventsOf(ANA);
      expect(event).toMatchObject({ source: "agent", agentTokenId: ctx.tokenId, agentPreviewId: null });
      expect(event.contactUpdatedAt).not.toBeNull();
    });

    it("refuses what the dashboard refuses", async () => {
      await expect(update({ id: ANA, fields: { partner_email: "ANA@wt.test" } })).rejects.toThrow(
        "The partner's email must differ from the email",
      );
      await expect(update({ id: ANA, fields: { email: "not-an-email" } })).rejects.toThrow(ToolError);
      await expect(update({ id: ANA, fields: { email: "cara@wt.test" } })).rejects.toThrow(
        "You already have a contact with this email",
      );
      await expect(update({ id: ANA, fields: { first_name: "" } })).rejects.toThrow(ToolError);
      expect(await eventsOf(ANA)).toHaveLength(0);
    });

    it("moves an unedited partner and kids to a new last name, as the sheet does", async () => {
      await update({ id: ANA, fields: { partner_first_name: "Ben", kids: [{ first: "Kit" }, { first: "Lu", last: "Ono" }] } });
      expect(await stored(ANA)).toMatchObject({ partnerLastName: "Reyes" });
      await update({ id: ANA, fields: { last_name: "Lopez" } });
      expect(await stored(ANA)).toMatchObject({
        fullName: "Ana Lopez",
        partnerFirstName: "Ben",
        partnerLastName: "Lopez",
        kids: [{ first: "Kit", last: "Lopez" }, { first: "Lu", last: "Ono" }],
      });
    });

    it("removes the partner when partner_first_name is blank", async () => {
      await update({ id: ANA, fields: { partner_first_name: "Ben", partner_last_name: "Cruz" } });
      await update({ id: ANA, fields: { partner_first_name: "" } });
      expect(await stored(ANA)).toMatchObject({
        partnerFirstName: null,
        partnerLastName: null,
        partnerName: null,
      });
    });

    it("changes names as a household, keeping the stored ones", async () => {
      await update({ id: ANA, fields: { partner_first_name: "Ben" } });
      expect(await stored(ANA)).toMatchObject({
        firstName: "Ana",
        lastName: "Reyes",
        partnerFirstName: "Ben",
        partnerLastName: "Reyes",
        partnerName: "Ben Reyes",
      });
      await update({ id: ANA, fields: { partner_first_name: null } });
      expect(await stored(ANA)).toMatchObject({ partnerFirstName: null, partnerName: null });
    });

    it("still reports a saved edit when the audit insert fails", async () => {
      const insert = vi.spyOn(dbAdmin, "insert").mockImplementationOnce(() => {
        throw new Error("audit down");
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await update({ id: ANA, fields: { city: "Bend" } })).toMatchObject({
          changed: true,
          event_id: null,
        });
        expect((await stored(ANA)).city).toBe("Bend");
        expect(log).toHaveBeenCalledWith("[ct] [recordContactEvents] audit insert failed db error", expect.any(String));
      } finally {
        insert.mockRestore();
        log.mockRestore();
      }
    });

    it("reports a no-op without an event, and another owner's contact as missing", async () => {
      expect(await update({ id: ANA, fields: { city: "Portland" } })).toEqual({ id: ANA, changed: false });
      expect(await eventsOf(ANA)).toHaveLength(0);
      await expect(update({ id: FOREIGN, fields: { city: "X" } })).rejects.toThrow("Contact not found.");
      expect((await stored(FOREIGN)).city).toBeNull();
    });
  });

  describe("create_contact", () => {
    it("adds a contact with an agent event", async () => {
      const created = await createContact(
        ctx,
        createContactInput.parse({
          fields: { first_name: "Zed", last_name: "New", email: "zed@wt.test", kids: [{ first: "Kit" }] },
        }),
      );
      expect(await stored(created.id)).toMatchObject({
        fullName: "Zed New",
        kidsNames: "Kit",
        email: "zed@wt.test",
        bookId: B,
      });
      const [event] = await eventsOf(created.id);
      expect(event).toMatchObject({ id: created.event_id, source: "agent", agentTokenId: ctx.tokenId });
    });

    it("refuses a duplicate email and a missing first name", async () => {
      await expect(
        createContact(ctx, createContactInput.parse({ fields: { first_name: "A", email: "ana@wt.test" } })),
      ).rejects.toThrow("You already have a contact with this email");
      await expect(
        createContact(ctx, createContactInput.parse({ fields: { first_name: " " } })),
      ).rejects.toThrow(ToolError);
      expect(() => createContactInput.parse({ fields: { city: "X" } })).toThrow();
    });
  });

  describe("bulk update", () => {
    it("previews without saving, then applies exactly that diff as one batch", async () => {
      const preview = await previewBulkUpdate(
        ctx,
        changes({
          changes: [
            { id: ANA, fields: { country: "US" } },
            { id: CARA, fields: { country: "US", city: "Austin" } },
            { id: DEV, fields: { city: "Toronto" } },
          ],
        }),
      );
      expect(preview).toMatchObject({
        count: 2,
        unchanged: [DEV],
        items: [
          { id: ANA, name: "Ana Reyes", before: { country: null }, after: { country: "US" } },
          { id: CARA, after: { country: "US" } },
        ],
      });
      expect((await stored(ANA)).country).toBeNull();

      const applied = await applyBulkUpdate(ctx, preview.preview_id!);
      expect(applied).toMatchObject({ ok: true, value: { applied: 2 } });
      expect((await stored(ANA)).country).toBe("US");
      expect((await stored(CARA)).country).toBe("US");
      const [event] = await eventsOf(CARA);
      expect(event).toMatchObject({ source: "agent", agentPreviewId: preview.preview_id });

      expect(await applyBulkUpdate(ctx, preview.preview_id!)).toEqual({
        ok: false,
        error: "This preview was already applied.",
      });
    });

    it("refuses the whole apply when a contact changed after the preview", async () => {
      const preview = await previewBulkUpdate(
        ctx,
        changes({ changes: [{ id: ANA, fields: { country: "US" } }, { id: CARA, fields: { country: "US" } }] }),
      );
      await dbAdmin.update(contacts).set({ city: "Round Rock" }).where(eq(contacts.id, CARA));

      const applied = await applyBulkUpdate(ctx, preview.preview_id!);
      expect(applied).toMatchObject({ ok: false });
      expect(!applied.ok && applied.error).toContain(CARA);
      expect((await stored(ANA)).country).toBeNull();
      expect(await eventsOf(ANA)).toHaveLength(0);
    });

    it("lets only one of two concurrent applies run", async () => {
      const preview = await previewBulkUpdate(ctx, changes({ changes: [{ id: ANA, fields: { country: "US" } }] }));
      const results = await Promise.all([
        applyBulkUpdate(ctx, preview.preview_id!),
        applyBulkUpdate(ctx, preview.preview_id!),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(await eventsOf(ANA)).toHaveLength(1);
    });

    it("makes no preview when any change is invalid or unknown", async () => {
      const preview = await previewBulkUpdate(
        ctx,
        changes({
          changes: [
            { id: ANA, fields: { country: "US" } },
            { id: CARA, fields: { email: "nope" } },
            { id: FOREIGN, fields: { city: "X" } },
          ],
        }),
      );
      expect(preview).toMatchObject({
        preview_id: null,
        problems: [{ id: CARA }, { id: FOREIGN, error: "Contact not found." }],
      });
    });

    it("binds a preview to the token that made it", async () => {
      const preview = await previewBulkUpdate(ctx, changes({ changes: [{ id: ANA, fields: { country: "US" } }] }));
      expect(await applyBulkUpdate(otherTokenCtx, preview.preview_id!)).toEqual({
        ok: false,
        error: "Preview not found. Make a new preview.",
      });
    });

    it("refuses an expired preview", async () => {
      const preview = await previewBulkUpdate(ctx, changes({ changes: [{ id: ANA, fields: { country: "US" } }] }));
      await dbAdmin.execute(sql`
        update public.agent_previews set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        where id = ${preview.preview_id}`);
      expect(await applyBulkUpdate(ctx, preview.preview_id!)).toEqual({
        ok: false,
        error: "This preview expired. Make a new preview.",
      });
    });

    it("refuses emails another contact holds, including a swap, and repeats in one batch", async () => {
      const swap = await previewBulkUpdate(
        ctx,
        changes({
          changes: [
            { id: ANA, fields: { email: "cara@wt.test" } },
            { id: CARA, fields: { email: "ANA@wt.test" } },
          ],
        }),
      );
      expect(swap).toMatchObject({
        preview_id: null,
        problems: [
          { id: ANA, error: expect.stringContaining(`belongs to contact ${CARA}`) },
          { id: CARA, error: expect.stringContaining(`belongs to contact ${ANA}`) },
        ],
      });
      const repeated = await previewBulkUpdate(
        ctx,
        changes({
          changes: [
            { id: ANA, fields: { email: "new@wt.test" } },
            { id: DEV, fields: { email: "New@wt.test" } },
          ],
        }),
      );
      expect(repeated).toMatchObject({
        preview_id: null,
        problems: [{ id: DEV, error: expect.stringContaining(`also given to contact ${ANA}`) }],
      });
    });

    it("accepts a change of case in a contact's own email", async () => {
      const preview = await previewBulkUpdate(ctx, changes({ changes: [{ id: ANA, fields: { email: "Ana@WT.test" } }] }));
      expect(preview).toMatchObject({ count: 1, items: [{ id: ANA, after: { email: "Ana@WT.test" } }] });
    });

    it("lists a contact given twice as a problem", async () => {
      expect(
        await previewBulkUpdate(
          ctx,
          changes({ changes: [{ id: ANA, fields: { city: "A" } }, { id: ANA, fields: { country: "B" } }] }),
        ),
      ).toMatchObject({ preview_id: null, problems: [{ id: ANA, error: expect.stringContaining("more than once") }] });
    });

    it("refuses the whole apply when an email was taken after the preview", async () => {
      const preview = await previewBulkUpdate(
        ctx,
        changes({ changes: [{ id: ANA, fields: { email: "taken@wt.test", city: "Bend" } }] }),
      );
      await dbAdmin.insert(contacts).values({ bookId: B, fullName: "Late", email: "taken@wt.test" });
      expect(await applyBulkUpdate(ctx, preview.preview_id!)).toEqual({
        ok: false,
        error: "Nothing was changed: you already have a contact with this email.",
      });
      expect((await stored(ANA)).city).toBe("Portland");
    });

    it("keeps only ids and names once applied", async () => {
      const preview = await previewBulkUpdate(ctx, changes({ changes: [{ id: ANA, fields: { country: "US" } }] }));
      await applyBulkUpdate(ctx, preview.preview_id!);
      const [row] = await dbAdmin
        .select({ items: agentPreviews.items })
        .from(agentPreviews)
        .where(eq(agentPreviews.id, preview.preview_id!));
      expect(row.items).toEqual([{ id: ANA, name: "Ana Reyes" }]);
    });

    it("prunes finished previews after 30 days", async () => {
      const preview = await previewBulkUpdate(ctx, changes({ changes: [{ id: ANA, fields: { country: "US" } }] }));
      await applyBulkUpdate(ctx, preview.preview_id!);
      await dbAdmin.execute(sql`
        update public.agent_previews set applied_at = now() - interval '31 days' where id = ${preview.preview_id}`);
      await previewBulkUpdate(ctx, changes({ changes: [{ id: CARA, fields: { country: "US" } }] }));
      expect(
        await dbAdmin.select().from(agentPreviews).where(eq(agentPreviews.id, preview.preview_id!)),
      ).toEqual([]);
      expect((await eventsOf(ANA))[0]).toMatchObject({ agentPreviewId: preview.preview_id });
    });

    it("caps a preview at 500 contacts", () => {
      const many = Array.from({ length: 501 }, () => ({ id: ANA, fields: { city: "X" } }));
      expect(() => previewBulkUpdateInput.parse({ changes: many })).toThrow();
    });
  });

  describe("delete contacts", () => {
    const pendingNames = async () =>
      (await listPendingDeletions(ctx.claims)).map((request) =>
        request.contacts.map((contact) => contact.name),
      );

    it("only asks the owner; the owner's approval deletes exactly those contacts", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA, DEV]);
      expect(preview).toMatchObject({ count: 2, items: [{ id: CARA, name: "Cara Diaz" }, { id: DEV }] });
      expect(await requestDeleteContacts(ctx, preview.preview_id!)).toEqual({
        ok: true,
        value: { status: "pending", count: 2, message: AWAITING_OWNER },
      });
      expect(await stored(CARA)).toBeDefined();
      expect(await requestDeleteContacts(ctx, preview.preview_id!)).toMatchObject({ ok: false });
      expect(await pendingNames()).toEqual([["Cara Diaz", "Dev Patel"]]);

      expect(await approveDeletion(ctx.claims, preview.preview_id!)).toEqual({ ok: true, value: { deleted: 2 } });
      expect(await stored(CARA)).toBeUndefined();
      expect(await stored(DEV)).toBeUndefined();
      expect(await stored(ANA)).toBeDefined();
      expect(await pendingNames()).toEqual([]);
      expect(await approveDeletion(ctx.claims, preview.preview_id!)).toMatchObject({ ok: false });
    });

    it("keeps only names once a deletion is approved", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA]);
      await requestDeleteContacts(ctx, preview.preview_id!);
      await approveDeletion(ctx.claims, preview.preview_id!);
      const [row] = await dbAdmin
        .select({ items: agentPreviews.items })
        .from(agentPreviews)
        .where(eq(agentPreviews.id, preview.preview_id!));
      expect(row.items).toEqual([{ name: "Cara Diaz" }]);
      expect(JSON.stringify(row.items)).not.toMatch(/cara@wt\.test|Austin/);
    });

    it("discarding keeps every contact", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA]);
      await requestDeleteContacts(ctx, preview.preview_id!);
      expect(await discardDeletion(ctx.claims, preview.preview_id!)).toEqual({ ok: true, value: {} });
      expect(await stored(CARA)).toBeDefined();
      expect(await pendingNames()).toEqual([]);
      expect(await approveDeletion(ctx.claims, preview.preview_id!)).toMatchObject({ ok: false });
    });

    it("refuses an approval when a contact changed after the preview", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA, DEV]);
      await requestDeleteContacts(ctx, preview.preview_id!);
      await dbAdmin.update(contacts).set({ city: "Waterloo" }).where(eq(contacts.id, DEV));
      const result = await approveDeletion(ctx.claims, preview.preview_id!);
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.error).toContain(DEV);
      expect(await stored(CARA)).toBeDefined();
    });

    it("shows each contact's email and address, and flags this agent's recent edits", async () => {
      await update({ id: ANA, fields: { first_name: "Zed" } });
      const preview = await previewDeleteContacts(ctx, [ANA, CARA]);
      await requestDeleteContacts(ctx, preview.preview_id!);
      const [request] = await listPendingDeletions(ctx.claims);
      expect(request.contacts).toEqual([
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

    const UNKNOWN = "40000000-0000-4000-8000-0000000d70ff";
    const FINISHED = "This deletion was already approved or discarded.";
    it.each([
      ["request: not found", "none", () => requestDeleteContacts(ctx, UNKNOWN), "Preview not found. Make a new preview."],
      ["request: already deleted", "approved", (id: string) => requestDeleteContacts(ctx, id), "The owner already deleted these contacts."],
      ["request: discarded", "discarded", (id: string) => requestDeleteContacts(ctx, id), "The owner discarded this deletion."],
      ["request: already requested", "requested", (id: string) => requestDeleteContacts(ctx, id), `Already requested. ${AWAITING_OWNER}`],
      ["approve: not found", "none", () => approveDeletion(ctx.claims, UNKNOWN), "Preview not found. Make a new preview."],
      ["approve: already approved", "approved", (id: string) => approveDeletion(ctx.claims, id), FINISHED],
      ["approve: discarded", "discarded", (id: string) => approveDeletion(ctx.claims, id), FINISHED],
      ["discard: already approved", "approved", (id: string) => discardDeletion(ctx.claims, id), FINISHED],
      ["discard: already discarded", "discarded", (id: string) => discardDeletion(ctx.claims, id), FINISHED],
    ] as const)("%s", async (_label, state, act, error) => {
      const preview = await previewDeleteContacts(ctx, [CARA]);
      const id = preview.preview_id!;
      if (state !== "none") await requestDeleteContacts(ctx, id);
      if (state === "approved") await approveDeletion(ctx.claims, id);
      if (state === "discarded") await discardDeletion(ctx.claims, id);
      expect(await act(id)).toEqual({ ok: false, error });
    });

    it("lets a request expire after 7 days", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA]);
      await requestDeleteContacts(ctx, preview.preview_id!);
      const [row] = await dbAdmin
        .select({ days: sql<number>`extract(day from ${agentPreviews.expiresAt} - now())::int` })
        .from(agentPreviews)
        .where(eq(agentPreviews.id, preview.preview_id!));
      expect(row.days).toBe(6);
      await dbAdmin.execute(sql`
        update public.agent_previews set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        where id = ${preview.preview_id}`);
      expect(await pendingNames()).toEqual([]);
      expect(await approveDeletion(ctx.claims, preview.preview_id!)).toEqual({
        ok: false,
        error: "This request expired. Ask the agent to make a new one.",
      });
      expect(await stored(CARA)).toBeDefined();
    });

    it("refuses another owner's contact and another owner's approval", async () => {
      expect(await previewDeleteContacts(ctx, [FOREIGN])).toMatchObject({
        preview_id: null,
        problems: [{ id: FOREIGN, error: "Contact not found." }],
      });
      const preview = await previewDeleteContacts(ctx, [CARA]);
      await requestDeleteContacts(ctx, preview.preview_id!);
      expect(await approveDeletion({ sub: OTHER }, preview.preview_id!)).toMatchObject({ ok: false });
      expect(await stored(CARA)).toBeDefined();
    });
  });

  describe("resolve_review_item", () => {
    it("merges a matched reply, adds an unmatched one, and rejects", async () => {
      const [matched, unmatched, junk] = await dbAdmin
        .insert(submissions)
        .values([
          { bookId: B, payload: { full_name: "Ana Reyes", city: "Eugene" }, matchedContactId: ANA },
          { bookId: B, payload: { full_name: "Zoe Ng", email: "zoe@wt.test" } },
          { bookId: B, payload: { full_name: "Spam" } },
        ])
        .returning({ id: submissions.id });

      expect(await resolveReviewItem(ctx, { id: matched.id, action: "approve" })).toMatchObject({
        status: "approved",
        contact_id: ANA,
      });
      expect((await stored(ANA)).city).toBe("Eugene");
      expect((await eventsOf(ANA))[0]).toMatchObject({ source: "agent", agentTokenId: ctx.tokenId });

      const added = await resolveReviewItem(ctx, { id: unmatched.id, action: "approve" });
      expect(await stored(added.contact_id!)).toMatchObject({ fullName: "Zoe Ng", bookId: B });

      expect(await resolveReviewItem(ctx, { id: junk.id, action: "reject" })).toEqual({
        id: junk.id,
        status: "rejected",
      });
      await expect(resolveReviewItem(ctx, { id: junk.id, action: "reject" })).rejects.toThrow(
        "Submission not found",
      );
    });
  });

  describe("approving a merge", () => {
    it("locks the contact, so an edit committed meanwhile is the merge's before value", async () => {
      const [reply] = await dbAdmin
        .insert(submissions)
        .values({ bookId: B, payload: { full_name: "Ana Reyes", city: "Eugene" }, matchedContactId: ANA })
        .returning({ id: submissions.id });
      let approval: Promise<unknown> | undefined;
      await dbAdmin.transaction(async (tx) => {
        await tx.update(contacts).set({ city: "Bend" }).where(eq(contacts.id, ANA));
        approval = resolveReviewItem(ctx, { id: reply.id, action: "approve" });
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      await approval;
      const [event] = await eventsOf(ANA);
      expect(event.diff).toMatchObject({ before: { city: "Bend" }, after: { city: "Eugene" } });
    });
  });

  describe("undo_agent_change", () => {
    it("restores the replaced values as a new agent change", async () => {
      const result = await update({ id: ANA, fields: { postal_code: "97211-3417" } });
      const undone = await undoAgentChange(ctx.claims, result.event_id!, agentActor(ctx));
      expect(undone).toMatchObject({ ok: true, value: { contactId: ANA, restored: { postal_code: "97211" } } });
      expect((await stored(ANA)).postalCode).toBe("97211");

      expect(await undoAgentChange(ctx.claims, result.event_id!, agentActor(ctx))).toMatchObject({
        ok: false,
        error: expect.stringContaining("changed after the agent's edit"),
      });
    });

    it("refuses when the contact changed since", async () => {
      const result = await update({ id: ANA, fields: { postal_code: "97211-3417" } });
      await dbAdmin.update(contacts).set({ notes: "edited by hand" }).where(eq(contacts.id, ANA));
      expect(await undoAgentChange(ctx.claims, result.event_id!, { source: "owner" })).toMatchObject({
        ok: false,
      });
      expect((await stored(ANA)).postalCode).toBe("97211-3417");
    });

    it("refuses to restore an email another contact took since", async () => {
      const result = await update({ id: ANA, fields: { email: "ana.new@wt.test" } });
      await dbAdmin.insert(contacts).values({ bookId: B, fullName: "Copy", email: "ana@wt.test" });
      expect(await undoAgentChange(ctx.claims, result.event_id!, { source: "owner" })).toEqual({
        ok: false,
        error: "You already have a contact with this email, so the old email can't come back.",
      });
      expect((await stored(ANA)).email).toBe("ana.new@wt.test");
    });

    it("can't be pointed at an owner event: only agent events carry contact_updated_at", async () => {
      await expect(
        dbAdmin.insert(contactEvents).values({
          contactId: ANA,
          source: "owner",
          diff: { before: { city: "X" }, after: { city: "Y" } },
          contactUpdatedAt: sql`now()`,
        }),
      ).rejects.toThrow();
    });

    it("refuses a create, an owner change, and another owner's event", async () => {
      const created = await createContact(ctx, createContactInput.parse({ fields: { first_name: "Q" } }));
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

  describe("recent agent changes", () => {
    it("lists single changes and groups a bulk apply, with undo state", async () => {
      await update({ id: DEV, fields: { postal_code: "M5V 2T6" } });
      const preview = await previewBulkUpdate(
        ctx,
        changes({ changes: [{ id: ANA, fields: { country: "US" } }, { id: CARA, fields: { country: "US" } }] }),
      );
      await applyBulkUpdate(ctx, preview.preview_id!);
      await dbAdmin.update(contacts).set({ notes: "hand edit" }).where(eq(contacts.id, CARA));
      const deletion = await previewDeleteContacts(ctx, [DEV]);
      await requestDeleteContacts(ctx, deletion.preview_id!);
      await approveDeletion(ctx.claims, deletion.preview_id!);

      const feed = await listAgentChanges(ctx.claims);
      expect(feed.map((entry) => entry.kind)).toEqual(["deleted", "bulk"]);
      const [deleted, bulk] = feed;
      expect(deleted).toMatchObject({ names: ["Dev Patel"], tokenName: "Claude Code" });
      expect(bulk).toMatchObject({ kind: "bulk", tokenName: "Claude Code", count: 2 });
      const byName = Object.fromEntries(
        (bulk.kind === "bulk" ? bulk.changes : []).map((change) => [change.contactName, change]),
      );
      expect(byName["Ana Reyes"]).toMatchObject({ summary: "Added country US", undo: { canUndo: true } });
      expect(byName["Cara Diaz"]).toMatchObject({ undo: { canUndo: false, reason: "Changed since" } });
      expect(await listAgentChanges({ sub: OTHER })).toEqual([]);
    });

    it("pages by entry, so a 150-contact bulk counts once and older changes stay listed", async () => {
      const older = await update({ id: ANA, fields: { city: "Salem" } });
      await dbAdmin.execute(sql`
        insert into public.contacts (book_id, full_name, first_name, city)
        select ${B}, 'Bulk ' || g, 'Bulk', 'Old' from generate_series(1, 150) g`);
      const bulkIds = (
        await dbAdmin.select({ id: contacts.id }).from(contacts).where(eq(contacts.city, "Old"))
      ).map((row) => row.id);
      expect(bulkIds).toHaveLength(150);
      const preview = await previewBulkUpdate(
        ctx,
        bulkIds.map((id) => ({ id, request: toPatchRequest({ city: "New" }) })),
      );
      await applyBulkUpdate(ctx, preview.preview_id!);
      const newer = await update({ id: DEV, fields: { city: "Ottawa" } });

      const feed = await listAgentChanges(ctx.claims, { limit: 3 });
      expect(feed.map((entry) => (entry.kind === "change" ? entry.eventId : entry.kind))).toEqual([
        newer.event_id,
        "bulk",
        older.event_id,
      ]);
      expect(feed[1]).toMatchObject({ count: 150 });
      expect(feed[1].kind === "bulk" && feed[1].changes).toHaveLength(150);

      await dbAdmin.update(contacts).set({ notes: "hand edit" }).where(inArray(contacts.id, bulkIds.slice(0, 3)));
      expect(await undoAgentBatch(ctx.claims, preview.preview_id!, { source: "owner" })).toEqual({
        ok: true,
        value: { undone: 147, skipped: 3 },
      });
      const cities = await dbAdmin
        .select({ city: contacts.city, n: sql<number>`count(*)::int` })
        .from(contacts)
        .where(inArray(contacts.id, bulkIds))
        .groupBy(contacts.city);
      expect(Object.fromEntries(cities.map((row) => [row.city, row.n]))).toEqual({ Old: 147, New: 3 });
    });
  });

  it("reports a database failure in Undo all, separately from skips, and changes nothing", async () => {
    const preview = await previewBulkUpdate(
      ctx,
      changes({ changes: [{ id: ANA, fields: { country: "US" } }, { id: CARA, fields: { country: "US" } }] }),
    );
    await applyBulkUpdate(ctx, preview.preview_id!);
    const transaction = vi.spyOn(dbAdmin, "transaction").mockRejectedValueOnce(new Error("connection lost"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await undoAgentBatch(ctx.claims, preview.preview_id!, { source: "owner" })).toEqual({
        ok: false,
        error: "Nothing was undone. Something went wrong. Please try again.",
      });
    } finally {
      transaction.mockRestore();
      log.mockRestore();
    }
    expect((await stored(ANA)).country).toBe("US");
    expect(await undoAgentBatch(ctx.claims, preview.preview_id!, { source: "owner" })).toEqual({
      ok: true,
      value: { undone: 2, skipped: 0 },
    });
  });

  it("summarizes a diff in the owner's words", () => {
    expect(summarizeDiff({ before: { postal_code: "97211" }, after: { postal_code: "97211-3417" } })).toBe(
      "Postal code 97211 → 97211-3417",
    );
    expect(
      summarizeDiff({
        before: { partner_first_name: null, partner_name: null },
        after: { partner_first_name: "Ben", partner_name: "Ben" },
      }),
    ).toBe("Added partner first name Ben");
    expect(summarizeDiff({ after: { full_name: "Zed" } })).toBe("Added the contact");
    expect(
      summarizeDiff({
        before: { city: "A", country: "B", email: "c@d.e" },
        after: { city: "X", country: "Y", email: null },
      }),
    ).toBe("Removed email; City A → X and 1 more");
  });
});
