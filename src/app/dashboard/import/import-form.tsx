"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import { countryName } from "@/lib/address";
import { parseContactsCsv, type CsvRowError } from "@/lib/csv/import";
import { type ContactInput } from "@/lib/validation/contact";
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
  ready: ContactInput[];
  errors: CsvRowError[];
  /** In-file duplicate emails removed client-side (first occurrence kept). */
  duplicates: number;
};

type Done = { imported: number; skipped: number };

/**
 * First row wins for each email (compared case-insensitively — the email
 * column is citext, so this mirrors how the DB's unique index would collide).
 * Rows without an email are always kept.
 */
function dedupeByEmail(rows: ContactInput[]): {
  ready: ContactInput[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const ready: ContactInput[] = [];
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

const thClasses =
  "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const tdClasses = "px-4 py-2.5 text-sm text-foreground/80";

export function ImportForm() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setError(null);
    setDone(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(
        "That file is larger than 750 KB. Split it into smaller files and try again.",
      );
      return;
    }
    const text = await file.text();
    const { valid, errors } = parseContactsCsv(text);
    const { ready, duplicates } = dedupeByEmail(valid);
    setPreview({ ready, errors, duplicates });
  }

  function onConfirm() {
    if (!preview || preview.ready.length === 0) return;
    const { ready, duplicates } = preview;
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
        skipped: result.skipped + duplicates,
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

          {preview.ready.length > 0 ? (
            <>
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
                        <td className={tdClasses}>{row.country_code ? countryName(row.country_code) : "—"}</td>
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
                disabled={pending}
                className="h-10 self-start rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50 "
              >
                {pending
                  ? "Importing…"
                  : `Import ${preview.ready.length} ${preview.ready.length === 1 ? "contact" : "contacts"}`}
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
