import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnBook, getOwnProfile } from "@/lib/queries/books";
import { BookForm } from "./book-form";

export default async function SettingsPage() {
  const claims = await requireUser();
  const [book, profile] = await Promise.all([
    getOwnBook(claims),
    getOwnProfile(claims),
  ]);
  if (!book) redirect("/onboarding");

  const urlPrefix = `${process.env.APP_URL}/b/`;
  const defaults = {
    display_name: profile?.displayName ?? "",
    slug: book.slug,
    partner_name: book.enabledFields.partner_name,
    kids_names: book.enabledFields.kids_names,
    birthday: book.enabledFields.birthday,
    sender_country: book.senderCountry,
  };
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm  sm:p-8">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          Address book settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your details while previewing exactly what friends will see.
        </p>

        <BookForm
          urlPrefix={urlPrefix}
          currentSlug={book.slug}
          defaults={defaults}
        />
      </div>
    </main>
  );
}
