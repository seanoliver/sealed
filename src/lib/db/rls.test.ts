import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { makeWithRls, withRls } from "./index";
import { dbAdmin } from "./admin";
import * as schema from "./schema";

const { contacts, updateTokens } = schema;

// drizzle wraps Postgres errors in DrizzleQueryError ("Failed query: ...")
// with the real error as `cause` — match against the full chain.
function chainMessage(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  while (cur instanceof Error) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.join(" <- ");
}

const U1 = "00000000-0000-0000-0000-00000000b001";
const U2 = "00000000-0000-0000-0000-00000000b002";
const B1 = "10000000-0000-0000-0000-00000000b001";
const C1 = "20000000-0000-0000-0000-00000000b001";

describe("withRls", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values
        (${U1}, 'rlstest1@test.dev'), (${U2}, 'rlstest2@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug)
      values (${B1}, ${U1}, 'rls-test-book')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name)
      values (${C1}, ${B1}, 'RLS Test Contact')
      on conflict (id) do nothing`);
  });

  it("owner sees own contacts", async () => {
    const rows = await withRls({ sub: U1 }, (tx) => tx.select().from(contacts));
    expect(rows.some((r) => r.fullName === "RLS Test Contact")).toBe(true);
  });

  it("other user sees nothing", async () => {
    const rows = await withRls({ sub: U2 }, (tx) => tx.select().from(contacts));
    expect(rows.filter((r) => r.bookId === B1)).toHaveLength(0);
  });

  it("update_tokens are unreachable under RLS (zero grants -> permission denied)", async () => {
    await expect(
      withRls({ sub: U1 }, (tx) => tx.select().from(updateTokens)),
    ).rejects.toSatisfy((e) =>
      /permission denied for table update_tokens/.test(chainMessage(e)),
    );
  });

  it("rejects writes into another owner's book", async () => {
    await expect(
      withRls({ sub: U2 }, (tx) =>
        tx.insert(contacts).values({ bookId: B1, fullName: "Intruder" }),
      ),
    ).rejects.toSatisfy((e) => /row-level security/.test(chainMessage(e)));
  });

  it("leaves no role or claims on the pooled connection after commit", async () => {
    // The hazard is the COMMITTED path: a session-scoped `set role` or
    // set_config(is_local => false) would leak the user's claims onto the
    // pooled connection for the NEXT caller. (A failure-path probe proves
    // nothing — ROLLBACK reverts even a plain session-scoped SET.)
    // max: 1 forces the probe onto the same physical connection.
    const single = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
    try {
      const withRlsSingle = makeWithRls(single);
      const rows = await withRlsSingle({ sub: U1 }, (tx) => tx.select().from(contacts));
      expect(rows.length).toBeGreaterThan(0); // successful, committed
      const { rows: [probe] } = await single.query<{ role: string; claims: string | null }>(`
        select current_user as role,
               current_setting('request.jwt.claims', true) as claims`);
      // The connection role is `postgres` in local dev and a restricted
      // `app_server` role in a hardened deployment (docs/SECURITY.md,
      // "Database role") — either way, what matters is that the DROPPED
      // role didn't stick: the pooled connection must not still be
      // `authenticated` (or carry claims) after commit.
      expect(probe.role).not.toBe("authenticated");
      expect(probe.claims ?? "").toBe("");
    } finally {
      await single.end();
    }
  });

  it("throws immediately when claims.sub is missing or empty", async () => {
    await expect(
      withRls({ sub: "" }, (tx) => tx.select().from(contacts)),
    ).rejects.toThrow(/sub/);
  });
});
