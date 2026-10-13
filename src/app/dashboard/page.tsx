import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnBook } from "@/lib/queries/books";
import { listContacts } from "@/lib/queries/contacts";
import { ContactsTable, type DashboardRow } from "./contacts-table";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const claims = await requireUser();
  const book = await getOwnBook(claims);

  // Onboarding: no book yet → set one up first.
  if (!book) redirect("/onboarding");

  // A crafted URL can repeat ?q=; take the first value rather than crashing.
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
  const contacts = await listContacts(claims, query || undefined);

  // Serialize for the client table: format the date server-side so the
  // client component stays free of Date/locale handling.
  const rows: DashboardRow[] = contacts.map(({ updatedAt, ...rest }) => ({
    ...rest,
    updatedAtLabel: updatedAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  }));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
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
          className="h-9 w-full max-w-xs rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/25 "
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
        <ContactsTable rows={rows} />
      )}
    </main>
  );
}
