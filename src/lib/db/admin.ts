import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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

// pg lets a URL's sslmode override the ssl option, and reads sslmode=require
// as full certificate verification. Encrypt, no CA check.
const connection = new URL(url);
const sslmode = connection.searchParams.get("sslmode");
connection.searchParams.delete("sslmode");

const pool = new Pool({
  connectionString: connection.toString(),
  ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 5_000,
});

// Without a listener, an idle client's network error crashes the process.
pool.on("error", (err) => {
  console.error(`[db] [pool] idle client error: ${(err as { code?: string }).code ?? err.name}`);
});

// Keeps a Vercel instance alive until idle connections close, so a frozen
// instance can't hold pooler slots (docs/bugs/2026-11-09-webhook-burst-exhausts-pooler.md).
attachDatabasePool(pool);

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
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`select ${TX_LIMITS}`);
    return fn(tx);
  });
}
