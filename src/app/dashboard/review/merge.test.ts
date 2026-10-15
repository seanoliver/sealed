import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import {
  dropDisabledFields,
  parseSubmissionPayload,
} from "@/lib/validation/submission";
import { changedFields, mergeUpdate, rowToSnapshot, toInsertRow } from "./merge";

const U = "00000000-0000-0000-0000-00000000d001";
const B = "10000000-0000-0000-0000-00000000d001";
const C_LEGACY = "20000000-0000-0000-0000-00000000d001";
const C_SPLIT = "20000000-0000-0000-0000-00000000d002";

const ALL_ENABLED = { partner_name: true, kids_names: true, birthday: true };

function gate(payload: unknown, enabled = ALL_ENABLED) {
  const parsed = parseSubmissionPayload(payload);
  if (!parsed.success) throw new Error("payload did not parse");
  return dropDisabledFields(parsed.data, enabled);
}

async function load(id: string) {
  const [row] = await dbAdmin.select().from(contacts).where(eq(contacts.id, id));
  return row;
}

async function merge(id: string, payload: unknown, enabled = ALL_ENABLED) {
  const before = rowToSnapshot(await load(id));
  const set = mergeUpdate(before, gate(payload, enabled));
  if (!set) return { set, row: await load(id), diff: undefined };
  const [row] = await dbAdmin
    .update(contacts)
    .set(set)
    .where(eq(contacts.id, id))
    .returning();
  return { set, row, diff: changedFields(before, rowToSnapshot(row)) };
}

describe("approving a household submission", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'mergetest@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug)
      values (${B}, ${U}, 'merge-test-book')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`delete from auth.users where id = ${U}`);
  });

  it("splits a legacy contact's names on merge and audits the derived strings", async () => {
    await dbAdmin.insert(contacts).values({
      id: C_LEGACY,
      bookId: B,
      fullName: "Ada Lovelace",
      partnerName: "William",
      kidsNames: "Byron, Annabella",
      city: "London",
    });

    const { row, diff } = await merge(C_LEGACY, {
      first_name: "Ada",
      last_name: "King",
      partner_first_name: "William",
      kids: [{ first: "Byron", last: "King" }, { first: "Ralph", last: "Milbanke" }],
      city: "Ockham",
    });

    expect(row).toMatchObject({
      firstName: "Ada",
      lastName: "King",
      fullName: "Ada King",
      partnerFirstName: "William",
      partnerLastName: null,
      partnerName: "William",
      kidsNames: "Byron, Ralph Milbanke",
      city: "Ockham",
    });
    expect(diff?.after).toMatchObject({
      full_name: "Ada King",
      kids_names: "Byron, Ralph Milbanke",
      last_name: "King",
    });
    expect(diff?.after).not.toHaveProperty("partner_name");
  });

  it("clears a stored partner last name when the submitted partner has none", async () => {
    await dbAdmin.insert(contacts).values({
      id: C_SPLIT,
      bookId: B,
      fullName: "placeholder",
      firstName: "Jen",
      lastName: "Holloway",
      partnerFirstName: "Mark",
      partnerLastName: "Okafor",
      kids: [{ first: "Zoe", last: "Holloway" }],
    });

    const { row } = await merge(C_SPLIT, {
      first_name: "Jen",
      last_name: "Holloway",
      partner_first_name: "Mark",
    });

    expect(row).toMatchObject({
      partnerLastName: null,
      partnerName: "Mark",
      kids: [{ first: "Zoe", last: "Holloway" }],
      kidsNames: "Zoe",
    });
  });

  it("writes nothing when the submission matches the stored names", async () => {
    const { set } = await merge(C_SPLIT, {
      first_name: "Jen",
      last_name: "Holloway",
      kids: [{ last: "Holloway", first: "Zoe" }],
    });
    expect(set).toBeUndefined();
  });

  it("drops a smuggled partner and kids on a book that disables them", async () => {
    const { row } = await merge(
      C_SPLIT,
      {
        first_name: "Jen",
        last_name: "Holloway",
        partner_first_name: "Eve",
        kids: [{ first: "Mallory" }],
      },
      { partner_name: false, kids_names: false, birthday: true },
    );
    expect(row).toMatchObject({ partnerFirstName: "Mark", kidsNames: "Zoe" });
  });

  it("builds a new contact whose display strings the trigger derives", async () => {
    const [row] = await dbAdmin
      .insert(contacts)
      .values({
        bookId: B,
        ...toInsertRow(
          gate({
            first_name: "Priya",
            last_name: "Raman",
            partner_first_name: "Daniel",
            partner_last_name: "Okafor",
            kids: [{ first: "Asha", last: "Raman" }],
          }),
        ),
      })
      .returning();
    expect(row).toMatchObject({
      fullName: "Priya Raman",
      partnerName: "Daniel Okafor",
      kidsNames: "Asha",
    });
  });
});
