import { CONTACT_FIELDS, type ContactField } from "@/lib/validation/contact";

// NOTE: keep this module dependency-clean (no server-only imports, no db/env
// access) — like import.ts it is pure string logic; the export route handler
// does the server-only work.

/**
 * Export columns: the canonical CONTACT_FIELDS (what parseContactsCsv reads)
 * with the structured name columns after the display names. The importer
 * ignores the structured columns; the display names round-trip.
 */
export const CSV_COLUMNS = [
  "full_name",
  "partner_name",
  "kids_names",
  "first_name",
  "last_name",
  "partner_first_name",
  "partner_last_name",
  ...CONTACT_FIELDS.filter(
    (field) => field !== "full_name" && field !== "partner_name" && field !== "kids_names",
  ),
] as const;

export type CsvColumn = ContactField | (typeof CSV_COLUMNS)[number];

/** One exported contact: column name → value (null/missing → empty cell). */
export type ContactCsvRow = Partial<Record<CsvColumn, string | null>>;

/**
 * Formula-injection guard (OWASP "CSV Injection"): cells beginning with
 * = + - @, tab, or CR are treated as formulas by Excel/Numbers/Sheets, so a
 * contact who set their name to `=HYPERLINK(...)` via the token form would
 * otherwise become an exploit when the owner opens the export.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** RFC 4180: quote any field containing a comma, quote, or line break. */
const NEEDS_QUOTING = /[",\r\n]/;

function toCell(value: string | null | undefined): string {
  let cell = value ?? "";
  // Sanitize before quoting so the neutralizing ' ends up inside the quotes.
  // Tradeoff: the ' survives a re-import (documented in the round-trip tests);
  // safety over losslessness.
  if (FORMULA_PREFIX.test(cell)) cell = `'${cell}`;
  if (NEEDS_QUOTING.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

/**
 * Serializes contacts to RFC 4180 CSV: CSV_COLUMNS header (a superset of the
 * headers parseContactsCsv recognizes, so export → import round-trips),
 * CRLF line endings with a trailing CRLF, empty cells for null/missing
 * values, and formula-injection-safe cell contents.
 */
export function contactsToCsv(rows: readonly ContactCsvRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => toCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
