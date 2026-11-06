import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnBook } from "@/lib/queries/books";
import { loadDuplicateReview } from "@/lib/queries/duplicates";
import { ImportForm } from "./import-form";

export default async function ImportPage() {
  const claims = await requireUser();
  const book = await getOwnBook(claims);

  // Onboarding: no book yet → set one up first (imports need a book).
  if (!book) redirect("/onboarding");

  const { contacts } = await loadDuplicateReview(claims);
  const bookNames = contacts.map((contact) => ({
    id: contact.id,
    fullName: contact.fullName,
    partnerName: contact.partnerName,
    firstName: contact.firstName,
    lastName: contact.lastName,
    partnerFirstName: contact.partnerFirstName,
    partnerLastName: contact.partnerLastName,
  }));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground/80  "
      >
        &larr; Back to contacts
      </Link>
      <h1 className="mt-4 font-serif text-2xl leading-tight text-foreground">
        Import contacts from CSV
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a CSV with a header row. Common column names like
        &ldquo;Name&rdquo;, &ldquo;Spouse&rdquo;, or &ldquo;Zip&rdquo; are
        recognized automatically, up to 1,000 rows per file.{" "}
        <a
          href="/contacts-template.csv"
          download
          className="underline underline-offset-2 hover:text-foreground/80 "
        >
          Download the template CSV
        </a>
        .
      </p>
      <ImportForm bookNames={bookNames} />
    </main>
  );
}
