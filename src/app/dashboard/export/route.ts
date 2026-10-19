import { requireUser } from "@/lib/auth";
import { contactsToCsv } from "@/lib/csv/export";
import { listCsvRows } from "@/lib/queries/export";

/**
 * Downloads all of the caller's contacts as CSV. Unauthenticated requests are
 * redirected to the entry page by requireUser (redirect() works in route handlers).
 * RLS scopes the select to the caller's own book.
 */
export async function GET(): Promise<Response> {
  const claims = await requireUser();
  const rows = await listCsvRows(claims);

  // UTF-8 BOM so Excel decodes accented names correctly; parseContactsCsv
  // strips it on re-import, so round-tripping is unaffected.
  return new Response("﻿" + contactsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="address-book.csv"',
      "Cache-Control": "no-store",
    },
  });
}
