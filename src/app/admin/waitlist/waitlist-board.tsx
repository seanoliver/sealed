"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { approveEmail, type ApproveState } from "./actions";

export type WaitlistEntry = {
  email: string;
  status: "pending" | "approved";
  source: "email" | "google";
  requestedAt: string;
  invitationSentAt: string | null;
};

const initialState: ApproveState = {};

// One action state for the whole page: an approved row moves to the other
// list and remounts, so per-row state would lose the result.
export function WaitlistBoard({ entries }: { entries: WaitlistEntry[] }) {
  const [state, formAction] = useActionState(approveEmail, initialState);
  const pending = entries.filter((entry) => entry.status === "pending");
  const approved = entries.filter((entry) => entry.status === "approved");

  return (
    <div className="flex flex-col gap-10">
      {state.message ? (
        <p role="status" className="rounded-xl border border-green-500/25 bg-green-500/10 p-4 text-sm text-foreground">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <section aria-labelledby="invitation-heading" className="flex flex-col gap-3">
        <h2 id="invitation-heading" className="text-lg font-semibold text-foreground">
          Send an invitation directly
        </h2>
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <label htmlFor="invitation-email" className="sr-only">
            Email to send an invitation to
          </label>
          <input
            id="invitation-email"
            name="email"
            type="email"
            required
            placeholder="friend@example.com"
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/25"
          />
          <ActionButton label="Send invitation" />
        </form>
      </section>

      <EntryList
        title="Waiting"
        empty="Nobody is waiting."
        entries={pending}
        formAction={formAction}
      />
      <EntryList
        title="Approved"
        empty="No approvals yet."
        entries={approved}
        formAction={formAction}
      />
    </div>
  );
}

// A fixed time zone keeps server and browser renders identical.
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

function EntryList({
  title,
  empty,
  entries,
  formAction,
}: {
  title: string;
  empty: string;
  entries: WaitlistEntry[];
  formAction: (formData: FormData) => void;
}) {
  const headingId = `${title.toLowerCase()}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {title} ({entries.length})
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {entries.map((entry) => (
            <li
              key={entry.email}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-foreground">{entry.email}</p>
                <p className="text-sm text-muted-foreground">
                  {entry.status === "pending"
                    ? `${entry.source === "google" ? "Google" : "Email"} · ${dateFormat.format(new Date(entry.requestedAt))}`
                    : entry.invitationSentAt
                      ? `Invitation sent ${dateFormat.format(new Date(entry.invitationSentAt))}`
                      : "Invitation not sent"}
                </p>
              </div>
              {entry.status === "approved" && entry.invitationSentAt ? null : (
                <form action={formAction}>
                  <input type="hidden" name="email" value={entry.email} />
                  <ActionButton
                    label={entry.status === "pending" ? "Approve" : "Resend invitation"}
                  />
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionButton({ label }: { label: string }) {
  return (
    <SubmitButton
      pendingLabel="Sending…"
      className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/85"
    >
      {label}
    </SubmitButton>
  );
}
