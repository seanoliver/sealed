import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import { listDetectedDuplicates } from "@/lib/queries/duplicates";
import { dismissDuplicate } from "./actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const U = "00000000-0000-4000-8000-0000000dd201";
const B = "10000000-0000-4000-8000-0000000dd201";
const KEEP = "20000000-0000-4000-8000-0000000dd201";
const REMOVE = "20000000-0000-4000-8000-0000000dd202";
const claims = { sub: U };

const stored = async (id: string) => (await dbAdmin.select().from(contacts).where(eq(contacts.id, id)))[0];

describe("duplicate actions", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const seed = async () => {
    vi.mocked(requireUser).mockResolvedValue(claims);
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'dd-merge@test.dev') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'dd-merge')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, partner_name, notes) values
        (${KEEP}, ${B}, 'Theo Marsh', 'Nina Marsh', null),
        (${REMOVE}, ${B}, 'Nina Marsh', 'Theo Marsh', 'From the other row')`);
  };

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("rejects a malformed id before touching the database", async () => {
    await expect(dismissDuplicate({}, form({ first_id: "x", second_id: REMOVE }))).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("marks a pair as not duplicates and leaves both contacts", async () => {
    await seed();
    await expect(
      dismissDuplicate({}, form({ first_id: REMOVE, second_id: KEEP })),
    ).resolves.toEqual({});
    await expect(listDetectedDuplicates(claims)).resolves.toEqual([]);
    await expect(stored(REMOVE)).resolves.toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/review");
  });
});
