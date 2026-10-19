"use client";

import { useActionState, useState } from "react";
import { TurnstileWidget, type TurnstileStatus } from "@/components/turnstile-widget";
import { type ConfirmState } from "./actions";

type Props = {
  action: (state: ConfirmState, formData: FormData) => Promise<ConfirmState>;
  ownerName: string;
  lines: string[];
  updateHref: string;
  seenAt: string;
};

export function ConfirmEnvelope({
  action,
  ownerName,
  lines,
  updateHref,
  seenAt,
}: Props) {
  const [state, formAction, pending] = useActionState(
    async (
      previous: ConfirmState,
      formData: FormData,
    ): Promise<ConfirmState> => {
      try {
        return await action(previous, formData);
      } catch {
        return { error: "The connection dropped. Tap again." };
      }
    },
    {},
  );
  const [turnstile, setTurnstile] = useState<TurnstileStatus>("checking");

  if (state.confirmed) {
    return (
      <div className="rounded-xl border border-border bg-card p-7 shadow-sm">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          You&apos;re on the list
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ownerName}&apos;s card will go to {lines[0]} at {lines[1]}. You can
          close this page.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-7 shadow-sm"
    >
      <h1 className="font-serif text-2xl leading-tight text-foreground">
        Send {ownerName}&apos;s card to this envelope?
      </h1>
      {state.error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.error}
        </div>
      ) : null}
      <div className="rounded-md border border-border bg-background px-4 pt-4 pb-6">
        <div
          aria-hidden="true"
          className="ml-auto h-11 w-9 rounded-sm border border-dashed border-border"
        />
        <address className="mt-3 pl-6 font-serif text-lg leading-relaxed not-italic text-foreground">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
      </div>
      <input type="hidden" name="seen_at" value={seenAt} />
      <TurnstileWidget resetOn={state} onStatusChange={setTurnstile} />
      <button
        type="submit"
        disabled={pending || turnstile !== "ready"}
        className="h-12 rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
      >
        {pending
          ? "Saving…"
          : turnstile === "checking"
            ? "Checking you're human…"
            : "Yes, send it here"}
      </button>
      <a
        href={updateHref}
        className="text-center text-sm font-semibold text-primary hover:underline"
      >
        Fix a name or the address
      </a>
    </form>
  );
}
