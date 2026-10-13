import "server-only";
import { sql } from "drizzle-orm";
import { dbAdmin } from "./admin";

/**
 * Liveness probe for the scheduled health check (/api/health). One trivial
 * round trip with no table access: it reads no data and needs no RLS claims.
 * Throws on any connection or query failure; callers must log via
 * logDbError and never surface the error itself.
 */
export async function pingDatabase(): Promise<void> {
  await dbAdmin.execute(sql`select 1`);
}
