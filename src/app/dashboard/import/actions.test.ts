import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import { importContacts } from "./actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, withRls: vi.fn(actual.withRls) };
});

const U = "00000000-0000-4000-8000-0000000de001";
const NO_BOOK = "00000000-0000-4000-8000-0000000de002";
const B = "10000000-0000-4000-8000-0000000de001";

const rows = async () =>
  dbAdmin
    .select({ fullName: contacts.fullName, partnerName: contacts.partnerName, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.bookId, B))
    .orderBy(contacts.fullName);

describe("importContacts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({ sub: U });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values
        (${U}, 'im-owner@test.dev'), (${NO_BOOK}, 'im-nobook@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'im-test-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (book_id, full_name, email) values (${B}, 'Existing Ana', 'ana@im.test')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("re-checks postcodes server-side and saves unrecognized country text", async () => {
    await expect(
      importContacts([{ full_name: "Sanne", country_code: "NL", postal_code: "1016" }]),
    ).resolves.toEqual({ error: "Invalid import data." });
    await expect(
      importContacts([{ full_name: "Nemo", country: "Atlantis", postal_code: "x1" }]),
    ).resolves.toEqual({ imported: 1, skipped: 0 });
    const [nemo] = await dbAdmin
      .select({ countryCode: contacts.countryCode, legacyCountry: contacts.legacyCountry })
      .from(contacts)
      .where(eq(contacts.fullName, "Nemo"));
    expect(nemo).toEqual({ countryCode: null, legacyCountry: "Atlantis" });
  });

  it("imports rows, keeps partners, and skips emails already in the book", async () => {
    await expect(
      importContacts([
        { full_name: "Jen Holloway", partner_name: "Mark Holloway", email: "jen@im.test", city: "Oslo" },
        { full_name: "Ana Again", email: "ANA@im.test" },
        { full_name: "Satya's Family" },
      ]),
    ).resolves.toEqual({ imported: 2, skipped: 1 });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(await rows()).toEqual([
      { fullName: "Existing Ana", partnerName: null, email: "ana@im.test" },
      { fullName: "Jen Holloway", partnerName: "Mark Holloway", email: "jen@im.test" },
      { fullName: "Satya's Family", partnerName: null, email: null },
    ]);
  });

  it("imports the partner's email, dropping one that repeats the email", async () => {
    await expect(
      importContacts([
        { full_name: "Jen Holloway", email: "jen@im.test", partner_email: "mark@im.test" },
        { full_name: "Cal Ortiz", email: "cal@im.test", partner_email: "CAL@im.test" },
      ]),
    ).resolves.toEqual({ imported: 2, skipped: 0 });
    const stored = await dbAdmin
      .select({ fullName: contacts.fullName, partnerEmail: contacts.partnerEmail })
      .from(contacts)
      .where(eq(contacts.bookId, B))
      .orderBy(contacts.fullName);
    expect(stored).toEqual([
      { fullName: "Cal Ortiz", partnerEmail: null },
      { fullName: "Existing Ana", partnerEmail: null },
      { fullName: "Jen Holloway", partnerEmail: "mark@im.test" },
    ]);
  });

  it("keeps the first of two rows sharing an email in one file", async () => {
    await expect(
      importContacts([
        { full_name: "Cal Ortiz", email: "shared@im.test" },
        { full_name: "Dee Ortiz", email: "shared@im.test" },
      ]),
    ).resolves.toEqual({ imported: 1, skipped: 1 });
    expect((await rows()).map((r) => r.fullName)).toEqual(["Cal Ortiz", "Existing Ana"]);
  });

  it("imports email-less rows again on a re-import", async () => {
    const file = [{ full_name: "Satya's Family" }];
    await importContacts(file);
    await expect(importContacts(file)).resolves.toEqual({ imported: 1, skipped: 0 });
    expect((await rows()).filter((r) => r.fullName === "Satya's Family")).toHaveLength(2);
  });

  it("rejects the whole file when any row is invalid", async () => {
    await expect(
      importContacts([{ full_name: "Ok" }, { full_name: "Bad", email: "not-an-email" }]),
    ).resolves.toEqual({ error: "Invalid import data." });
    expect(await rows()).toHaveLength(1);
  });

  it("imports exactly 1000 rows and rejects 1001", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ full_name: `P${i}` }));
    await expect(importContacts(many(1001))).resolves.toEqual({ error: "Invalid import data." });
    expect(await rows()).toHaveLength(1);
    await expect(importContacts(many(1000))).resolves.toEqual({ imported: 1000, skipped: 0 });
  });

  it("returns a generic error when the insert fails", async () => {
    const { withRls } = await import("@/lib/db");
    vi.mocked(withRls).mockRejectedValueOnce(new Error("db down"));
    await expect(importContacts([{ full_name: "X" }])).resolves.toEqual({
      error: "Something went wrong. Please try again.",
    });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain(
      "[im] [importContacts] bulk insert failed",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns zero counts for an empty file", async () => {
    await expect(importContacts([])).resolves.toEqual({ imported: 0, skipped: 0 });
  });

  it("asks an owner with no book to set one up", async () => {
    vi.mocked(requireUser).mockResolvedValue({ sub: NO_BOOK });
    await expect(importContacts([{ full_name: "X" }])).resolves.toEqual({
      error: "Set up your address book first.",
    });
  });

  it("imports a parsed holiday-card CSV end to end", async () => {
    const { parseContactsCsv } = await import("@/lib/csv/import");
    const csv = [
      "Name on Envelope,Address 1,Address 2,City,State,Zip,Country,Email,Status",
      "Priya & Daniel Okafor,1 Main St,,Austin,TX,78701,USA,priya@im.test,Active",
      "Satya & Family,,,,,,,,Active",
    ].join("\n");
    const { valid, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    await expect(importContacts(valid)).resolves.toEqual({ imported: 2, skipped: 0 });
    expect(await rows()).toContainEqual({
      fullName: "Priya Okafor",
      partnerName: "Daniel Okafor",
      email: "priya@im.test",
    });
  });
});
