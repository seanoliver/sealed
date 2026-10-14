"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { approveEmail, type ApproveState } from "./actions";

const initialState: ApproveState = {};

/** Approve one listed email, or (without `email`) any email typed in. */
export function ApproveForm({
  email,
  label,
}: {
  email?: string;
  label: string;
}) {
  const [state, formAction] = useActionState(approveEmail, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {email ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <>
          <label htmlFor="invite-email" className="sr-only">
            Email to invite
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="friend@example.com"
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/25"
          />
        </>
      )}
      <SubmitButton
        pendingLabel="Sending…"
        className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/85"
      >
        {label}
      </SubmitButton>
      {state.message ? (
        <p role="status" className="w-full text-sm text-muted-foreground">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
