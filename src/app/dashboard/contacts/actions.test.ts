import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import { SAME_PARTNER_EMAIL } from "@/lib/validation/contact";
import { patchContact, updateContact } from "./actions";

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

  it("refuses a posted partner email that repeats the email", async () => {
    await expect(
      updateContact({}, editForm({ partner_email: "Ana@ce.test" })),
    ).resolves.toMatchObject({ error: SAME_PARTNER_EMAIL });
  });
});
