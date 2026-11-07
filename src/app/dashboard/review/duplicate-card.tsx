"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { NameWithReading } from "@/components/name-with-reading";
import { type MergeLine, type MergePlan } from "@/lib/duplicate-merge";
import { type HouseholdMatch } from "@/lib/household-match";
import { type Readings } from "@/lib/readings";
import { dismissDuplicate, keepDuplicate } from "./actions";

export type DuplicateSide = {
  id: string;
  version: string;
  name: string;
  address: string | null;
  email: string | null;
  birthday: string | null;
  lastSent: string;
  plan: Pick<MergePlan, "carried" | "notKept">;
};

const buttonClasses =
  "inline-flex h-9 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primaryClasses =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50";

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

function Lines({ title, lines }: { title: string; lines: MergeLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="text-sm text-foreground">
      <p className="font-medium">{title}</p>
      <ul className="mt-1">
        {lines.map((line) => (
          <li key={`${line.label}-${line.value}`} className="break-words">
            {line.label}: {line.value}
          </li>
        ))}
      </ul>
    </div>
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
  const [keeping, setKeeping] = useState<"first" | "second" | null>(null);
  const [keepState, keepAction, keepPending] = useActionState(keepDuplicate, {});
  const [dismissState, dismissAction, dismissPending] = useActionState(dismissDuplicate, {});
  const pending = keepPending || dismissPending;
  const error = keepState.error ?? dismissState.error;
  const heading = HEADINGS[match];
  const keep = keeping === "first" ? first : second;
  const other = keeping === "first" ? second : first;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{heading.title}</span>
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
          {heading.chip}
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      {keeping ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">
            Keep <NameWithReading text={keep.name} readings={readings} />?
          </p>
          <Lines title={`Added from ${other.name}`} lines={keep.plan.carried} />
          <Lines title="Lost with the deleted contact" lines={keep.plan.notKept} />
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {`${other.name} will be deleted. You can't undo this. Its send history goes with it, and any link already sent to that contact stops working.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={keepAction}>
              <input type="hidden" name="keep_id" value={keep.id} />
              <input type="hidden" name="remove_id" value={other.id} />
              <input type="hidden" name="keep_version" value={keep.version} />
              <input type="hidden" name="remove_version" value={other.version} />
              <button type="submit" disabled={pending} className={primaryClasses}>
                Keep and delete the other
              </button>
            </form>
            <button type="button" onClick={() => setKeeping(null)} disabled={pending} className={buttonClasses}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([["first", first], ["second", second]] as const).map(([side, contact]) => (
              <div key={contact.id} className="flex min-w-0 flex-col rounded-lg border border-border p-3">
                <Link
                  href={`/dashboard/contacts/${contact.id}`}
                  className="text-sm font-semibold text-foreground underline-offset-2 hover:underline"
                >
                  <NameWithReading text={contact.name} readings={readings} />
                </Link>
                <dl className="flex-1">
                  <Value label="Address" value={contact.address} />
                  <Value label="Email" value={contact.email} />
                  <Value label="Birthday" value={contact.birthday} />
                  <Value label="Last sent" value={contact.lastSent} />
                </dl>
                <button
                  type="button"
                  onClick={() => setKeeping(side)}
                  disabled={pending}
                  className={`${buttonClasses} mt-3 self-start`}
                >
                  Keep this one
                </button>
              </div>
            ))}
          </div>
          <form action={dismissAction}>
            <input type="hidden" name="first_id" value={first.id} />
            <input type="hidden" name="second_id" value={second.id} />
            <button type="submit" disabled={pending} className={buttonClasses}>
              Not duplicates
            </button>
          </form>
        </>
      )}
    </li>
  );
}
