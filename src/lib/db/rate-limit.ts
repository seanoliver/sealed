import "server-only";
import { sql } from "drizzle-orm";
import { dbAdmin } from "./admin";

/**
 * Fixed-window rate limit backed by private.check_rate_limit (SECURITY
 * DEFINER, Postgres-backed — no extra infra). Returns true when the call is
 * within budget. Throws on connection failure — callers on the public
 * surfaces must catch and FAIL CLOSED (deny), never open.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const { rows } = await dbAdmin.execute(
    sql`select private.check_rate_limit(${key}, ${max}, ${windowSeconds}) as ok`,
  );
  return rows[0]?.ok === true;
}
