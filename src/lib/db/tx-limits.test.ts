import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withRls } from "@/lib/db";
import { dbAdmin } from "./admin";
import { adminTransaction } from "./tx-limits";

const U = "00000000-0000-0000-0000-00000000d001";

async function readLimits(db: { execute: typeof dbAdmin.execute }) {
  const rows = (await db.execute(sql`
    select current_setting('statement_timeout') as statement,
           current_setting('idle_in_transaction_session_timeout') as idle`)) as unknown as {
    statement: string;
    idle: string;
  }[];
  return rows[0];
}

describe("transaction limits", () => {
  let sessionDefaults: Awaited<ReturnType<typeof readLimits>>;
  beforeAll(async () => {
    sessionDefaults = await readLimits(dbAdmin);
  });

  it("caps every withRls transaction at 10s", async () => {
    const inside = await withRls({ sub: U }, (tx) => readLimits(tx));
    expect(inside).toEqual({ statement: "10s", idle: "10s" });
  });

  it("caps every adminTransaction at 10s", async () => {
    const inside = await adminTransaction((tx) => readLimits(tx));
    expect(inside).toEqual({ statement: "10s", idle: "10s" });
  });

  it("leaves the session defaults in place after commit", async () => {
    await withRls({ sub: U }, (tx) => tx.execute(sql`select 1`));
    expect(await readLimits(dbAdmin)).toEqual(sessionDefaults);
  });
});
