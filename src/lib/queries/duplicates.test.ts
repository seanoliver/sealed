import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { countDetectedDuplicates, dismissDuplicateAs, listDetectedDuplicates } from "./duplicates";

const U = "00000000-0000-4000-8000-0000000dd101";
const OTHER = "00000000-0000-4000-8000-0000000dd102";
const B = "10000000-0000-4000-8000-0000000dd101";
const B2 = "10000000-0000-4000-8000-0000000dd102";
const THEO = "20000000-0000-4000-8000-0000000dd101";
const NINA = "20000000-0000-4000-8000-0000000dd102";
const ANA = "20000000-0000-4000-8000-0000000dd103";
const ELSEWHERE = "20000000-0000-4000-8000-0000000dd104";

describe("detected duplicates", () => {
  beforeEach(async () => {
    await dbAdmin.execute(sql`delete from public.books where id in (${B}, ${B2})`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'dd-a@test.dev'), (${OTHER}, 'dd-b@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'dd-a'), (${B2}, ${OTHER}, 'dd-b')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, partner_name) values
        (${THEO}, ${B}, 'Theo', 'Nina'), (${NINA}, ${B}, 'Nina', 'Theo'),
        (${ANA}, ${B}, 'Ana Ruiz', null), (${ELSEWHERE}, ${B2}, 'Theo', 'Nina')`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id in (${B}, ${B2})`);
  });

  it("lists a pair with both contacts, and never crosses books", async () => {
    const pairs = await listDetectedDuplicates({ sub: U });
    expect(pairs.map(({ first, second, match }) => [first.id, second.id, match])).toEqual([
      [THEO, NINA, "same_people"],
    ]);
  });

  it("stops listing a dismissed pair, whichever way round it was sent", async () => {
    await expect(dismissDuplicateAs({ sub: U }, NINA, THEO)).resolves.toEqual({ ok: true });
    await expect(listDetectedDuplicates({ sub: U })).resolves.toEqual([]);
  });

  it("leaves a dismissed pair out of the nav count", async () => {
    await expect(countDetectedDuplicates({ sub: U })).resolves.toBe(1);
    await dismissDuplicateAs({ sub: U }, THEO, NINA);
    await expect(countDetectedDuplicates({ sub: U })).resolves.toBe(0);
  });

  it("treats dismissing twice as done", async () => {
    await dismissDuplicateAs({ sub: U }, THEO, NINA);
    await expect(dismissDuplicateAs({ sub: U }, THEO, NINA)).resolves.toEqual({ ok: true });
  });

  it("refuses a pair outside the caller's book", async () => {
    await expect(dismissDuplicateAs({ sub: U }, THEO, ELSEWHERE)).resolves.toEqual({
      ok: false,
      error: "Contact not found.",
    });
  });
});
