"use client";

/** Fallback for recipient pages; never shows error details, which can carry request data. */
export default function RecipientError({
  unstable_retry,
}: {
  unstable_retry: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your connection may have dropped. Try again, or reopen the link from
          your email.
        </p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-5 h-10 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
