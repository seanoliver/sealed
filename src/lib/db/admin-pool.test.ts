import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { adminTransaction, dbAdmin, poolConfig } from "./admin";

type RequestContext = { waitUntil: ReturnType<typeof vi.fn> };
const requests = new AsyncLocalStorage<RequestContext>();
const CONTEXT = Symbol.for("@vercel/request-context");

function inRequest<T>(fn: () => Promise<T>) {
  const context = { waitUntil: vi.fn() };
  return { context, run: requests.run(context, fn) };
}

describe("dbAdmin pool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<symbol, unknown>)[CONTEXT];
  });

  it("holds few connections, closes them after 1s idle, and waits up to 15s for one", () => {
    expect(dbAdmin.$client.options).toMatchObject({
      max: 2,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      maxLifetimeSeconds: 1_800,
    });
  });

  it("keeps the request that released a connection alive, not the one that opened it", async () => {
    vi.stubEnv("VERCEL_URL", "sealed.test");
    vi.stubEnv("VERCEL_REGION", "iad1");
    (globalThis as Record<symbol, unknown>)[CONTEXT] = { get: () => requests.getStore() };

    const first = inRequest(async () => await dbAdmin.execute(sql`select 1`));
    await first.run;
    const second = inRequest(async () => await dbAdmin.execute(sql`select 1`));
    await second.run;
    const third = inRequest(() => adminTransaction((tx) => tx.execute(sql`select 1`)));
    await third.run;

    expect(second.context.waitUntil).toHaveBeenCalled();
    expect(third.context.waitUntil).toHaveBeenCalled();
  });

  it.each([
    ["postgresql://u:p@db.test:6543/postgres?sslmode=require", { rejectUnauthorized: false }],
    ["postgresql://u:p@db.test:6543/postgres?sslmode=prefer", { rejectUnauthorized: false }],
    ["postgresql://u:p@db.test:6543/postgres?sslmode=allow", { rejectUnauthorized: false }],
    ["postgresql://u:p@db.test:6543/postgres?sslmode=verify-full", {}],
    ["postgresql://u:p@db.test:6543/postgres?sslmode=disable", undefined],
    ["postgresql://u:p@db.test:6543/postgres", undefined],
  ])("maps %s to its TLS setting and drops sslmode from the URL", (url, ssl) => {
    const config = poolConfig(url);
    expect(config.ssl).toEqual(ssl);
    expect(config.connectionString).not.toContain("sslmode");
  });

  it("logs an idle client's error code instead of crashing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("secret detail"), { code: "ECONNRESET" });
    expect(() => dbAdmin.$client.emit("error", err)).not.toThrow();
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("ECONNRESET");
    expect(logged).not.toContain("secret detail");
    error.mockRestore();
  });

  it("keeps a connection after a recoverable SQL error in a transaction", async () => {
    const released: unknown[] = [];
    const onRelease = (err: unknown) => released.push(err);
    dbAdmin.$client.on("release", onRelease);
    try {
      await expect(
        adminTransaction(async (tx) => {
          await tx.execute(sql`select 1 / 0`);
        }),
      ).rejects.toThrow();
    } finally {
      dbAdmin.$client.removeListener("release", onRelease);
    }
    expect(released).toEqual([undefined]);
  });

  it("drops a connection the server closes mid-transaction and keeps serving queries", async () => {
    const released: unknown[] = [];
    const onRelease = (err: unknown) => released.push(err);
    dbAdmin.$client.on("release", onRelease);
    await expect(
      adminTransaction(async (tx) => {
        await tx.execute(sql`select pg_terminate_backend(pg_backend_pid())`);
      }),
    ).rejects.toThrow();
    dbAdmin.$client.removeListener("release", onRelease);
    expect(released[0]).toBeInstanceOf(Error);
    const { rows } = await dbAdmin.execute<{ ok: number }>(sql`select 1 as ok`);
    expect(rows[0].ok).toBe(1);
  });
});
