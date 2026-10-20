import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import { SAME_PARTNER_EMAIL } from "@/lib/validation/contact";
import { mintAgentToken } from "@/lib/agent/tokens";
import { createContact, patchContact, updateContact } from "./actions";
import { patchContactAs } from "./write";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const U = "00000000-0000-4000-8000-0000000c5001";
const B = "10000000-0000-4000-8000-0000000c5001";
const C = "20000000-0000-4000-8000-0000000c5001";

const stored = async () =>
  (await dbAdmin.select().from(contacts).where(eq(contacts.id, C)))[0];

const version = async () =>
  (
    await dbAdmin
      .select({ version: sql<string>`${contacts.updatedAt}::text` })
      .from(contacts)
      .where(eq(contacts.id, C))
  )[0].version;

async function editForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    id: C,
    version: await version(),
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
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id = ${U}`);
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

  it("refuses a form opened before an agent's edit, keeping the agent's value", async () => {
    const stale = await editForm({ city: "Oslo" });
    const { summary } = await mintAgentToken(U, { name: "ce agent", scopes: ["write"] });
    const agentEdit = await patchContactAs(
      { sub: U },
      C,
      { values: { city: "Bergen" } },
      { source: "agent", tokenId: summary.id },
    );
    expect(agentEdit.ok).toBe(true);
    await expect(updateContact({}, stale)).resolves.toMatchObject({
      error: "This contact changed since you opened it. Reload to see the latest.",
    });
    expect((await stored()).city).toBe("Bergen");
  });

  it("doesn't write a save that changes nothing on a contact whose country text became a code", async () => {
    await dbAdmin.execute(sql`update public.contacts set country = 'USA' where id = ${C}`);
    expect(await stored()).toMatchObject({ countryCode: "US", legacyCountry: null });
    const before = await version();
    const events = async () =>
      (await dbAdmin.execute(sql`select count(*)::int as n from public.contact_events where contact_id = ${C}`))[0].n;
    const eventsBefore = await events();
    await expect(updateContact({}, await editForm({ country_code: "US" }))).resolves.toMatchObject({ saved: true });
    expect(await version()).toBe(before);
    expect(await events()).toBe(eventsBefore);
  });

  it("doesn't write a save that changes nothing", async () => {
    const before = await version();
    await expect(updateContact({}, await editForm({}))).resolves.toMatchObject({ saved: true });
    expect(await version()).toBe(before);
  });

  it("clears old country text when the form clears the country, and keeps fields it doesn't post", async () => {
    await dbAdmin.execute(sql`
      update public.contacts set country = 'USA', country_code = 'US', state_region = 'Avon', city = 'Bath'
      where id = ${C}`);
    const form = await editForm({ country_code: "", city: "Bath" });
    expect(await updateContact({}, form)).toMatchObject({ saved: true });
    expect(await stored()).toMatchObject({ countryCode: null, legacyCountry: null, stateRegion: "Avon" });
  });

  it("keeps unrecognized country text while the country stays blank", async () => {
    await dbAdmin.execute(sql`update public.contacts set country = 'Atlantis', country_code = null where id = ${C}`);
    expect(await updateContact({}, await editForm({ country_code: "", city: "Port Royal" }))).toMatchObject({
      saved: true,
    });
    expect(await stored()).toMatchObject({ countryCode: null, legacyCountry: "Atlantis", city: "Port Royal" });
  });

  it("re-checks a stored postcode only once it changes, comparing it as saved", async () => {
    await dbAdmin.execute(sql`update public.contacts set postal_code = 'nope', country_code = 'GB' where id = ${C}`);
    expect(await updateContact({}, await editForm({ country_code: "GB", postal_code: "NOPE" }))).toMatchObject({
      saved: true,
    });
    expect(await updateContact({}, await editForm({ country_code: "GB", postal_code: "BS6" }))).toMatchObject({
      fieldErrors: { postal_code: "A UK postcode looks like EC1Y 8SY." },
    });
  });

  it("keeps the stored partner email when the edit form doesn't post one", async () => {
    await expect(updateContact({}, await editForm({ city: "Oslo" }))).resolves.toMatchObject({
      saved: true,
    });
    expect(await stored()).toMatchObject({ city: "Oslo", partnerEmail: "mark@ce.test" });
  });

  it("saves or clears the partner email when the form posts one", async () => {
    await updateContact({}, await editForm({ partner_email: "mark@new.test" }));
    expect((await stored()).partnerEmail).toBe("mark@new.test");
    await updateContact({}, await editForm({ partner_email: "" }));
    expect((await stored()).partnerEmail).toBeNull();
  });

  it("refuses a posted partner email that repeats the email, on that field", async () => {
    const state = await updateContact({}, await editForm({ partner_email: "Ana@ce.test" }));
    expect(state).toMatchObject({ fieldErrors: { partner_email: SAME_PARTNER_EMAIL } });
    expect(state.error).toBeUndefined();
    expect((await stored()).partnerEmail).toBe("mark@ce.test");
  });

  it("shows an invalid partner email on that field", async () => {
    await expect(
      updateContact({}, await editForm({ partner_email: "not-an-email" })),
    ).resolves.toMatchObject({ fieldErrors: { partner_email: "Invalid email address" } });
  });

  it("saves the partner email on a new contact", async () => {
    const form = await editForm({ email: "bo@ce.test", partner_email: "cy@ce.test" });
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
    const form = await editForm({ email: "di@ce.test", partner_email: "DI@ce.test" });
    form.delete("id");
    await expect(createContact({}, form)).resolves.toMatchObject({
      fieldErrors: { partner_email: SAME_PARTNER_EMAIL },
    });
  });
});
