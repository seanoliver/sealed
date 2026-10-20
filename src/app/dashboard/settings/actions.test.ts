import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { books } from "@/lib/db/schema";
import { saveBook } from "./actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const U = "00000000-0000-4000-8000-0000000fb001";
const B = "10000000-0000-4000-8000-0000000fb001";

function form(senderCountry: string) {
  const data = new FormData();
  data.set("display_name", "Sean");
  data.set("slug", "sb-settings-book");
  data.set("sender_country", senderCountry);
  return data;
}

const senderCountry = async () =>
  (await dbAdmin.select({ code: books.senderCountry }).from(books).where(eq(books.id, B)))[0].code;

describe("saveBook", () => {
  beforeEach(async () => {
    vi.mocked(requireUser).mockResolvedValue({ sub: U });
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'sb-owner@sb.test') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'sb-settings-book')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`delete from auth.users where id = ${U}`);
  });

  it("saves the country the owner mails from", async () => {
    expect(await saveBook({}, form("GB"))).toEqual({ saved: true });
    expect(await senderCountry()).toBe("GB");
  });

  it("refuses a code that isn't a country and keeps the old one", async () => {
    expect(await saveBook({}, form("XX"))).toMatchObject({ error: "Pick the country you mail from" });
    expect(await senderCountry()).toBe("US");
  });
});
