import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnBook } from "@/lib/queries/books";
import { listContacts } from "@/lib/queries/contacts";
import { findDuplicateOf, listDetectedDuplicates } from "@/lib/queries/duplicates";
import { listPendingReplies } from "@/lib/queries/submissions";
import { bookCounts, toSheetRow, type PendingAnswer } from "@/lib/contacts-sheet";
import { householdLine, pickStoredNames } from "@/lib/names";
import { readingsForContact } from "@/lib/pinyin";
import {
  parseSubmissionForDisplay,
  submittedPeople,
  type SubmittedPerson,
} from "@/lib/validation/submission";
import { ContactsTable } from "./contacts-table";

// Covers requestAddresses: its Resend time budget plus bookkeeping.
export const maxDuration = 300;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; added?: string | string[] }>;
}) {
  const claims = await requireUser();
  const book = await getOwnBook(claims);

  // Onboarding: no book yet → set one up first.
  if (!book) redirect("/onboarding");

  // A crafted URL can repeat ?q=; take the first value rather than crashing.
  const { q, added } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
  const [contacts, wholeBook, replies, duplicates] = await Promise.all([
    listContacts(claims, query || undefined),
    // Search filters in SQL, and the counts always cover the whole book.
    query ? listContacts(claims) : null,
    listPendingReplies(claims),
    listDetectedDuplicates(claims),
  ]);
  // Checked directly, not from the capped list, so a full book still warns.
  const duplicateOfAdded = typeof added === "string" ? await findDuplicateOf(claims, added) : undefined;

  const answers = new Map<string, PendingAnswer>();
  const answerPeople = new Map<string, SubmittedPerson[]>();
  for (const reply of replies) {
    const display = parseSubmissionForDisplay(reply.payload, book.enabledFields);
    if (display === null) continue;
    answerPeople.set(reply.contactId, submittedPeople(reply.payload, book.enabledFields));
    answers.set(reply.contactId, {
      submissionId: reply.id,
      display,
      from: reply.from,
      savedBy: reply.savedBy,
    });
  }

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const rows = await Promise.all(
    contacts.map(async (contact) =>
      toSheetRow(contact, formatDate, {
        answer: answers.get(contact.id),
        senderCountry: book.senderCountry,
        readings: await readingsForContact(contact, {
          extra: answerPeople.get(contact.id) ?? [],
        }),
      }),
    ),
  );
  const counts = bookCounts(
    wholeBook
      ? wholeBook.map((contact) =>
          toSheetRow(contact, formatDate, { senderCountry: book.senderCountry }),
        )
      : rows,
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          Your address book
        </h1>
        <div className="flex items-center gap-2">
          {/* Route handler streams the CSV; plain <a> so the browser downloads it. */}
          <a
            href="/dashboard/export"
            download
            className="inline-flex h-9 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted  "
          >
            Export CSV
          </a>
          <Link
            href="/dashboard/import"
            className="inline-flex h-9 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted  "
          >
            Import CSV
          </Link>
          <Link
            href="/dashboard/contacts/new"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 "
          >
            Add contact
          </Link>
        </div>
      </div>

      {duplicateOfAdded ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          Saved. This may be the same people as{" "}
          {householdLine(pickStoredNames(duplicateOfAdded))}.{" "}
          <Link href="/dashboard/review" className="underline underline-offset-2">
            Review
          </Link>
        </p>
      ) : null}

      <Form action="/dashboard" className="mt-6 flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search contacts
        </label>
        {/* Remounts on back/forward so the box matches ?q=. */}
        <input
          key={query}
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search by name or partner…"
          className="h-9 w-full max-w-xs rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/25 "
        />
        <button
          type="submit"
          className="h-9 rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted  "
        >
          Search
        </button>
      </Form>

      {rows.length === 0 ? (
        query ? (
          <p className="mt-6 rounded-xl border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground   ">
            No contacts match &ldquo;{query}&rdquo;.{" "}
            <Link
              href="/dashboard"
              className="underline underline-offset-2 hover:text-foreground/80 "
            >
              Clear search
            </Link>
          </p>
        ) : (
          <p className="mt-6 rounded-xl border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground   ">
            No contacts yet —{" "}
            <Link
              href="/dashboard/import"
              className="underline underline-offset-2 hover:text-foreground/80 "
            >
              import a CSV
            </Link>{" "}
            or{" "}
            <Link
              href="/dashboard/contacts/new"
              className="underline underline-offset-2 hover:text-foreground/80 "
            >
              add your first contact
            </Link>
            .
          </p>
        )
      ) : (
        // Remount per search, or an open "Send to all shown" keeps the old rows.
        <ContactsTable
          key={query}
          rows={rows}
          book={counts}
          searching={query !== ""}
          duplicatePairs={duplicates.map(({ first, second }) => [first.id, second.id] as const)}
        />
      )}
    </main>
  );
}
