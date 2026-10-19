import Link from "next/link";

/** "Why am I getting this?" answers for recipients, collapsed under the form. */
export function WhyExplainer({ ownerName }: { ownerName: string }) {
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        Why am I getting this?
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="flex flex-col gap-3 px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
        <p>
          <strong className="font-semibold text-foreground">
            {ownerName} sent this.
          </strong>{" "}
          {ownerName} is collecting addresses for holiday cards and used Sealed
          to ask.
        </p>
        <p>
          <strong className="font-semibold text-foreground">
            Only {ownerName} sees what you enter.
          </strong>{" "}
          It isn’t sold or shared.
        </p>
        <p>
          <strong className="font-semibold text-foreground">
            Sealed is a small project
          </strong>{" "}
          built by Sean Oliver.
        </p>
        <Link href="/about" className="w-fit font-semibold text-primary hover:underline">
          More about Sealed →
        </Link>
      </div>
    </details>
  );
}
