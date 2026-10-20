import "server-only";
import { eq } from "drizzle-orm";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs): the public
// permalink page is unauthenticated, so there are no claims for withRls —
// this module is the ONLY reader on that surface and it selects nothing but
// the public display fields below.
import { BOOK_LINK_SHAPE } from "@/lib/book-link";
import { dbAdmin } from "@/lib/db/admin";
import { books, profiles } from "@/lib/db/schema";

/**
 * Mirror of the DB CHECK on books.slug. Anything failing this shape is
 * rejected before any query (or rate-limit row) happens.
 */
export const SLUG_SHAPE = BOOK_LINK_SHAPE;

/**
 * The COMPLETE set of book data the public surface may see. Nothing else —
 * no ids, no counts, no contact data, no timestamps. Widening this type is
 * a security decision, not a convenience.
 */
export type PublicBook = {
  ownerName: string;
  enabledFields: { partner_name: boolean; kids_names: boolean; birthday: boolean };
  senderCountry: string;
};

/**
 * Look up a book for the public /b/[slug] page. Returns null for a
 * malformed slug (no DB work) and for an unknown slug alike — the caller
 * renders a 404 either way. May throw on connection failure; callers on the
 * public surface catch and fail to a generic error page.
 */
/**
 * Check a candidate public link without exposing the occupying book. Slugs
 * are public identifiers, but owner-facing RLS cannot see another owner's
 * row, so this check deliberately runs at the same narrow public-query seam.
 */
export async function isBookSlugAvailable(slug: string): Promise<boolean> {
  if (!SLUG_SHAPE.test(slug)) return false;

  const [row] = await dbAdmin
    .select({ slug: books.slug })
    .from(books)
    .where(eq(books.slug, slug))
    .limit(1);
  return row === undefined;
}

export async function getPublicBook(slug: string): Promise<PublicBook | null> {
  if (!SLUG_SHAPE.test(slug)) return null;

  const [row] = await dbAdmin
    .select({
      ownerName: profiles.displayName,
      enabledFields: books.enabledFields,
      senderCountry: books.senderCountry,
    })
    .from(books)
    .innerJoin(profiles, eq(profiles.id, books.ownerId))
    .where(eq(books.slug, slug))
    .limit(1);

  return row ?? null;
}
