import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs): see actions.ts.
import { dbAdmin } from "@/lib/db/admin";
import { WaitlistBoard, type WaitlistEntry } from "./waitlist-board";

export const metadata: Metadata = { title: "Waitlist", robots: { index: false } };

export default async function WaitlistPage() {
  await requireAdmin();
  const rows = await dbAdmin.execute<{
    email: string;
    status: "pending" | "approved";
    source: "email" | "google";
    requested_at: Date;
    invite_sent_at: Date | null;
  }>(
    sql`select email, status, source, requested_at, invite_sent_at from private.list_waitlist()`,
  );
  const entries: WaitlistEntry[] = rows.map((row) => ({
    email: row.email,
    status: row.status,
    source: row.source,
    requestedAt: new Date(row.requested_at).toISOString(),
    inviteSentAt: row.invite_sent_at ? new Date(row.invite_sent_at).toISOString() : null,
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 py-12 sm:px-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-4xl text-foreground">Waitlist</h1>
        <p className="text-muted-foreground">
          Approving an email lets it create an account and sends the invitation.
        </p>
      </div>
      <WaitlistBoard entries={entries} />
    </main>
  );
}
