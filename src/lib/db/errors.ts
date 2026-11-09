import "server-only";

/**
 * Walks the error `cause` chain (drizzle wraps Postgres errors in
 * DrizzleQueryError with the real pg DatabaseError as `cause`) looking for a
 * unique violation (23505) on the given constraint.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  let cur: unknown = err;
  while (cur instanceof Error) {
    const e = cur as Error & { code?: unknown; constraint?: unknown };
    if (e.code === "23505" && e.constraint === constraint) return true;
    cur = cur.cause;
  }
  return false;
}
