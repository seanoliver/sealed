import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { readingsForContact } from "@/lib/pinyin";
import { listContacts } from "./contacts";

const { loaded } = vi.hoisted(() => ({ loaded: vi.fn() }));
vi.mock("pinyin-pro", async (importOriginal) => {
  loaded();
  return importOriginal();
});

const U = "00000000-0000-4000-8000-0000000c9201";
const B = "10000000-0000-4000-8000-0000000c9201";

describe("pinyin-pro loading", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'lc-lazy@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'lc-lazy-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (book_id, full_name, partner_name) values
        (${B}, 'Zhang Ada', 'Li Bea')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("never loads for a book without names in Chinese characters", async () => {
    const rows = await listContacts({ sub: U });
    expect(await listContacts({ sub: U }, "zhang")).toHaveLength(1);
    expect(await Promise.all(rows.map((row) => readingsForContact(row)))).toEqual([{}]);
    expect(loaded).not.toHaveBeenCalled();
  });

  it("loads once a name needs it", async () => {
    await dbAdmin.execute(sql`
      insert into public.contacts (book_id, full_name) values (${B}, '张伟')`);
    expect((await listContacts({ sub: U }, "zhang wei")).map((row) => row.fullName)).toEqual([
      "张伟",
    ]);
    expect(loaded).toHaveBeenCalled();
  });
});
