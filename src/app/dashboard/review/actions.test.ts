import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { contacts, submissions } from "@/lib/db/schema";
import { approveMerge, reject } from "./actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const U = "00000000-0000-4000-8000-0000000ab001";
const B = "10000000-0000-4000-8000-0000000ab001";
const C = "20000000-0000-4000-8000-0000000ab001";
const S = "30000000-0000-4000-8000-0000000ab001";

const form = (id: string) => {
  const data = new FormData();
  data.set("id", id);
  return data;
};

async function queue(payload: Record<string, unknown>) {
  await dbAdmin.execute(sql`
    insert into public.submissions
      (id, book_id, payload, matched_contact_id, source, recipient, saved_by)
    values (${S}, ${B}, ${JSON.stringify(payload)}::jsonb, ${C}, 'token', 'partner', 'primary')`);
}

describe("review actions", () => {
  beforeEach(async () => {
    vi.mocked(requireUser).mockResolvedValue({ sub: U });
    vi.mocked(revalidatePath).mockClear();
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'rv-owner@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug, enabled_fields)
      values (${B}, ${U}, 'rv-test-book', '{"partner_name": true, "kids_names": true, "birthday": false}')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, first_name, last_name,
        partner_first_name, email, partner_email, address_line1, address_line2, city)
      values (${C}, ${B}, 'Satya Rao', 'Satya', 'Rao', 'Mei', 'satya@rv.test',
        'mei@rv.test', '4410 Fremont Ave N', 'Apt 2', 'Seattle')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("rejecting a reply refreshes the sheet, which shows it as Two answers", async () => {
    await queue({ city: "Tacoma" });
    await expect(reject({}, form(S))).resolves.toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    const [row] = await dbAdmin.select().from(submissions).where(eq(submissions.id, S));
    expect(row.status).toBe("rejected");
  });

  it("using a link reply clears the fields it emptied", async () => {
    await queue({
      first_name: "Satya",
      last_name: "Rao",
      partner_first_name: "",
      partner_last_name: "",
      email: "",
      partner_email: "mei@rv.test",
      address_line1: "4410 Fremont Ave N",
      address_line2: "",
      city: "Seattle",
    });
    await expect(approveMerge({}, form(S))).resolves.toEqual({});
    const [row] = await dbAdmin.select().from(contacts).where(eq(contacts.id, C));
    expect(row).toMatchObject({
      email: "satya@rv.test",
      partnerEmail: "mei@rv.test",
      addressLine2: null,
      partnerFirstName: null,
      partnerName: null,
    });
  });
});
