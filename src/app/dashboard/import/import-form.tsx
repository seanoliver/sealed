"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import { countryName } from "@/lib/address";
import { duplicateRows, type MatchableNames } from "@/lib/household-match";
import { parseContactsCsv, type CsvRowError, type ImportRow } from "@/lib/csv/import";
import { importContacts } from "./actions";

/**
 * Friendly rejection before parsing — 1,000 contact rows fit well under this.
 * Kept below Next's 1 MB server-action body limit with headroom: the action
 * payload is JSON with ~130 B of field-name keys per row, so a CSV close to
 * 1 MB could serialize past the limit and 413 even though the file is fine.
 */
const MAX_FILE_BYTES = 750 * 1024;

const PREVIEW_ROWS = 20;

type Preview = {
  ready: ImportRow[];
  errors: CsvRowError[];
  warnings: CsvRowError[];
  /** In-file duplicate emails removed client-side (first occurrence kept). */
  duplicates: number;
  /** Indexes into `ready` that name people already in the book or earlier in the file. */
  nameMatches: number[];
};

type Done = { imported: number; skipped: number };

/**
 * First row wins for each email (compared case-insensitively — the email
 * column is citext, so this mirrors how the DB's unique index would collide).
 * Rows without an email are always kept.
 */
function dedupeByEmail(rows: ImportRow[]): {
  ready: ImportRow[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const ready: ImportRow[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = row.email?.toLowerCase();
    if (key !== undefined) {
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
    }
    ready.push(row);
  }
  return { ready, duplicates };
}

const rowNames = (row: ImportRow): MatchableNames => ({
  fullName: row.full_name,
  partnerName: row.partner_name ?? null,
  firstName: null,
  lastName: null,
  partnerFirstName: null,
  partnerLastName: null,
});

const householdName = (row: ImportRow) =>
  row.partner_name ? `${row.full_name} & ${row.partner_name}` : row.full_name;

const thClasses =
  "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const tdClasses = "px-4 py-2.5 text-sm text-foreground/80";

export function ImportForm({
  bookNames,
}: {
  bookNames: readonly (MatchableNames & { id: string })[];
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [leaveOut, setLeaveOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setError(null);
    setDone(null);
    setLeaveOut(false);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(
        "That file is larger than 750 KB. Split it into smaller files and try again.",
      );
      return;
    }
    const text = await file.text();
    const { valid, errors, warnings } = parseContactsCsv(text);
    const { ready, duplicates } = dedupeByEmail(valid);
    const nameMatches = duplicateRows(ready.map(rowNames), bookNames);
    setPreview({ ready, errors, warnings, duplicates, nameMatches });
  }

  const importing = preview
    ? leaveOut
      ? preview.ready.filter((_, index) => !preview.nameMatches.includes(index))
      : preview.ready
    : [];

  function onConfirm() {
    if (!preview || importing.length === 0) return;
    const { duplicates } = preview;
    const left = leaveOut ? preview.nameMatches.length : 0;
    const ready = importing;
    startTransition(async () => {
      // Transport failures (oversized action payload → 413, network drop)
      // REJECT the action promise rather than returning { error } — catch
      // them so the user sees a banner instead of an unhandled rejection.
      let result: Awaited<ReturnType<typeof importContacts>>;
      try {
        result = await importContacts(ready);
      } catch {
        setError("Something went wrong — nothing was imported. Try again.");
        return;
      }
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPreview(null);
      setDone({
        imported: result.imported,
        // Server skips = emails already in the book; add the in-file
        // duplicates removed before sending so the tally covers the file.
        skipped: result.skipped + duplicates + left,
      });
    });
  }

  const skippedRows = preview ? preview.errors.length + preview.duplicates : 0;

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="csv-file"
          className="text-sm font-medium text-foreground"
        >
          CSV file
        </label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChange}
          className="text-sm text-foreground/80 file:mr-3 file:rounded-lg file:border file:border-input file:bg-card file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted dark:text-muted-foreground "
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {done ? (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          Imported {done.imported}{" "}
          {done.imported === 1 ? "contact" : "contacts"}, skipped {done.skipped}
          .{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to contacts
          </Link>
        </div>
      ) : null}

      {/* Header-only file: recognizable columns but zero data rows — bare
          "0 contacts ready, 0 rows skipped" counts would read like a bug. */}
      {preview &&
      preview.ready.length === 0 &&
      preview.errors.length === 0 &&
      preview.duplicates === 0 ? (
        <p className="rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground   ">
          No data rows found in this file.
        </p>
      ) : preview ? (
        <>
          <p className="text-sm text-foreground/80">
            <span className="font-medium">
              {preview.ready.length}{" "}
              {preview.ready.length === 1 ? "contact" : "contacts"} ready
            </span>
            , {skippedRows} {skippedRows === 1 ? "row" : "rows"} skipped.
            {preview.duplicates > 0 ? (
              <>
                {" "}
                {preview.duplicates}{" "}
                {preview.duplicates === 1
                  ? "row repeats an email"
                  : "rows repeat emails"}{" "}
                earlier in the file (first occurrence kept).
              </>
            ) : null}
          </p>

          {preview.errors.length > 0 ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              <p className="font-medium">
                {preview.errors.length}{" "}
                {preview.errors.length === 1 ? "row" : "rows"} won&apos;t be
                imported:
              </p>
              <ul className="mt-2 max-h-64 list-inside list-disc overflow-y-auto">
                {preview.errors.map((err) => (
                  <li key={`${err.row}-${err.message}`}>
                    {err.row > 0 ? `Row ${err.row}: ` : null}
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.warnings.length > 0 ? (
            <div className="rounded-lg border border-border bg-secondary/50 p-4 text-sm text-foreground">
              <p className="font-medium">Check {preview.warnings.length === 1 ? "this row" : "these rows"}:</p>
              <ul className="mt-2 max-h-64 list-inside list-disc overflow-y-auto">
                {preview.warnings.map((warning) => (
                  <li key={`${warning.row}-${warning.message}`}>
                    Row {warning.row}: {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.ready.length > 0 ? (
            <>
              {preview.nameMatches.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-sm font-medium text-foreground">
                    {preview.nameMatches.length}{" "}
                    {preview.nameMatches.length === 1 ? "row matches" : "rows match"} people already
                    in your book or earlier in this file
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Such as {householdName(preview.ready[preview.nameMatches[0]])}.
                  </p>
                  <fieldset className="mt-1 flex flex-col gap-2">
                    <legend className="mb-1.5 text-sm font-medium text-foreground">
                      What should happen to {preview.nameMatches.length === 1 ? "this row" : "these rows"}?
                    </legend>
                    {[
                      {
                        out: false,
                        title: preview.nameMatches.length === 1 ? "Import it" : "Import them",
                        detail: `Review ${preview.nameMatches.length === 1 ? "it" : "them"} on the Review page afterwards.`,
                      },
                      {
                        out: true,
                        title: preview.nameMatches.length === 1 ? "Leave it out" : "Leave them out",
                        detail: `The other ${preview.ready.length - preview.nameMatches.length} still import.`,
                      },
                    ].map(({ out, title, detail }) => (
                      <label
                        key={title}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm ${
                          leaveOut === out ? "border-primary ring-1 ring-primary" : "border-border"
                        }`}
                      >
                        <input
                          type="radio"
                          name="name-matches"
                          checked={leaveOut === out}
                          onChange={() => setLeaveOut(out)}
                          className="mt-0.5 accent-primary"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium text-foreground">{title}</span>
                          <span className="text-muted-foreground">{detail}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              ) : null}
              <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm ">
                <table
                  className="w-full min-w-[36rem]"
                  aria-label="Import preview"
                >
                  <thead className="border-b border-border ">
                    <tr>
                      <th scope="col" className={thClasses}>
                        Name
                      </th>
                      <th scope="col" className={thClasses}>
                        Partner
                      </th>
                      <th scope="col" className={thClasses}>
                        Email
                      </th>
                      <th scope="col" className={thClasses}>
                        City
                      </th>
                      <th scope="col" className={thClasses}>
                        Country
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {preview.ready.slice(0, PREVIEW_ROWS).map((row, i) => (
                      <tr key={i}>
                        <td
                          className={`${tdClasses} font-medium text-foreground`}
                        >
                          {row.full_name}
                        </td>
                        <td className={tdClasses}>{row.partner_name ?? "—"}</td>
                        <td className={tdClasses}>{row.email ?? "—"}</td>
                        <td className={tdClasses}>{row.city ?? "—"}</td>
                        <td className={tdClasses}>
                          {row.country_code
                            ? countryName(row.country_code)
                            : row.country
                              ? `${row.country} (not on the list)`
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.ready.length > PREVIEW_ROWS ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {PREVIEW_ROWS} of {preview.ready.length}{" "}
                  contacts.
                </p>
              ) : null}
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending || importing.length === 0}
                className="h-10 self-start rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50 "
              >
                {pending
                  ? "Importing…"
                  : `Import ${importing.length} ${importing.length === 1 ? "contact" : "contacts"}`}
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
