import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withRls } from "./index";
import { dbAdmin } from "./admin";
import { bookMembers, books, contactEvents, contacts, emailSends, submissions } from "./schema";

function chainMessage(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  while (cur instanceof Error) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.join(" <- ");
}

const OWNER = "00000000-0000-0000-0000-00000000c001";
const MEMBER = "00000000-0000-0000-0000-00000000c002";
const STRANGER = "00000000-0000-0000-0000-00000000c003";
const BOOK = "10000000-0000-0000-0000-00000000c001";
const CONTACT = "20000000-0000-0000-0000-00000000c001";

describe("book members under RLS", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values
        (${OWNER}, 'bm-owner@test.dev'), (${MEMBER}, 'bm-member@test.dev'),
        (${STRANGER}, 'bm-stranger@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug)
      values (${BOOK}, ${OWNER}, 'bm-test-book')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name)
      values (${CONTACT}, ${BOOK}, 'Shared Contact')
      on conflict (id) do nothing`);
    await dbAdmin.delete(bookMembers).where(eq(bookMembers.bookId, BOOK));
  });

  it("an unlinked email membership grants nothing", async () => {
    await dbAdmin.insert(bookMembers).values({ bookId: BOOK, email: "bm-member@test.dev" });
    const rows = await withRls({ sub: MEMBER }, (tx) => tx.select().from(contacts));
    expect(rows.filter((r) => r.bookId === BOOK)).toHaveLength(0);
  });

  describe("once linked", () => {
    beforeAll(async () => {
      await dbAdmin
        .update(bookMembers)
        .set({ userId: MEMBER, linkedAt: new Date() })
        .where(eq(bookMembers.bookId, BOOK));
    });

    it("the member reads the shared book and its contacts", async () => {
      const [book] = await withRls({ sub: MEMBER }, (tx) =>
        tx.select().from(books).where(eq(books.id, BOOK)),
      );
      expect(book?.ownerId).toBe(OWNER);
      const rows = await withRls({ sub: MEMBER }, (tx) => tx.select().from(contacts));
      expect(rows.some((r) => r.id === CONTACT)).toBe(true);
    });

    it("the member adds, edits and removes contacts", async () => {
      const id = await withRls({ sub: MEMBER }, async (tx) => {
        const [row] = await tx
          .insert(contacts)
          .values({ bookId: BOOK, fullName: "Added By Member" })
          .returning({ id: contacts.id });
        await tx.update(contacts).set({ notes: "edited" }).where(eq(contacts.id, row.id));
        return row.id;
      });
      const deleted = await withRls({ sub: MEMBER }, (tx) =>
        tx.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id }),
      );
      expect(deleted).toHaveLength(1);
    });

    it("the member reads, updates and deletes submissions on the shared book", async () => {
      const [{ id }] = await dbAdmin
        .insert(submissions)
        .values({ bookId: BOOK, payload: { full_name: "Pending P" } })
        .returning({ id: submissions.id });
      const read = await withRls({ sub: MEMBER }, (tx) =>
        tx.select().from(submissions).where(eq(submissions.id, id)),
      );
      expect(read).toHaveLength(1);
      const updated = await withRls({ sub: MEMBER }, (tx) =>
        tx.update(submissions).set({ status: "rejected" }).where(eq(submissions.id, id)).returning(),
      );
      expect(updated).toHaveLength(1);
      const deleted = await withRls({ sub: MEMBER }, (tx) =>
        tx.delete(submissions).where(eq(submissions.id, id)).returning(),
      );
      expect(deleted).toHaveLength(1);
    });

    it("the member reads sends and contact history on the shared book", async () => {
      await dbAdmin.insert(emailSends).values({ contactId: CONTACT, bookId: BOOK });
      await dbAdmin.insert(contactEvents).values({ contactId: CONTACT, source: "owner", diff: {} });
      const sends = await withRls({ sub: MEMBER }, (tx) =>
        tx.select().from(emailSends).where(eq(emailSends.contactId, CONTACT)),
      );
      const events = await withRls({ sub: MEMBER }, (tx) =>
        tx.select().from(contactEvents).where(eq(contactEvents.contactId, CONTACT)),
      );
      expect(sends.length).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);
      const strangerSends = await withRls({ sub: STRANGER }, (tx) =>
        tx.select().from(emailSends).where(eq(emailSends.contactId, CONTACT)),
      );
      expect(strangerSends).toHaveLength(0);
    });

    it("the member cannot change book settings", async () => {
      const updated = await withRls({ sub: MEMBER }, (tx) =>
        tx
          .update(books)
          .set({ senderCountry: "GB" })
          .where(eq(books.id, BOOK))
          .returning({ id: books.id }),
      );
      expect(updated).toHaveLength(0);
    });

    it("the member cannot create book memberships", async () => {
      await expect(
        withRls({ sub: MEMBER }, (tx) =>
          tx.insert(bookMembers).values({ bookId: BOOK, email: "friend@test.dev" }),
        ),
      ).rejects.toSatisfy((e) => /permission denied|row-level security/.test(chainMessage(e)));
    });

    it("a stranger still sees nothing", async () => {
      const rows = await withRls({ sub: STRANGER }, (tx) => tx.select().from(contacts));
      expect(rows.filter((r) => r.bookId === BOOK)).toHaveLength(0);
      const shared = await withRls({ sub: STRANGER }, (tx) => tx.select().from(books));
      expect(shared.filter((b) => b.id === BOOK)).toHaveLength(0);
    });
  });
});
