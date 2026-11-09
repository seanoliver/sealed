import "server-only";
import { type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { dbAdmin, TX_LIMITS } from "./admin";

export type RlsTx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Factory exported for tests (the suite probes a dedicated max-1 pool to
 * prove nothing leaks onto the connection after commit). Application code
 * uses the `withRls` export below.
 */
export function makeWithRls(db: PostgresJsDatabase<typeof schema>) {
  return async function withRls<T>(
    claims: { sub: string; [k: string]: unknown },
    fn: (tx: RlsTx) => Promise<T>,
  ): Promise<T> {
    if (!claims.sub) {
      throw new Error("withRls: claims.sub must be a non-empty user id");
    }
    return db.transaction(async (tx) => {
      // Single round trip; set_config('role', ..., is_local => true) is
      // equivalent to SET LOCAL ROLE.
      await tx.execute(sql`
        select set_config('request.jwt.claims', ${JSON.stringify({ ...claims, role: "authenticated" })}, true),
               set_config('request.jwt.claim.sub', ${claims.sub}, true),
               set_config('role', 'authenticated', true),
               ${TX_LIMITS}`);
      try {
        return await fn(tx);
      } finally {
        // Belt-and-braces: set_config(..., is_local => true) is
        // transaction-scoped, so COMMIT/ROLLBACK restores the role either
        // way. If fn threw a Postgres error the tx is aborted and
        // `reset role` itself fails (25P02) — swallow that so the original
        // error propagates instead of being masked.
        try {
          await tx.execute(sql`reset role`);
        } catch {
          // aborted transaction; rollback will restore the role
        }
      }
    });
  };
}

/**
 * Runs `fn` inside a transaction with the user's JWT claims applied and
 * `role` dropped to `authenticated`, so every query inside is RLS-enforced.
 * This is the ONLY sanctioned path for owner-facing data access.
 */
export const withRls = makeWithRls(dbAdmin);
