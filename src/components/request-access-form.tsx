"use client";

import { useActionState, useState } from "react";
import {
  continueWithGoogle,
  requestAccess,
  type RequestAccessState,
} from "@/app/auth/actions";
import { SubmitButton } from "@/components/submit-button";
import {
  TurnstileWidget,
  useTurnstileResetOnError,
} from "@/components/turnstile-widget";

const initialState: RequestAccessState = { status: "idle" };

/** Remounting the form (new key) is how "Use a different email" clears the action state. */
export function RequestAccess({ error }: { error?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <RequestAccessForm
      key={attempt}
      error={attempt === 0 && error}
      onReset={() => setAttempt((n) => n + 1)}
    />
  );
}

function RequestAccessForm({
  error,
  onReset,
}: {
  error?: boolean;
  onReset: () => void;
}) {
  const [state, formAction] = useActionState(requestAccess, initialState);
  const message =
    state.status === "error"
      ? state.message
      : error
        ? "That sign-in link didn’t work. It may have expired or already been used. Enter your email to get a new one."
        : undefined;
  useTurnstileResetOnError(state.status === "error" ? state.message : undefined);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-serif text-3xl text-foreground">Your request is in</h2>
        <div
          role="status"
          className="rounded-xl border border-green-500/25 bg-green-500/10 p-4 leading-relaxed text-foreground"
        >
          Check <strong className="font-semibold">{state.email}</strong>. If
          you’ve been invited, your sign-in link is there now. If not, you’re
          on the list, and your invitation will arrive in the same inbox.
        </div>
        <button
          type="button"
          onClick={onReset}
          className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-3xl text-foreground">
          Request an invitation
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Already invited? Use the same email and we’ll send your sign-in link.
        </p>
      </div>

      {message ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {message}
        </div>
      ) : null}

      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 rounded-xl border border-input bg-background/60 px-4 text-base text-foreground shadow-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/25"
        />
        <TurnstileWidget />
        <SubmitButton
          pendingLabel="Sending…"
          className="mt-1 h-12 rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/85"
        >
          Request access
        </SubmitButton>
      </form>

      <div className="flex items-center gap-3 text-xs tracking-wider text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={continueWithGoogle}>
        <SubmitButton
          pendingLabel="Redirecting…"
          className="h-11 w-full rounded-xl border border-input bg-background/40 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Continue with Google
        </SubmitButton>
      </form>
    </div>
  );
}
