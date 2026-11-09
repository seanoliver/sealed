import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { assertServerEnv } from "@/lib/env";
import * as schema from "./schema";

// Single choke point: every server path that touches data imports this
// module (directly or via withRls), so a deployment missing required env
// vars fails at first touch with a clear list instead of deep in a request.
assertServerEnv();

// Explicit guard (and type narrowing): pg silently falls back to
// localhost:5432 when the connection string is undefined — fail loudly.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const NO_VERIFY_MODES = new Set(["require", "prefer", "allow"]);

/**
 * pg lets a URL's sslmode override the ssl option, and reads sslmode=require
 * as full certificate verification. require/prefer/allow encrypt without a CA
 * check, verify-ca/verify-full keep Node's verification, disable or none is plain.
 */
export function poolConfig(databaseUrl: string): PoolConfig {
  const connection = new URL(databaseUrl);
  const sslmode = connection.searchParams.get("sslmode");
  connection.searchParams.delete("sslmode");
  return {
    connectionString: connection.toString(),
    ssl: !sslmode || sslmode === "disable" ? undefined : NO_VERIFY_MODES.has(sslmode) ? { rejectUnauthorized: false } : {},
    max: 2,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    maxLifetimeSeconds: 30 * 60,
  };
}

const pool = new Pool(poolConfig(url));

// Without a listener, an idle client's network error crashes the process.
pool.on("error", (err) => {
  console.error(`[db] [pool] idle client error: ${(err as { code?: string }).code ?? err.name}`);
});

// Keeps a Vercel instance alive until idle connections close, so a frozen
// instance can't hold pooler slots (docs/bugs/2026-11-09-webhook-burst-exhausts-pooler.md).
attachDatabasePool(pool);

/** A server error (SQLSTATE) below FATAL leaves the connection usable; anything else may not. */
function connectionSurvives(err: unknown): boolean {
  let cur: unknown = err;
  while (cur instanceof Error) {
    const e = cur as Error & { code?: unknown; severity?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.severity === "string") {
      return e.severity !== "FATAL" && e.severity !== "PANIC";
    }
    cur = cur.cause;
  }
  return false;
}

/**
 * Checks out a client and releases it in this request's async context, which
 * is where attachDatabasePool registers the keep-alive. pg-pool's own query()
 * and drizzle's transaction() release from a socket callback or skip release
 * when BEGIN fails, so every query and transaction goes through here.
 */
export async function withClient<T>(from: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await from.connect();
  let broken: Error | undefined;
  const onError = (err: Error) => {
    broken = err;
  };
  client.on("error", onError);
  try {
    return await fn(client);
  } catch (err) {
    if (!connectionSurvives(err)) broken ??= err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

pool.query = ((text: never, values?: never) =>
  withClient(pool, (client) => client.query(text, values))) as typeof pool.query;

export function transactionOn<T>(
  from: Pool,
  fn: (tx: Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return withClient(from, (client) => drizzle(client, { schema }).transaction(fn));
}

/**
 * Admin connection — BYPASSES RLS (connection role owns the tables).
 * Allowed uses: calling private.* SECURITY DEFINER functions, minting
 * update_tokens, webhook status updates. NEVER use for owner-facing reads.
 * Importing this module is lint-restricted to the sanctioned call sites
 * (see no-restricted-imports in eslint.config.mjs) — owner-facing access
 * goes through withRls in `@/lib/db`.
 */
export const dbAdmin = drizzle(pool, { schema });

/** Transaction-scoped: COMMIT or ROLLBACK restores the session defaults. */
export const TX_LIMITS = sql`set_config('statement_timeout', '10s', true),
               set_config('idle_in_transaction_session_timeout', '10s', true)`;

type AdminTx = Parameters<Parameters<typeof dbAdmin.transaction>[0]>[0];

/** dbAdmin.transaction with the same limits withRls applies; lint bans the bare call. */
export function adminTransaction<T>(fn: (tx: AdminTx) => Promise<T>): Promise<T> {
  return transactionOn(pool, async (tx) => {
    await tx.execute(sql`select ${TX_LIMITS}`);
    return fn(tx);
  });
}
