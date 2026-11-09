import "server-only";
import { sql } from "drizzle-orm";
// Sanctioned dbAdmin import: callers pass a book id they already read under RLS.
import { dbAdmin } from "@/lib/db/admin";

export interface BookSender {
  name: string;
  replyTo: string[];
}

export async function loadBookSender(bookId: string, ownerId: string): Promise<BookSender> {
  const { rows } = await dbAdmin.execute<{ display_name: string | null; email: string | null; is_owner: boolean }>(sql`
    select p.display_name, u.email, true as is_owner
      from public.profiles p join auth.users u on u.id = p.id
     where p.id = ${ownerId}
    union all
    select null, u.email, false
      from public.book_members m join auth.users u on u.id = m.user_id
     where m.book_id = ${bookId}
  `);
  const list = [...rows];
  const owner = list.find((row) => row.is_owner);
  const replyTo = [...new Set(list.flatMap((row) => (row.email ? [row.email] : [])))];
  return { name: owner?.display_name?.trim() ?? "", replyTo };
}
