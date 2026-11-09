import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "./admin";

describe("dbAdmin pool", () => {
  it("holds one connection, so a query waits for an open transaction", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inside!: () => void;
    const entered = new Promise<void>((resolve) => {
      inside = resolve;
    });

    const tx = dbAdmin.transaction(async (t) => {
      await t.execute(sql`select 1`);
      inside();
      await held;
    });
    await entered;

    const outside = dbAdmin.execute(sql`select 1`).then(() => "ran" as const);
    const timer = new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 300));
    expect(await Promise.race([outside, timer])).toBe("waited");

    release();
    await tx;
    expect(await outside).toBe("ran");
  });
});
