import { sql } from "drizzle-orm";
import { dbAdmin } from "./admin";

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
