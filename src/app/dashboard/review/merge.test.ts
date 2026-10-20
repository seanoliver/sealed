import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withRls } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import {
  clearedFields,
  parsePartnerEmail,
  parseSubmissionPayload,
  withoutBlanks,
} from "@/lib/validation/submission";
import { changedFields, mergeUpdate, rowToSnapshot, toInsertRow } from "./merge";

const U = "00000000-0000-0000-0000-00000000d001";
const B = "10000000-0000-0000-0000-00000000d001";
const C_LEGACY = "20000000-0000-0000-0000-00000000d001";
const C_SPLIT = "20000000-0000-0000-0000-00000000d002";
const C_COUPLE = "20000000-0000-0000-0000-00000000d003";
const C_CLEAR = "20000000-0000-0000-0000-00000000d004";

const ALL_ENABLED = { partner_name: true, kids_names: true, birthday: true };

function gate(payload: unknown, enabled = ALL_ENABLED) {
  const parsed = parseSubmissionPayload(payload, enabled);
  if (!parsed.success) throw new Error("payload did not parse");
  return parsed.data;
}

async function load(id: string) {
  const [row] = await dbAdmin.select().from(contacts).where(eq(contacts.id, id));
  return row;
}

async function merge(
  id: string,
  payload: unknown,
  enabled = ALL_ENABLED,
  { token = false }: { token?: boolean } = {},
) {
  const before = rowToSnapshot(await load(id));
  const parsable = token ? withoutBlanks(payload) : payload;
  const partnerEmail = parsePartnerEmail(parsable);
  if (!partnerEmail.success) throw new Error("partner email did not parse");
  const set = mergeUpdate(before, gate(parsable, enabled), {
    partnerEmail: partnerEmail.data,
    clear: token ? clearedFields(payload, enabled) : [],
  });
  if (!set) return { set, row: await load(id), diff: undefined };
  const [row] = await withRls({ sub: U }, (tx) =>
    tx.update(contacts).set(set).where(eq(contacts.id, id)).returning(),
  );
  return { set, row, diff: changedFields(before, rowToSnapshot(row)) };
}

describe("country text on approval", () => {
  const blank = rowToSnapshot({
    fullName: "X", partnerName: null, kidsNames: null, email: null, partnerEmail: null, birthday: null,
    addressLine1: null, addressLine2: null, district: null, city: null, stateRegion: null, postalCode: null,
    countryCode: "US", legacyCountry: "USA", firstName: null, lastName: null, partnerFirstName: null,
    partnerLastName: null, kids: null,
  } as Parameters<typeof rowToSnapshot>[0]);

  it("clears old country text when a reply sets or clears the code", () => {
    expect(mergeUpdate(blank, gate({ full_name: "X", country_code: "GB" }))).toMatchObject({
      countryCode: "GB",
      legacyCountry: null,
    });
    expect(mergeUpdate(blank, gate({ full_name: "X" }), { clear: ["country_code"] })).toMatchObject({
      countryCode: null,
      legacyCountry: null,
    });
  });

  it("keeps a pre-deploy reply's unmatched country text", () => {
    expect(mergeUpdate(blank, gate({ full_name: "X", country: "Atlantis" }))).toMatchObject({
      countryCode: null,
      legacyCountry: "Atlantis",
    });
    expect(toInsertRow(gate({ full_name: "X", country: "Atlantis" }))).toMatchObject({
      countryCode: null,
      legacyCountry: "Atlantis",
    });
  });
});

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
    const values = toInsertRow(
      gate({
        first_name: "Priya",
        last_name: "Raman",
        partner_first_name: "Daniel",
        partner_last_name: "Okafor",
        kids: [{ first: "Asha", last: "Raman" }],
      }),
    );
    const [row] = await withRls({ sub: U }, (tx) =>
      tx.insert(contacts).values({ bookId: B, ...values }).returning(),
    );
    expect(row).toMatchObject({
      fullName: "Priya Raman",
      partnerName: "Daniel Okafor",
      kidsNames: "Asha",
    });
  });

  describe("a partner's reply from the review queue", () => {
    beforeAll(async () => {
      await dbAdmin.insert(contacts).values({
        id: C_COUPLE,
        bookId: B,
        fullName: "placeholder",
        firstName: "Satya",
        lastName: "Rao",
        partnerFirstName: "Mei",
        email: "satya@rao.test",
        partnerEmail: "mei@rao.test",
        addressLine1: "4410 Fremont Ave N",
        city: "Seattle",
      });
    });

    it("applies the address and the partner's own email", async () => {
      const { row, diff } = await merge(C_COUPLE, {
        first_name: "Satya",
        last_name: "Rao",
        partner_first_name: "Mei",
        partner_email: "mei@new.test",
        address_line1: "4410 Fremont Ave N",
        address_line2: "Apt 2",
        city: "Seattle",
      });
      expect(row).toMatchObject({
        email: "satya@rao.test",
        partnerEmail: "mei@new.test",
        addressLine2: "Apt 2",
      });
      expect(diff?.after).toMatchObject({
        partner_email: "mei@new.test",
        address_line2: "Apt 2",
      });
    });

    it("ignores an email that repeats the other person's address", async () => {
      const { set, row } = await merge(C_COUPLE, {
        first_name: "Satya",
        last_name: "Rao",
        partner_first_name: "Mei",
        email: "MEI@new.test",
        partner_email: "satya@rao.test",
        city: "Tacoma",
      });
      expect(set).toEqual({ city: "Tacoma" });
      expect(row).toMatchObject({ email: "satya@rao.test", partnerEmail: "mei@new.test" });
    });

    it("refuses a malformed partner email", () => {
      expect(parsePartnerEmail({ partner_email: "not an email" })).toEqual({ success: false });
      expect(parsePartnerEmail({ city: "Seattle" })).toEqual({ success: true, data: undefined });
    });
  });

  describe("a token reply that empties fields", () => {
    const emptied = {
      first_name: "Jen",
      last_name: "Holloway",
      partner_first_name: "",
      partner_last_name: "",
      kids: [],
      email: "",
      address_line1: "2140 NE Alberta St",
      address_line2: "",
      city: "Portland",
    };

    beforeAll(async () => {
      await dbAdmin.insert(contacts).values({
        id: C_CLEAR,
        bookId: B,
        fullName: "placeholder",
        firstName: "Jen",
        lastName: "Holloway",
        partnerFirstName: "Mark",
        kids: [{ first: "Zoe", last: "Holloway" }],
        email: "jen@clear.test",
        addressLine1: "2140 NE Alberta St",
        addressLine2: "Apt 4",
        city: "Portland",
      });
    });

    it("clears nothing for the same values from the public link", async () => {
      const { set } = await merge(C_CLEAR, withoutBlanks(emptied));
      expect(set).toBeUndefined();
    });

    it("clears the emptied address line, partner and kids, but never the email", async () => {
      const { row } = await merge(C_CLEAR, emptied, ALL_ENABLED, { token: true });
      expect(row).toMatchObject({
        email: "jen@clear.test",
        addressLine2: null,
        partnerFirstName: null,
        partnerName: null,
        kids: null,
        kidsNames: null,
      });
    });

    it("leaves a group the book does not collect", () => {
      expect(
        clearedFields(emptied, { partner_name: false, kids_names: false, birthday: false }),
      ).toEqual(["address_line2"]);
    });
  });
});
