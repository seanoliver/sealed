import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { contactsToCsv } from "@/lib/csv/export";
import { listCsvRows } from "./export";

const U = "00000000-0000-4000-8000-0000000ef001";
const B = "10000000-0000-4000-8000-0000000ef001";

describe("listCsvRows", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'ex-owner@ex.test') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'ex-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email) values
        ('20000000-0000-4000-8000-0000000ef004', ${B}, 'Zed Ward', 'zed@ex.test'),
        ('20000000-0000-4000-8000-0000000ef003', ${B}, 'Amy Fox', 'amy3@ex.test'),
        ('20000000-0000-4000-8000-0000000ef005', ${B}, 'Bob Lee', 'bob@ex.test'),
        ('20000000-0000-4000-8000-0000000ef001', ${B}, 'Amy Fox', 'amy1@ex.test')`);
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

describe("CSV export of names in Chinese characters", () => {
  const HU = "00000000-0000-4000-8000-0000000ef101";
  const HB = "10000000-0000-4000-8000-0000000ef101";

  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${HB}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${HU}, 'ex-han@ex.test') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${HB}, ${HU}, 'ex-han-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (book_id, full_name, partner_name, email) values
        (${HB}, '张伟', '李娜', 'wei@ex.test')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${HB}`);
    await dbAdmin.execute(sql`delete from auth.users where id = ${HU}`);
  });

  it("exports the characters with no pinyin columns or readings", async () => {
    const csv = contactsToCsv(await listCsvRows({ sub: HU }));
    const [header] = csv.split(/\r?\n/);
    expect(header).not.toMatch(/reading|pinyin/i);
    expect(csv).toContain("张伟");
    expect(csv).not.toMatch(/zh[aā]ng|\bw[eě]i,|\bl[iǐ]\b|\bn[aà]\b/i);
  });
});

describe("CSV export of countries and envelopes", () => {
  const CU = "00000000-0000-4000-8000-0000000ef201";
  const CB = "10000000-0000-4000-8000-0000000ef201";

  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${CB}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${CU}, 'ex-env@ex.test') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug, sender_country) values (${CB}, ${CU}, 'ex-env-book', 'US')`);
    await dbAdmin.execute(sql`
      insert into public.contacts
        (book_id, full_name, first_name, last_name, address_line1, address_line2, city, postal_code, country_code, country)
      values
        (${CB}, 'Priya Raman', 'Priya', 'Raman', '14 Kestrel Lane', 'Flat 2', 'Bristol', 'BS6 5QT', 'GB', null),
        (${CB}, 'Nemo Diver', 'Nemo', 'Diver', '1 Coral Way', null, null, null, null, 'Atlantis')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${CB}`);
    await dbAdmin.execute(sql`delete from auth.users where id = ${CU}`);
  });

  it("exports the code, the English name and the printed envelope", async () => {
    const rows = await listCsvRows({ sub: CU });
    expect(rows.map(({ full_name, country_code, country, envelope }) => ({ full_name, country_code, country, envelope }))).toEqual([
      { full_name: "Nemo Diver", country_code: null, country: "Atlantis", envelope: "Nemo Diver\n1 Coral Way\nATLANTIS" },
      {
        full_name: "Priya Raman",
        country_code: "GB",
        country: "United Kingdom",
        envelope: "Priya Raman\nFlat 2, 14 Kestrel Lane\nBRISTOL\nBS6 5QT\nUNITED KINGDOM",
      },
    ]);
  });
});
