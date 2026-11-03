import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { bookMembers } from "@/lib/db/schema";
import { loadBookSender } from "@/lib/email/sender";
import { mintAgentToken, verifyAgentToken } from "@/lib/agent/tokens";
import { getOwnBook, linkPendingMembership } from "./books";

const OWNER = "00000000-0000-0000-0000-00000000d001";
const MEMBER = "00000000-0000-0000-0000-00000000d002";
const NEWCOMER = "00000000-0000-0000-0000-00000000d003";
const UNCONFIRMED = "00000000-0000-0000-0000-00000000d004";
const OWNS_A_BOOK = "00000000-0000-0000-0000-00000000d005";
const BOOK = "10000000-0000-0000-0000-00000000d001";
const OTHER_BOOK = "10000000-0000-0000-0000-00000000d005";

describe("getOwnBook with a shared book", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`
      insert into auth.users (id, email, email_confirmed_at) values
        (${OWNER}, 'gb-owner@test.dev', now()), (${MEMBER}, 'gb-member@test.dev', now()),
        (${NEWCOMER}, 'gb-newcomer@test.dev', now()),
        (${UNCONFIRMED}, 'gb-unconfirmed@test.dev', null),
        (${OWNS_A_BOOK}, 'gb-owns@test.dev', now())
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`delete from public.book_members where user_id in (${MEMBER}, ${OWNS_A_BOOK})`);
    await dbAdmin.execute(sql`delete from public.books where owner_id in (${MEMBER}, ${NEWCOMER}, ${UNCONFIRMED})`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug)
      values (${OTHER_BOOK}, ${OWNS_A_BOOK}, 'gb-other-book')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`update public.profiles set display_name = 'Sean & Tina' where id = ${OWNER}`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug)
      values (${BOOK}, ${OWNER}, 'gb-test-book')
      on conflict (id) do nothing`);
    await dbAdmin.delete(bookMembers).where(eq(bookMembers.bookId, BOOK));
    await dbAdmin.delete(bookMembers).where(eq(bookMembers.bookId, OTHER_BOOK));
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id = ${MEMBER}`);
    await dbAdmin.insert(bookMembers).values([
      { bookId: BOOK, email: "GB-Member@test.dev" },
      { bookId: BOOK, email: "gb-unconfirmed@test.dev" },
      { bookId: BOOK, email: "gb-owns@test.dev" },
    ]);
  });

  it("returns the owner's own book", async () => {
    expect((await getOwnBook({ sub: OWNER, email: "gb-owner@test.dev" }))?.id).toBe(BOOK);
  });

  it("returns nothing for a user with no book and no invite (onboarding)", async () => {
    expect(await getOwnBook({ sub: NEWCOMER, email: "gb-newcomer@test.dev" })).toBeUndefined();
  });

  it("returns undefined instead of throwing when linking fails", async () => {
    const execute = vi.spyOn(dbAdmin, "execute").mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getOwnBook({ sub: MEMBER, email: "gb-member@test.dev" })).toBeUndefined();
    execute.mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("links an invited email on first sign-in, case-insensitively, and returns the shared book", async () => {
    const { token } = await mintAgentToken(MEMBER, { name: "pre-link agent", scopes: ["read"] });
    expect(await verifyAgentToken(token)).not.toBeNull();
    const book = await getOwnBook({ sub: MEMBER, email: "gb-member@test.dev" });
    expect(book?.id).toBe(BOOK);
    const [row] = await dbAdmin
      .select()
      .from(bookMembers)
      .where(eq(bookMembers.email, "gb-member@test.dev"));
    expect(row.userId).toBe(MEMBER);
    expect(row.linkedAt).not.toBeNull();
    expect(await verifyAgentToken(token)).toBeNull();
  });

  it("ignores the session's email claim: a second account cannot claim the invite", async () => {
    expect(await getOwnBook({ sub: NEWCOMER, email: "gb-member@test.dev" })).toBeUndefined();
  });

  it("never links an unconfirmed email", async () => {
    expect(await getOwnBook({ sub: UNCONFIRMED, email: "gb-unconfirmed@test.dev" })).toBeUndefined();
    const [row] = await dbAdmin
      .select()
      .from(bookMembers)
      .where(eq(bookMembers.email, "gb-unconfirmed@test.dev"));
    expect(row.userId).toBeNull();
  });

  it("never links someone who already owns a book", async () => {
    expect((await getOwnBook({ sub: OWNS_A_BOOK, email: "gb-owns@test.dev" }))?.id).toBe(OTHER_BOOK);
    expect(await linkPendingMembership({ sub: OWNS_A_BOOK, email: "gb-owns@test.dev" })).toBe(false);
    const [row] = await dbAdmin
      .select()
      .from(bookMembers)
      .where(eq(bookMembers.email, "gb-owns@test.dev"));
    expect(row.userId).toBeNull();
  });

  it("refuses a book created by a linked member", async () => {
    await expect(
      dbAdmin.execute(sql`
        insert into public.books (owner_id, slug) values (${MEMBER}, 'gb-member-second-book')`),
    ).rejects.toSatisfy((e) => /cannot own another/.test(String((e as Error).cause ?? e)));
  });

  it("refuses moving a book to a linked member", async () => {
    await expect(
      dbAdmin.execute(sql`update public.books set owner_id = ${MEMBER} where id = ${OTHER_BOOK}`),
    ).rejects.toSatisfy((e) => /cannot own another/.test(String((e as Error).cause ?? e)));
  });

  it("signs emails with the owner's name and replies to owner then member", async () => {
    const sender = await loadBookSender(BOOK, OWNER);
    expect(sender.name).toBe("Sean & Tina");
    expect(sender.replyTo).toEqual(["gb-owner@test.dev", "gb-member@test.dev"]);
  });
});
