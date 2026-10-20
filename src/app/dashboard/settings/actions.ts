"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { books, profiles } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { getOwnBook } from "@/lib/queries/books";
import { bookSchema, senderCountrySchema } from "@/lib/validation/book";

export type BookFormValues = {
  display_name: string;
  slug: string;
  partner_name: boolean;
  kids_names: boolean;
  birthday: boolean;
  sender_country: string;
};

export type SaveBookState = {
  error?: string;
  saved?: boolean;
  /**
   * Submitted values, echoed back on error. React 19 resets uncontrolled
   * inputs to their defaultValue after a form action completes — the form
   * uses these as defaults so a failed save doesn't wipe the user's input.
   */
  values?: BookFormValues;
};

export async function saveBook(
  _prevState: SaveBookState,
  formData: FormData,
): Promise<SaveBookState> {
  const claims = await requireUser();
  // Settings updates an established address book; onboarding is the only
  // creation path, including for direct invocations of this server action.
  if (!(await getOwnBook(claims))) redirect("/onboarding");

  const submitted: BookFormValues = {
    display_name: String(formData.get("display_name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    // Unchecked checkboxes are absent from FormData; checked ones post "on".
    partner_name: formData.get("partner_name") === "on",
    kids_names: formData.get("kids_names") === "on",
    birthday: formData.get("birthday") === "on",
    sender_country: String(formData.get("sender_country") ?? ""),
  };

  const parsed = bookSchema.safeParse(submitted);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      values: submitted,
    };
  }
  const senderCountry = senderCountrySchema.safeParse(submitted.sender_country);
  if (!senderCountry.success) {
    return {
      error: senderCountry.error.issues[0]?.message ?? "Invalid input",
      values: submitted,
    };
  }
  const { display_name, slug, partner_name, kids_names, birthday } = parsed.data;
  const enabledFields = { partner_name, kids_names, birthday };

  try {
    await withRls(claims, async (tx) => {
      // Profile and book are one settings operation: neither public identity
      // nor field configuration can be left half-updated. Update the book
      // first and fail the transaction if it disappeared after the guard.
      const updated = await tx
        .update(books)
        .set({ slug, enabledFields, senderCountry: senderCountry.data })
        .where(eq(books.ownerId, claims.sub))
        .returning({ id: books.id });
      if (updated.length === 0) throw new Error("Address book not found");

      await tx
        .update(profiles)
        .set({ displayName: display_name })
        .where(eq(profiles.id, claims.sub));
    });
  } catch (err) {
    if (isUniqueViolation(err, "books_slug_key")) {
      return { error: "That link name is taken", values: submitted };
    }
    logDbError("[bk] [saveBook] upsert failed", err);
    return {
      error: "Something went wrong. Please try again.",
      values: submitted,
    };
  }

  // No /b/[slug] revalidation needed: the public permalink page renders
  // dynamically on every request (it reads headers() for rate limiting), so
  // a slug change takes effect immediately — the old link 404s, the new one
  // works.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  return { saved: true };
}
