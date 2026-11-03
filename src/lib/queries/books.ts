import "server-only";
import { cache } from "react";
import { eq, or, sql, type SQL } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
// Sanctioned dbAdmin import: book_members has no client write grants.
import { dbAdmin } from "@/lib/db/admin";
import { bookMembers, books, profiles } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";

/** Must match the owner-or-member RLS policies in the book_members migration. */
export function bookAccessibleBy(userId: string): SQL {
  return or(
    eq(books.ownerId, userId),
    sql`exists (select 1 from ${bookMembers} m where m.book_id = ${books.id} and m.user_id = ${userId})`,
  )!;
}

async function linkPendingMembership(claims: SessionClaims): Promise<boolean> {
  try {
    // Not claims.email: it is unconfirmed when sign-up confirmation is off,
    // which would let anyone claim an invite.
    const linked = await dbAdmin.execute<{ id: string }>(sql`
      update public.book_members m
         set user_id = u.id, linked_at = now()
        from auth.users u
       where u.id = ${claims.sub}
         and u.email_confirmed_at is not null
         and lower(m.email::text) = lower(u.email)
         and m.user_id is null
         and not exists (select 1 from public.books b where b.owner_id = u.id)
      returning m.id`);
    return linked.length > 0;
  } catch (err) {
    logDbError("[bm] [linkPendingMembership] link failed", err);
    return false;
  }
}

async function selectBook(claims: SessionClaims) {
  const [book] = await withRls(claims, (tx) =>
    tx
      .select()
      .from(books)
      .where(bookAccessibleBy(claims.sub))
      // An owned book wins over a shared one.
      .orderBy(sql`(${books.ownerId} = ${claims.sub}) desc`)
      .limit(1),
  );
  return book;
}

/** Own book, else the shared one; undefined during onboarding. */
export const getOwnBook = cache(async (claims: SessionClaims) => {
  const book = await selectBook(claims);
  if (book) return book;
  return (await linkPendingMembership(claims)) ? selectBook(claims) : undefined;
});

/** The signed-in owner's profile, created by the auth-user trigger. */
export async function getOwnProfile(claims: SessionClaims) {
  const [profile] = await withRls(claims, (tx) =>
    tx.select().from(profiles).where(eq(profiles.id, claims.sub)).limit(1),
  );
  return profile;
}
