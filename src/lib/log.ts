import "server-only";

/**
 * PII-safe logging for database errors.
 *
 * Never log a DB error object (or its drizzle wrapper) directly:
 * DrizzleQueryError's message embeds the full query with params, and
 * PostgresError's `detail` can embed row values (addresses, emails, ...).
 * This helper logs only the tag, the Postgres error `code`,
 * `constraint_name` when present, and the underlying Postgres error's
 * message (which names relations/constraints, not values).
 *
 * Caveat: class-22 (data exception) Postgres messages CAN embed input
 * values (e.g. "value too long for type", invalid date literals quote the
 * input). The validate-first convention — every write is zod-parsed with
 * limits mirroring the SQL CHECKs before it reaches the DB — keeps those
 * errors unreachable in practice; keep it that way.
 *
 * Pass `includeMessage: false` where connection failures are expected:
 * their messages name hosts, ports and roles.
 */
export function logDbError(
  tag: string,
  err: unknown,
  { includeMessage = true }: { includeMessage?: boolean } = {},
): void {
  let code: string | undefined;
  let constraint: string | undefined;
  let message: string | undefined;

  // Walk the `cause` chain (drizzle wraps the real PostgresError) and take
  // the deepest error carrying a Postgres error code.
  let cur: unknown = err;
  while (cur instanceof Error) {
    const e = cur as Error & { code?: unknown; constraint_name?: unknown };
    if (typeof e.code === "string") {
      code = e.code;
      constraint =
        typeof e.constraint_name === "string" ? e.constraint_name : undefined;
      message = includeMessage ? e.message : undefined;
    }
    cur = cur.cause;
  }

  // No Postgres code anywhere in the cause chain (network failure, plain
  // Error, non-Error throw): log the error's name/type so the entry is
  // never a bare {} — still no message, which could embed values.
  const fallback =
    code === undefined
      ? { name: err instanceof Error ? err.name : typeof err }
      : undefined;

  console.error(
    `${tag} db error`,
    JSON.stringify({ code, constraint, message, ...fallback }),
  );
}
