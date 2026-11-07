"use client";

import Link from "next/link";
import { useActionState } from "react";
import { NameWithReading } from "@/components/name-with-reading";
import { type HouseholdMatch } from "@/lib/household-match";
import { type Readings } from "@/lib/readings";
import { dismissDuplicate } from "./actions";

export type DuplicateSide = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  birthday: string | null;
  lastSent: string;
};

const buttonClasses =
  "inline-flex h-9 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

const HEADINGS: Record<HouseholdMatch, { title: string; chip: string }> = {
  same_people: { title: "Same people", chip: "Same names" },
  shares_person: { title: "Might be the same people", chip: "One person in common" },
};

function Value({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="mt-2 text-xs text-muted-foreground">{label}</dt>
      <dd className={`break-words text-sm ${value === null ? "text-muted-foreground/70" : "text-foreground"}`}>
        {value ?? "—"}
      </dd>
    </>
  );
}

/** Every value here is contact data, rendered as React text only. */
export function DuplicateCard({
  first,
  second,
  match,
  readings,
}: {
  first: DuplicateSide;
  second: DuplicateSide;
  match: HouseholdMatch;
  readings: Readings;
}) {
  const [state, dismissAction, pending] = useActionState(dismissDuplicate, {});
  const heading = HEADINGS[match];

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{heading.title}</span>
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
          {heading.chip}
        </span>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[first, second].map((contact) => (
          <div key={contact.id} className="flex min-w-0 flex-col rounded-lg border border-border p-3">
            <Link
              href={`/dashboard/contacts/${contact.id}`}
              className="text-sm font-semibold text-foreground underline underline-offset-2"
            >
              <NameWithReading text={contact.name} readings={readings} />
            </Link>
            <dl className="flex-1">
              <Value label="Address" value={contact.address} />
              <Value label="Email" value={contact.email} />
              <Value label="Birthday" value={contact.birthday} />
              <Value label="Last sent" value={contact.lastSent} />
            </dl>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        If these are the same people, open the one to remove and delete it.
      </p>
      <form action={dismissAction}>
        <input type="hidden" name="first_id" value={first.id} />
        <input type="hidden" name="second_id" value={second.id} />
        <button type="submit" disabled={pending} className={buttonClasses}>
          Not duplicates
        </button>
      </form>
    </li>
  );
}
