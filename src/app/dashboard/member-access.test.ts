import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { agentTokens, books, contacts, submissions } from "@/lib/db/schema";
import { sendAddressRequests, type SendResult } from "@/lib/email/resend";
import { listContacts } from "@/lib/queries/contacts";
import { listCsvRows } from "@/lib/queries/export";
import { listPendingSubmissions } from "@/lib/queries/submissions";
import { requestAddresses } from "./actions";
import { patchContactAs } from "./contacts/write";
import { importContacts } from "./import/actions";
import { rejectAs } from "./review/resolve";
import { saveBook } from "./settings/actions";
import { createAgentToken } from "./settings/agent-token-actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({
  isEmailDryRun: () => false,
  sendAddressRequests: vi.fn(),
}));

const OWNER = "00000000-0000-4000-8000-0000000ba001";
const MEMBER = "00000000-0000-4000-8000-0000000ba002";
const BOOK = "10000000-0000-4000-8000-0000000ba001";
const CONTACT = "20000000-0000-4000-8000-0000000ba001";
const SUBMISSION = "30000000-0000-4000-8000-0000000ba001";
const member = { sub: MEMBER, email: "ma-member@ma.test" };

const send = vi.mocked(sendAddressRequests);

describe("a linked member working in the owner's book", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${BOOK}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values
        (${OWNER}, 'ma-owner@ma.test'), (${MEMBER}, 'ma-member@ma.test')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`update public.profiles set display_name = 'Sean & Tina' where id = ${OWNER}`);
    await dbAdmin.execute(sql`update public.profiles set display_name = 'Tina' where id = ${MEMBER}`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug) values (${BOOK}, ${OWNER}, 'ma-shared-book')`);
    await dbAdmin.execute(sql`
      insert into public.book_members (book_id, email, user_id, linked_at)
      values (${BOOK}, 'ma-member@ma.test', ${MEMBER}, now())`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email, address_line1, city)
      values (${CONTACT}, ${BOOK}, 'Ana Reyes', 'ana@ma.test', '1 Elm St', 'Portland')`);
    await dbAdmin.execute(sql`
      insert into public.submissions (id, book_id, payload)
      values (${SUBMISSION}, ${BOOK}, '{"full_name": "Pending P"}')`);
  });

  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://app.example");
    vi.mocked(requireUser).mockResolvedValue(member);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await dbAdmin.execute(sql`delete from public.books where id = ${BOOK}`);
    await dbAdmin.execute(sql`delete from auth.users where id in (${OWNER}, ${MEMBER})`);
  });

  it("lists and exports the shared contacts and pending submissions", async () => {
    expect((await listContacts(member)).map((row) => row.id)).toContain(CONTACT);
    expect((await listCsvRows(member)).map((row) => row.email)).toContain("ana@ma.test");
    expect((await listPendingSubmissions(member)).map((row) => row.submission.id)).toContain(SUBMISSION);
  });

  it("edits a shared contact", async () => {
    const result = await patchContactAs(member, CONTACT, { values: { city: "Bergen" } }, { source: "owner" });
    expect(result.ok).toBe(true);
    const [row] = await dbAdmin.select().from(contacts).where(eq(contacts.id, CONTACT));
    expect(row.city).toBe("Bergen");
  });

  it("imports into the shared book", async () => {
    await expect(importContacts([{ full_name: "Imported By Member" }])).resolves.toEqual({
      imported: 1,
      skipped: 0,
    });
    const rows = await dbAdmin.select().from(contacts).where(eq(contacts.fullName, "Imported By Member"));
    expect(rows.map((row) => row.bookId)).toEqual([BOOK]);
  });

  it("rejects a pending submission", async () => {
    expect(await rejectAs(member, SUBMISSION)).toMatchObject({ ok: true });
    const [row] = await dbAdmin.select().from(submissions).where(eq(submissions.id, SUBMISSION));
    expect(row.status).toBe("rejected");
  });

  it("sends as the owner, with replies going to the owner and the member", async () => {
    send.mockImplementation(async (items) =>
      items.map((item, i): SendResult => ({ status: "sent", id: `re_ma_${i}_${Date.now()}`, to: item.to })),
    );
    await expect(requestAddresses({ contactIds: [CONTACT] })).resolves.toMatchObject({ sent: 1 });
    const [[items, options]] = send.mock.calls;
    expect(options).toMatchObject({
      senderName: "Sean & Tina",
      replyTo: ["ma-owner@ma.test", "ma-member@ma.test"],
    });
    expect(items[0].text).toContain("Sean & Tina are addressing holiday cards");
    expect(items[0].text).not.toContain("Tina is");
  });

  it("cannot change the owner's settings", async () => {
    const data = new FormData();
    data.set("display_name", "Tina");
    data.set("slug", "ma-hijacked");
    data.set("sender_country", "GB");
    expect(await saveBook({}, data)).toMatchObject({
      error: "Only the address book's owner can change these settings.",
    });
    const [book] = await dbAdmin.select().from(books).where(eq(books.id, BOOK));
    expect(book).toMatchObject({ slug: "ma-shared-book", senderCountry: "US" });
  });

  it("cannot create an agent token", async () => {
    expect(await createAgentToken({ name: "Tina's agent", scopes: ["read"], expiresInDays: 30 })).toEqual({
      error: "Only the address book's owner can connect agents.",
    });
    expect(await dbAdmin.select().from(agentTokens).where(eq(agentTokens.userId, MEMBER))).toHaveLength(0);
  });
});
