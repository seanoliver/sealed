import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { listPendingReplies } from "./submissions";

const U = "00000000-0000-4000-8000-0000000c9101";
const B = "10000000-0000-4000-8000-0000000c9101";
const COUPLE = "20000000-0000-4000-8000-0000000c9101";
const SOLO = "20000000-0000-4000-8000-0000000c9102";
const OLDER = "30000000-0000-4000-8000-0000000c9101";
const NEWER = "30000000-0000-4000-8000-0000000c9102";

async function submit(id: string, contactId: string | null, status: string, minutesAgo: number) {
  await dbAdmin.execute(sql`
    insert into public.submissions (id, book_id, payload, matched_contact_id, status, created_at)
    values (${id}, ${B}, '{"city":"Tacoma"}', ${contactId}, ${status},
            now() - make_interval(mins => ${minutesAgo}))`);
}

describe("listPendingReplies", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'pr-owner@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'pr-test-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email, partner_email) values
        (${COUPLE}, ${B}, 'Satya Rao', 'satya@pr.test', 'mei@pr.test'),
        (${SOLO}, ${B}, 'Ada Solo', 'ada@pr.test', null)`);
    await dbAdmin.execute(sql`
      insert into public.contact_events (contact_id, source, recipient, diff, created_at) values
        (${COUPLE}, 'token', 'partner', '{}', now() - interval '20 min'),
        (${COUPLE}, 'token', 'primary', '{}', now() - interval '10 min'),
        (${COUPLE}, 'owner', null, '{}', now() - interval '5 min')`);
    await submit(NEWER, COUPLE, "pending", 1);
    await submit(OLDER, COUPLE, "pending", 2);
    await submit("30000000-0000-4000-8000-0000000c9103", SOLO, "rejected", 1);
    await submit("30000000-0000-4000-8000-0000000c9104", null, "pending", 1);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("returns the oldest pending matched reply per contact and who saved last", async () => {
    expect(await listPendingReplies({ sub: U })).toEqual([
      { id: OLDER, contactId: COUPLE, payload: { city: "Tacoma" }, savedBy: "primary" },
    ]);
  });
});
