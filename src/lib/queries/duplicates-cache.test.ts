import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { detectDuplicates } from "@/lib/household-match";
import { countDetectedDuplicates, listDetectedDuplicates, loadDuplicateReview } from "./duplicates";

// React's cache only memoizes inside a server request, so stand one in for this test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A, R>(fn: (arg: A) => R) => {
      const seen = new Map<A, R>();
      return (arg: A) => {
        if (!seen.has(arg)) seen.set(arg, fn(arg));
        return seen.get(arg) as R;
      };
    },
  };
});
vi.mock("@/lib/household-match", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/household-match")>();
  return { ...actual, detectDuplicates: vi.fn(actual.detectDuplicates) };
});

const U = "00000000-0000-4000-8000-0000000dd301";
const B = "10000000-0000-4000-8000-0000000dd301";

describe("detected duplicates in one request", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'dd-cache@test.dev') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'dd-cache')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (book_id, full_name, partner_name) values
        (${B}, 'Theo', 'Nina'), (${B}, 'Nina', 'Theo')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("runs detection once for the layout's count, the page's list and Review", async () => {
    const claims = { sub: U };
    vi.mocked(detectDuplicates).mockClear();
    await expect(countDetectedDuplicates(claims)).resolves.toBe(1);
    await expect(listDetectedDuplicates(claims)).resolves.toHaveLength(1);
    await expect(loadDuplicateReview(claims)).resolves.toMatchObject({ pairs: [{ match: "same_people" }] });
    expect(detectDuplicates).toHaveBeenCalledTimes(1);
  });
});
