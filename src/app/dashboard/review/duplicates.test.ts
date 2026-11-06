import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { contactEvents, contacts } from "@/lib/db/schema";
import { dismissDuplicate, keepDuplicate } from "./actions";
import { mergeDuplicateAs } from "./duplicates";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const U = "00000000-0000-4000-8000-0000000dd201";
const B = "10000000-0000-4000-8000-0000000dd201";
const KEEP = "20000000-0000-4000-8000-0000000dd201";
const REMOVE = "20000000-0000-4000-8000-0000000dd202";
const claims = { sub: U };

const version = async (id: string) => {
  const [row] = await dbAdmin.execute<{ v: string }>(
    sql`select updated_at::text as v from public.contacts where id = ${id}`,
  );
  return row.v;
};
const stored = async (id: string) => (await dbAdmin.select().from(contacts).where(eq(contacts.id, id)))[0];

const merge = async () =>
  mergeDuplicateAs(claims, {
    keepId: KEEP,
    removeId: REMOVE,
    keepVersion: await version(KEEP),
    removeVersion: await version(REMOVE),
  });

describe("mergeDuplicateAs", () => {
  beforeEach(async () => {
    vi.mocked(requireUser).mockResolvedValue(claims);
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'dd-merge@test.dev') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'dd-merge')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, partner_name, email, address_line1, city, notes) values
        (${KEEP}, ${B}, 'Theo Marsh', 'Nina Marsh', 'theo@dd.test', '1 Elm St', 'Portland', null),
        (${REMOVE}, ${B}, 'Nina Marsh', 'Theo Marsh', 'nina@dd.test', null, null, 'Allergic to cats')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("fills the kept contact and deletes the other in one step", async () => {
    await expect(merge()).resolves.toEqual({ ok: true });
    const kept = await stored(KEEP);
    expect(kept).toMatchObject({
      email: "theo@dd.test",
      partnerEmail: "nina@dd.test",
      notes: "Allergic to cats",
      addressLine1: "1 Elm St",
    });
    await expect(stored(REMOVE)).resolves.toBeUndefined();
  });

  it("frees the deleted contact's email before the kept contact takes it", async () => {
    await dbAdmin.execute(sql`update public.contacts set email = null where id = ${KEEP}`);
    await dbAdmin.execute(sql`update public.contacts set partner_name = null, full_name = 'Theo Marsh' where id = ${REMOVE}`);
    await expect(merge()).resolves.toEqual({ ok: true });
    await expect(stored(KEEP)).resolves.toMatchObject({ email: "nina@dd.test" });
  });

  it("keeps a copy of the deleted contact on the kept contact's history", async () => {
    await merge();
    const [event] = await dbAdmin.select().from(contactEvents).where(eq(contactEvents.contactId, KEEP));
    expect(event).toMatchObject({
      source: "owner",
      diff: { merged_from: { full_name: "Nina Marsh", email: "nina@dd.test" } },
    });
  });

  it("refuses when either contact changed after the page loaded", async () => {
    const stale = await version(REMOVE);
    await dbAdmin.execute(sql`update public.contacts set city = 'Bend' where id = ${REMOVE}`);
    await expect(
      mergeDuplicateAs(claims, {
        keepId: KEEP,
        removeId: REMOVE,
        keepVersion: await version(KEEP),
        removeVersion: stale,
      }),
    ).resolves.toEqual({ ok: false, error: expect.stringContaining("changed") });
    await expect(stored(REMOVE)).resolves.toBeDefined();
  });

  it("refuses to delete a contact with a reply still waiting for review", async () => {
    await dbAdmin.execute(sql`
      insert into public.submissions (book_id, payload, matched_contact_id, source, recipient, saved_by)
      values (${B}, '{"city":"Bend"}'::jsonb, ${REMOVE}, 'token', 'primary', 'partner')`);
    await expect(merge()).resolves.toEqual({ ok: false, error: expect.stringContaining("reply") });
    await expect(stored(REMOVE)).resolves.toBeDefined();
  });

  it("refuses a pair someone already marked as not duplicates", async () => {
    await dbAdmin.execute(sql`
      insert into public.contact_duplicate_dismissals (book_id, contact_a, contact_b)
      values (${B}, ${KEEP}, ${REMOVE})`);
    await expect(merge()).resolves.toEqual({ ok: false, error: expect.stringContaining("not duplicates") });
    await expect(stored(REMOVE)).resolves.toBeDefined();
  });

  it("rolls the delete back if the history record cannot be written", async () => {
    await dbAdmin.execute(sql`
      create or replace function public.dd_refuse_event() returns trigger language plpgsql as $f$
      begin raise exception 'no history'; end $f$`);
    await dbAdmin.execute(sql`
      create trigger dd_refuse_event before insert on public.contact_events
      for each row when (new.contact_id = ${sql.raw(`'${KEEP}'::uuid`)}) execute function public.dd_refuse_event()`);
    try {
      await expect(merge()).resolves.toMatchObject({ ok: false });
      await expect(stored(REMOVE)).resolves.toBeDefined();
    } finally {
      await dbAdmin.execute(sql`drop trigger dd_refuse_event on public.contact_events`);
      await dbAdmin.execute(sql`drop function public.dd_refuse_event()`);
    }
  });

  it("lets only one of two concurrent merges through", async () => {
    const [keepVersion, removeVersion] = [await version(KEEP), await version(REMOVE)];
    const input = { keepId: KEEP, removeId: REMOVE, keepVersion, removeVersion };
    const reversed = { keepId: REMOVE, removeId: KEEP, keepVersion: removeVersion, removeVersion: keepVersion };
    const results = await Promise.all([mergeDuplicateAs(claims, input), mergeDuplicateAs(claims, reversed)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const left = await dbAdmin.select({ id: contacts.id }).from(contacts).where(eq(contacts.bookId, B));
    expect(left).toHaveLength(1);
  });

  it("refuses a contact from another book", async () => {
    await expect(
      mergeDuplicateAs({ sub: "00000000-0000-4000-8000-0000000dd2ff" }, {
        keepId: KEEP,
        removeId: REMOVE,
        keepVersion: await version(KEEP),
        removeVersion: await version(REMOVE),
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(stored(REMOVE)).resolves.toBeDefined();
  });
});

describe("duplicate actions", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it("rejects a malformed id before touching the database", async () => {
    await expect(keepDuplicate({}, form({ keep_id: "x", remove_id: REMOVE }))).resolves.toMatchObject({
      error: expect.any(String),
    });
    await expect(dismissDuplicate({}, form({ first_id: "x", second_id: REMOVE }))).resolves.toMatchObject({
      error: expect.any(String),
    });
  });
});
