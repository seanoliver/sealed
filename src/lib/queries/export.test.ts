import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { listCsvRows } from "./export";

const U = "00000000-0000-4000-8000-0000000ae001";
const B = "10000000-0000-4000-8000-0000000ae001";

describe("listCsvRows", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'ex-owner@ex.test') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'ex-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email) values
        ('20000000-0000-4000-8000-0000000ae004', ${B}, 'Zed Ward', 'zed@ex.test'),
        ('20000000-0000-4000-8000-0000000ae003', ${B}, 'Amy Fox', 'amy3@ex.test'),
        ('20000000-0000-4000-8000-0000000ae005', ${B}, 'Bob Lee', 'bob@ex.test'),
        ('20000000-0000-4000-8000-0000000ae001', ${B}, 'Amy Fox', 'amy1@ex.test')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`delete from auth.users where id = ${U}`);
  });

  it("orders by name, then id for same-name ties", async () => {
    const rows = await listCsvRows({ sub: U });
    expect(rows.map((row) => row.email)).toEqual([
      "amy1@ex.test",
      "amy3@ex.test",
      "bob@ex.test",
      "zed@ex.test",
    ]);
  });
});
