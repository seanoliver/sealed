import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { type ServerContext } from "@modelcontextprotocol/server";
import { dbAdmin } from "@/lib/db/admin";
import { contactEvents, contacts, submissions } from "@/lib/db/schema";
import {
  applyBulkUpdate,
  applyDeleteContacts,
  previewBulkUpdate,
  previewDeleteContacts,
} from "./bulk";
import { listAgentChanges, summarizeDiff, undoAgentChange } from "./changes";
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

const U = "00000000-0000-4000-8000-0000000ab001";
const OTHER = "00000000-0000-4000-8000-0000000ab002";
const B = "10000000-0000-4000-8000-0000000ab001";
const OTHER_B = "10000000-0000-4000-8000-0000000ab002";
const ANA = "20000000-0000-4000-8000-0000000ab001";
const CARA = "20000000-0000-4000-8000-0000000ab002";
const DEV = "20000000-0000-4000-8000-0000000ab003";
const FOREIGN = "20000000-0000-4000-8000-0000000ab009";

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

    it("changes names as a household, keeping the stored ones", async () => {
      await update({ id: ANA, fields: { partner_first_name: "Ben" } });
      expect(await stored(ANA)).toMatchObject({
        firstName: "Ana",
        lastName: "Reyes",
        partnerFirstName: "Ben",
        partnerName: "Ben",
      });
      await update({ id: ANA, fields: { partner_first_name: null } });
      expect(await stored(ANA)).toMatchObject({ partnerFirstName: null, partnerName: null });
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

    it("caps a preview at 500 contacts", () => {
      const many = Array.from({ length: 501 }, () => ({ id: ANA, fields: { city: "X" } }));
      expect(() => previewBulkUpdateInput.parse({ changes: many })).toThrow();
    });
  });

  describe("delete contacts", () => {
    it("previews, then deletes exactly those contacts", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA, DEV]);
      expect(preview).toMatchObject({ count: 2, items: [{ id: CARA, name: "Cara Diaz" }, { id: DEV }] });
      expect(await stored(CARA)).toBeDefined();
      expect(await applyDeleteContacts(ctx, preview.preview_id!)).toEqual({ ok: true, value: { deleted: 2 } });
      expect(await stored(CARA)).toBeUndefined();
      expect(await stored(DEV)).toBeUndefined();
      expect(await stored(ANA)).toBeDefined();
    });

    it("refuses when a contact changed after the preview, and leaves every contact", async () => {
      const preview = await previewDeleteContacts(ctx, [CARA, DEV]);
      await dbAdmin.update(contacts).set({ city: "Waterloo" }).where(eq(contacts.id, DEV));
      expect(await applyDeleteContacts(ctx, preview.preview_id!)).toMatchObject({ ok: false });
      expect(await stored(CARA)).toBeDefined();
    });

    it("refuses another owner's contact", async () => {
      expect(await previewDeleteContacts(ctx, [FOREIGN])).toMatchObject({
        preview_id: null,
        problems: [{ id: FOREIGN, error: "Contact not found." }],
      });
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
      await applyDeleteContacts(ctx, deletion.preview_id!);

      const feed = await listAgentChanges(ctx.claims);
      expect(feed.map((entry) => entry.kind)).toEqual(["deleted", "bulk"]);
      const [deleted, bulk] = feed;
      expect(deleted).toMatchObject({ names: ["Dev Patel"], tokenName: "Claude Code" });
      expect(bulk).toMatchObject({ kind: "bulk", tokenName: "Claude Code" });
      const byName = Object.fromEntries(
        (bulk.kind === "bulk" ? bulk.changes : []).map((change) => [change.contactName, change]),
      );
      expect(byName["Ana Reyes"]).toMatchObject({ summary: "Added country US", undo: { canUndo: true } });
      expect(byName["Cara Diaz"]).toMatchObject({ undo: { canUndo: false, reason: "Changed since" } });
      expect(await listAgentChanges({ sub: OTHER })).toEqual([]);
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
