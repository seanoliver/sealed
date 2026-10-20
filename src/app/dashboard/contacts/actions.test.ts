import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import { SAME_PARTNER_EMAIL } from "@/lib/validation/contact";
import { createContact, patchContact, updateContact } from "./actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const U = "00000000-0000-4000-8000-0000000c5001";
const B = "10000000-0000-4000-8000-0000000c5001";
const C = "20000000-0000-4000-8000-0000000c5001";

const stored = async () =>
  (await dbAdmin.select().from(contacts).where(eq(contacts.id, C)))[0];

function editForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    id: C,
    first_name: "Ana",
    last_name: "Reyes",
    email: "ana@ce.test",
    ...fields,
  })) {
    form.set(key, value);
  }
  return form;
}

describe("owner edits of the partner's email", () => {
  beforeEach(async () => {
    vi.mocked(requireUser).mockResolvedValue({ sub: U });
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'ce-owner@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'ce-test-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, first_name, last_name, email, partner_email)
      values (${C}, ${B}, 'Ana Reyes', 'Ana', 'Reyes', 'ana@ce.test', 'mark@ce.test')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("patches the partner's email", async () => {
    await expect(
      patchContact(C, { values: { partner_email: "mark@new.test" } }),
    ).resolves.toEqual({});
    expect((await stored()).partnerEmail).toBe("mark@new.test");
  });

  it("refuses a partner email that repeats the email, ignoring case", async () => {
    await expect(
      patchContact(C, { values: { partner_email: "ANA@ce.test" } }),
    ).resolves.toEqual({ error: SAME_PARTNER_EMAIL });
    await expect(
      patchContact(C, { values: { email: "MARK@ce.test" } }),
    ).resolves.toEqual({ error: SAME_PARTNER_EMAIL });
    expect(await stored()).toMatchObject({ email: "ana@ce.test", partnerEmail: "mark@ce.test" });
  });

  it("validates the partner's email like the email", async () => {
    await expect(
      patchContact(C, { values: { partner_email: "not-an-email" } }),
    ).resolves.toHaveProperty("error");
  });

  it("keeps the stored partner email when the edit form doesn't post one", async () => {
    await expect(updateContact({}, editForm({ city: "Oslo" }))).resolves.toMatchObject({
      saved: true,
    });
    expect(await stored()).toMatchObject({ city: "Oslo", partnerEmail: "mark@ce.test" });
  });

  it("saves or clears the partner email when the form posts one", async () => {
    await updateContact({}, editForm({ partner_email: "mark@new.test" }));
    expect((await stored()).partnerEmail).toBe("mark@new.test");
    await updateContact({}, editForm({ partner_email: "" }));
    expect((await stored()).partnerEmail).toBeNull();
  });

  it("refuses a posted partner email that repeats the email, on that field", async () => {
    const state = await updateContact({}, editForm({ partner_email: "Ana@ce.test" }));
    expect(state).toMatchObject({ fieldErrors: { partner_email: SAME_PARTNER_EMAIL } });
    expect(state.error).toBeUndefined();
    expect((await stored()).partnerEmail).toBe("mark@ce.test");
  });

  it("shows an invalid partner email on that field", async () => {
    await expect(
      updateContact({}, editForm({ partner_email: "not-an-email" })),
    ).resolves.toMatchObject({ fieldErrors: { partner_email: "Invalid email address" } });
  });

  it("saves the partner email on a new contact", async () => {
    const form = editForm({ email: "bo@ce.test", partner_email: "cy@ce.test" });
    form.delete("id");
    form.set("first_name", "Bo");
    await createContact({}, form);
    const [row] = await dbAdmin
      .select({ partnerEmail: contacts.partnerEmail })
      .from(contacts)
      .where(eq(contacts.email, "bo@ce.test"));
    expect(row?.partnerEmail).toBe("cy@ce.test");
  });

  it("refuses a new contact whose partner email repeats the email, on that field", async () => {
    const form = editForm({ email: "di@ce.test", partner_email: "DI@ce.test" });
    form.delete("id");
    await expect(createContact({}, form)).resolves.toMatchObject({
      fieldErrors: { partner_email: SAME_PARTNER_EMAIL },
    });
  });
});

describe("owner readings for names in Chinese characters", () => {
  // Posts the stored household unchanged, so the form takes the untouched-names branch.
  const readingForm = (fields: Record<string, string>) =>
    editForm({
      first_name: "雨桐",
      last_name: "曾",
      partner_section: "1",
      partner_first_name: "伟",
      partner_last_name: "张",
      ...fields,
    });
  const namesBase = async () => {
    const before = await stored();
    return {
      fullName: before.fullName,
      partnerName: before.partnerName,
      kidsNames: before.kidsNames,
      firstName: before.firstName,
      lastName: before.lastName,
      partnerFirstName: before.partnerFirstName,
      partnerLastName: before.partnerLastName,
      kids: before.kids,
    };
  };

  beforeEach(async () => {
    vi.mocked(requireUser).mockResolvedValue({ sub: U });
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'ce-owner@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'ce-test-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts
        (id, book_id, full_name, first_name, last_name, partner_name, partner_first_name,
         partner_last_name, email, name_reading, partner_name_reading)
      values (${C}, ${B}, '雨桐 曾', '雨桐', '曾', '伟 张', '伟', '张', 'ana@ce.test',
              'Yǔtóng Céng', 'Wěi Zhāng')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("saves, trims and clears a reading from the edit form", async () => {
    await expect(
      updateContact({}, readingForm({ name_reading: "  Yǔtóng Zēng " })),
    ).resolves.toMatchObject({ saved: true });
    expect((await stored()).nameReading).toBe("Yǔtóng Zēng");
    await updateContact({}, readingForm({ name_reading: "" }));
    expect((await stored()).nameReading).toBeNull();
  });

  it("keeps stored readings the form doesn't post", async () => {
    await updateContact({}, readingForm({ city: "Oslo" }));
    expect(await stored()).toMatchObject({
      nameReading: "Yǔtóng Céng",
      partnerNameReading: "Wěi Zhāng",
    });
  });

  it("caps the name reading's length on its field without saving", async () => {
    await expect(
      updateContact({}, readingForm({ name_reading: "a".repeat(201) })),
    ).resolves.toMatchObject({
      fieldErrors: { name_reading: "Keep the reading under 201 characters." },
    });
    expect((await stored()).nameReading).toBe("Yǔtóng Céng");
  });

  it("keeps a new reading the owner writes while renaming", async () => {
    await updateContact({}, readingForm({ first_name: "雨彤", name_reading: "Yǔtóng Zēng" }));
    expect(await stored()).toMatchObject({ fullName: "雨彤 曾", nameReading: "Yǔtóng Zēng" });
  });

  it("drops the old reading when the owner renames without touching it", async () => {
    await updateContact({}, readingForm({ first_name: "雨彤" }));
    expect(await stored()).toMatchObject({
      fullName: "雨彤 曾",
      nameReading: null,
      partnerNameReading: "Wěi Zhāng",
    });
  });

  it("drops the partner's reading when the form removes the partner", async () => {
    const form = readingForm({});
    form.delete("partner_first_name");
    form.delete("partner_last_name");
    await expect(updateContact({}, form)).resolves.toMatchObject({ saved: true });
    expect(await stored()).toMatchObject({
      partnerName: null,
      nameReading: "Yǔtóng Céng",
      partnerNameReading: null,
    });
  });

  it("records reading changes in the contact's history", async () => {
    await updateContact({}, readingForm({ name_reading: "Yǔtóng Zēng" }));
    const rows = await dbAdmin.execute(sql`
      select diff from public.contact_events
      where contact_id = ${C} and source = 'owner' order by created_at desc limit 1`);
    expect(rows[0]?.diff).toEqual({
      before: { name_reading: "Yǔtóng Céng" },
      after: { name_reading: "Yǔtóng Zēng" },
    });
  });

  it("caps a reading's length on its field", async () => {
    await expect(
      updateContact({}, readingForm({ partner_name_reading: "a".repeat(201) })),
    ).resolves.toMatchObject({
      fieldErrors: { partner_name_reading: "Keep the reading under 201 characters." },
    });
    expect((await stored()).partnerNameReading).toBe("Wěi Zhāng");
  });

  it("saves a reading on a new contact", async () => {
    const form = readingForm({ email: "zy@ce.test", name_reading: "Zēng Yǔtóng" });
    form.delete("id");
    await createContact({}, form);
    const [row] = await dbAdmin
      .select({ nameReading: contacts.nameReading })
      .from(contacts)
      .where(eq(contacts.email, "zy@ce.test"));
    expect(row?.nameReading).toBe("Zēng Yǔtóng");
  });

  it("drops only the partner's reading when the sheet renames the partner", async () => {
    await expect(
      patchContact(C, {
        household: { first_name: "雨桐", last_name: "曾", partner_first_name: "威", partner_last_name: "张" },
        namesBase: await namesBase(),
      }),
    ).resolves.toEqual({});
    expect(await stored()).toMatchObject({
      partnerName: "威 张",
      nameReading: "Yǔtóng Céng",
      partnerNameReading: null,
    });
  });

  it("drops a reading when the sheet renames that person", async () => {
    const before = await stored();
    await expect(
      patchContact(C, {
        household: { first_name: "芳", last_name: "王", partner_first_name: "伟", partner_last_name: "张" },
        namesBase: {
          fullName: before.fullName,
          partnerName: before.partnerName,
          kidsNames: before.kidsNames,
          firstName: before.firstName,
          lastName: before.lastName,
          partnerFirstName: before.partnerFirstName,
          partnerLastName: before.partnerLastName,
          kids: before.kids,
        },
      }),
    ).resolves.toEqual({});
    expect(await stored()).toMatchObject({
      fullName: "芳 王",
      nameReading: null,
      partnerNameReading: "Wěi Zhāng",
    });
  });
});
