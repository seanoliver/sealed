import { type ReactNode } from "react";

/**
 * Single generic copy for EVERY dead token — unknown, expired, and used
 * render pixel-identically so the page never confirms whether a token ever
 * existed. The submit action returns the same string for the same reason.
 */
export const INVALID_LINK_MESSAGE =
  "This link is invalid or has expired. Ask the person who sent it for a fresh one.";

export const TIMED_OUT_MESSAGE =
  "This page timed out. Open the link from your email again to pick up where you left off.";

/** Centered card used by every recipient-facing terminal state. */
export function Notice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm ">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      </div>
    </main>
  );
}

/** The one-and-only dead-link page (invalid, expired, and used alike). */
export function InvalidLinkNotice() {
  return <Notice title="Link not available">{INVALID_LINK_MESSAGE}</Notice>;
}

export function TimedOutNotice() {
  return <Notice title="Page timed out">{TIMED_OUT_MESSAGE}</Notice>;
}
