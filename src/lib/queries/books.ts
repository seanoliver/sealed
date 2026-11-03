import "server-only";
import { cache } from "react";
import { eq, sql, type SQL } from "drizzle-orm";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
// Sanctioned dbAdmin import: book_members has no client write grants.
import { dbAdmin } from "@/lib/db/admin";
import { bookMembers, books, profiles } from "@/lib/db/schema";
import { logDbError } from "@/lib/log";

/** Must match the owner-or-member RLS policies in the book_members migration. */
export function bookAccessibleBy(userId: string): SQL {
  return sql`${books.id} in (
    select b.id from ${books} b where b.owner_id = ${userId}
    union all
    select m.book_id from ${bookMembers} m where m.user_id = ${userId})`;
}

export async function linkPendingMembership(claims: SessionClaims): Promise<boolean> {
  try {
    // Not claims.email, which a token can carry stale. The confirmed check only
    // protects while hosted Auth keeps mailer_autoconfirm off (runbook).
    const linked = await dbAdmin.execute<{ id: string }>(sql`
      with linked as (
        update public.book_members m
           set user_id = u.id, linked_at = now()
          from auth.users u
         where u.id = ${claims.sub}
           and u.email_confirmed_at is not null
           and lower(m.email::text) = lower(u.email)
           and m.user_id is null
           and not exists (select 1 from public.books b where b.owner_id = u.id)
        returning m.id, m.user_id
      ), revoked as (
        update public.agent_tokens t set revoked_at = now()
          from linked
         where t.user_id = linked.user_id and t.revoked_at is null
      )
      select id from linked`);
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
