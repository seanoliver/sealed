"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { contactInputToRow } from "@/lib/db/contact-row";
import { books, contacts } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";
import { contactSchema, withoutSamePartnerEmail } from "@/lib/validation/contact";

const importSchema = z.array(contactSchema).max(1000);

export type ImportResult =
  | { imported: number; skipped: number }
  | { error: string };

export async function importContacts(rows: unknown): Promise<ImportResult> {
  const claims = await requireUser();

  // Defense in depth: the client parsed and validated already, but the rows
  // crossed the network — re-validate every row and the cap server-side.
  const parsed = importSchema.safeParse(rows);
  if (!parsed.success) return { error: "Invalid import data." };
  if (parsed.data.length === 0) return { imported: 0, skipped: 0 };

  let result: { imported: number; skipped: number } | undefined;
  try {
    result = await withRls(claims, async (tx) => {
      // Resolve the book inside the RLS tx — never trust a client bookId.
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return undefined;

      const inserted = await tx
        .insert(contacts)
        .values(
          parsed.data.map((d) => ({
            bookId: book.id,
            ...contactInputToRow(withoutSamePartnerEmail(d)),
          })),
        )
        // Targets the partial unique index contacts_book_email_unique
        // (book_id, email) WHERE email IS NOT NULL — the `where` here is the
        // index predicate, required for ON CONFLICT to match a partial index.
        // Rows whose email already exists in the book are skipped, not
        // errors. Rows WITHOUT an email never conflict (the partial index
        // excludes NULLs), so re-importing a file duplicates its email-less
        // rows — accepted v1 behavior; dedupe by hand or via edit/delete.
        .onConflictDoNothing({
          target: [contacts.bookId, contacts.email],
          where: sql`email is not null`,
        })
        .returning({ id: contacts.id });

      return {
        imported: inserted.length,
        skipped: parsed.data.length - inserted.length,
      };
    });
  } catch (err) {
    logDbError("[im] [importContacts] bulk insert failed", err);
    return { error: "Something went wrong. Please try again." };
  }
  if (!result) return { error: "Set up your address book first." };

  // Audit decision: bulk import writes NO contact_events rows. Per-row audit
  // would mean an admin-connection loop over up to 1000 rows, and the schema
  // has no import-level event type; the uploaded CSV itself is the owner's
  // record of what came in. Documented deviation from the per-write audit
  // trail used by single-contact CRUD.

  revalidatePath("/dashboard");
  return result;
}
