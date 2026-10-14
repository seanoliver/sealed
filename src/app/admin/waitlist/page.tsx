import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs): see actions.ts.
import { dbAdmin } from "@/lib/db/admin";
import { ApproveForm } from "./approve-form";

export const metadata: Metadata = { title: "Waitlist", robots: { index: false } };

type WaitlistRow = {
  email: string;
  status: "pending" | "approved";
  source: "email" | "google";
  requested_at: Date;
  invite_sent_at: Date | null;
};

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function WaitlistPage() {
  await requireAdmin();
  const rows = (await dbAdmin.execute(
    sql`select email, status, source, requested_at, invite_sent_at from private.list_waitlist()`,
  )) as unknown as WaitlistRow[];
  const pending = rows.filter((row) => row.status === "pending");
  const approved = rows.filter((row) => row.status === "approved");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 py-12 sm:px-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-4xl text-foreground">Waitlist</h1>
        <p className="text-muted-foreground">
          Approving an email lets it create an account and sends the invitation.
        </p>
      </div>

      <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
        <h2 id="invite-heading" className="text-lg font-semibold text-foreground">
          Invite someone directly
        </h2>
        <ApproveForm label="Invite" />
      </section>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
        <h2 id="pending-heading" className="text-lg font-semibold text-foreground">
          Waiting ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {pending.map((row) => (
              <li key={row.email} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{row.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.source === "google" ? "Google" : "Email"} ·{" "}
                    {dateFormat.format(new Date(row.requested_at))}
                  </p>
                </div>
                <ApproveForm email={row.email} label="Approve" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="approved-heading" className="flex flex-col gap-3">
        <h2 id="approved-heading" className="text-lg font-semibold text-foreground">
          Approved ({approved.length})
        </h2>
        {approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approvals yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {approved.map((row) => (
              <li key={row.email} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{row.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.invite_sent_at
                      ? `Invited ${dateFormat.format(new Date(row.invite_sent_at))}`
                      : "Invitation not sent"}
                  </p>
                </div>
                {row.invite_sent_at ? null : (
                  <ApproveForm email={row.email} label="Resend invitation" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
