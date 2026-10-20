import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { listContacts } from "./contacts";

const U = "00000000-0000-4000-8000-0000000c9001";
const B = "10000000-0000-4000-8000-0000000c9001";
const SOLO = "20000000-0000-4000-8000-0000000c9001";
const COUPLE = "20000000-0000-4000-8000-0000000c9002";
const HALF_FAILED = "20000000-0000-4000-8000-0000000c9003";

async function send(contactId: string, recipient: string, status: string, minutesAgo: number) {
  await dbAdmin.execute(sql`
    insert into public.email_sends (contact_id, book_id, recipient, status, failure_reason, sent_at)
    values (${contactId}, ${B}, ${recipient}, ${status},
            ${status === "failed" ? "rejected" : null},
            now() - make_interval(mins => ${minutesAgo}))`);
}

describe("listContacts", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'lc-owner@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'lc-test-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email, partner_email) values
        (${SOLO}, ${B}, 'A Solo', 'solo@lc.test', null),
        (${COUPLE}, ${B}, 'B Couple', 'b1@lc.test', 'b2@lc.test'),
        (${HALF_FAILED}, ${B}, 'C Half', 'c1@lc.test', 'c2@lc.test')`);
    await send(SOLO, "primary", "sent", 30);
    await send(SOLO, "primary", "failed", 10);
    await send(COUPLE, "primary", "delivered", 10);
    await send(COUPLE, "partner", "opened", 10);
    await send(HALF_FAILED, "primary", "opened", 10);
    await send(HALF_FAILED, "partner", "failed", 5);
    await dbAdmin.execute(sql`
      insert into public.contact_events (contact_id, source, recipient, diff, created_at)
      values (${COUPLE}, 'token', 'partner', '{}', now() - interval '5 min')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("returns the partner email and each person's latest send", async () => {
    const [solo, couple, half] = await listContacts({ sub: U });

    expect(solo).toMatchObject({
      partnerEmail: null,
      sendStatus: "failed",
      sendFailureReason: "rejected",
      needsAttention: true,
      sendStatuses: {
        primary: { status: "failed", failureReason: "rejected" },
        partner: { status: "none", failureReason: null },
      },
    });

    expect(couple).toMatchObject({
      partnerEmail: "b2@lc.test",
      sendStatus: "opened",
      needsAttention: false,
      sendStatuses: {
        primary: { status: "delivered" },
        partner: { status: "opened" },
      },
      updatedAfterSend: true,
    });

    expect(half).toMatchObject({
      sendStatus: "opened",
      sendFailureReason: null,
      needsAttention: true,
      sendStatuses: {
        primary: { status: "opened" },
        partner: { status: "failed", failureReason: "rejected" },
      },
      updatedAfterSend: false,
    });
  });
});

describe("listContacts pinyin search", () => {
  const PU = "00000000-0000-4000-8000-0000000c9101";
  const PB = "10000000-0000-4000-8000-0000000c9101";

  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${PB}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${PU}, 'lc-pinyin@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${PB}, ${PU}, 'lc-pinyin-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (book_id, full_name, partner_name) values
        (${PB}, '张伟', '李娜'),
        (${PB}, '曾雨桐', null),
        (${PB}, 'Zhang Ada', null),
        (${PB}, 'Tom Reyes', '单丽')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${PB}`);
  });

  const names = async (query: string) =>
    (await listContacts({ sub: PU }, query)).map((row) => row.fullName).sort();

  it("finds names in Chinese characters by pinyin, with or without tones", async () => {
    expect(await names("zhang wei")).toEqual(["张伟"]);
    expect(await names("zhāng")).toEqual(["张伟"]);
    expect(await names("zhang")).toEqual(["Zhang Ada", "张伟"].sort());
    expect(await names("li na")).toEqual(["张伟"]);
    expect(await names("shan li")).toEqual(["Tom Reyes"]);
  });

  it("reads surnames in surname mode and matches either name order", async () => {
    expect(await names("zeng")).toEqual(["曾雨桐"]);
    expect(await names("ceng")).toEqual([]);
    expect(await names("wei zhang")).toEqual(["张伟"]);
    expect(await names("yutong zeng")).toEqual(["曾雨桐"]);
  });

  it("keeps plain substring search", async () => {
    expect(await names("张")).toEqual(["张伟"]);
    expect(await names("reyes")).toEqual(["Tom Reyes"]);
  });
});
