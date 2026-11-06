"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  BookCounts,
  ContactFilter,
  RouteCounts,
  SendRoute,
  StatusKey,
} from "@/lib/contacts-sheet";
import { chipBase, chipLabels, chipStyles } from "./status-chip-styles";

const HIDDEN_STORAGE_KEY = "sealed.contacts.summary-hidden.v1";

function useSummaryHidden() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let value: string | null = null;
    // Storage throws when blocked; the card must still render without it.
    try {
      value = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage only exists after hydration
    if (value === "on") setHidden(true);
  }, []);

  function setStored(next: boolean) {
    setHidden(next);
    try {
      window.localStorage.setItem(HIDDEN_STORAGE_KEY, next ? "on" : "off");
    } catch {}
  }

  return { hidden, setHidden: setStored };
}

// A status chip says "Not sent" for a failure and puts the reason beside it;
// a count needs a name of its own to stand apart from the unsent rows.
const statusLabel = (status: StatusKey) =>
  status === "failed" ? "Send failed" : chipLabels[status];

const countClasses =
  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

const linkClasses =
  "cursor-pointer text-xs text-foreground underline underline-offset-2 hover:text-foreground/80";

type OnFilter = (filter: ContactFilter, label: string) => void;

function CountButton({
  filter,
  label,
  count,
  active,
  onFilter,
  className = "",
  children,
}: {
  filter: ContactFilter;
  label: string;
  count: number;
  active: ContactFilter | null;
  onFilter: OnFilter;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active === filter}
      disabled={count === 0}
      onClick={() => onFilter(filter, label)}
      className={`${countClasses} ${className}`}
    >
      {children}
      <span className="font-semibold tabular-nums">{count}</span>
    </button>
  );
}

function RouteColumn({
  title,
  route,
  filter,
  label,
  counts,
  active,
  onFilter,
  statusesClassName = "",
  children,
}: {
  title: string;
  route: SendRoute;
  filter: ContactFilter;
  label: string;
  counts: RouteCounts;
  active: ContactFilter | null;
  onFilter: OnFilter;
  statusesClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <CountButton
        filter={filter}
        label={label}
        count={counts.total}
        active={active}
        onFilter={onFilter}
        className="font-semibold"
      >
        {title}
      </CountButton>
      <div className={statusesClassName}>
        {counts.statuses.map(({ status, count }) => {
          const statusFilter: ContactFilter = `${route}:${status}`;
          return (
            <CountButton
              key={status}
              filter={statusFilter}
              label={`${label}: ${statusLabel(status)}`}
              count={count}
              active={active}
              onFilter={onFilter}
            >
              {active === statusFilter ? (
                statusLabel(status)
              ) : (
                <span className={`${chipBase} ${chipStyles[status]}`}>
                  {statusLabel(status)}
                </span>
              )}
            </CountButton>
          );
        })}
      </div>
      {children}
    </div>
  );
}

export function BookSummary({
  book,
  searching,
  active,
  onFilter,
}: {
  book: BookCounts;
  searching: boolean;
  active: ContactFilter | null;
  onFilter: OnFilter;
}) {
  const { hidden, setHidden } = useSummaryHidden();
  const withoutAddress = book.contacts - book.withAddress;
  const contacts = `${book.contacts} ${book.contacts === 1 ? "contact" : "contacts"}`;
  const envelopes = `${book.contacts} ${book.contacts === 1 ? "envelope" : "envelopes"}`;

  if (hidden) {
    return (
      <section
        aria-label="Book summary"
        className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
      >
        <span>
          <span className="font-medium text-foreground">{contacts}</span> · {envelopes} ·{" "}
          {book.toEmail.total} to email · {book.askManually.total} ask manually
        </span>
        <button type="button" onClick={() => setHidden(false)} className={linkClasses}>
          Show
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Book summary"
      className="mt-4 grid gap-3 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {searching ? "Whole book, not this search." : "Whole book."} Tap a number to filter.
        </span>
        <button type="button" onClick={() => setHidden(true)} className={linkClasses}>
          Hide
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-[14rem_1fr_12rem] md:gap-6">
        <div className="grid content-start gap-2">
          <div>
            <p className="font-serif text-2xl leading-tight text-foreground">{contacts}</p>
            <p className="text-xs text-muted-foreground">
              {envelopes}: {book.withAddress} with an address, {withoutAddress} without
            </p>
          </div>
          <div className="hidden flex-col gap-1 md:flex">
            <MissingFilters
              book={book}
              withoutAddress={withoutAddress}
              active={active}
              onFilter={onFilter}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:contents">
          <RouteColumn
            title="To email"
            route="email"
            filter="to_email"
            label="to email"
            counts={book.toEmail}
            active={active}
            onFilter={onFilter}
            statusesClassName="md:grid md:grid-cols-[repeat(auto-fill,11rem)] md:gap-x-4"
          />
          <RouteColumn
            title="Ask manually"
            route="manual"
            filter="no_email"
            label="to ask manually"
            counts={book.askManually}
            active={active}
            onFilter={onFilter}
          >
            <p className="mt-1 px-1.5 text-xs text-muted-foreground">
              {book.askManually.withAddress} already{" "}
              {book.askManually.withAddress === 1 ? "has" : "have"} an address.
            </p>
          </RouteColumn>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:hidden">
        <MissingFilters
          book={book}
          withoutAddress={withoutAddress}
          active={active}
          onFilter={onFilter}
        />
      </div>
    </section>
  );
}

function MissingFilters({
  book,
  withoutAddress,
  active,
  onFilter,
}: {
  book: BookCounts;
  withoutAddress: number;
  active: ContactFilter | null;
  onFilter: OnFilter;
}) {
  const pills = [
    ["no_address", "No mailing address", "with no mailing address", withoutAddress],
    ["no_email", "No email", "with no email", book.askManually.total],
  ] as const;
  return pills.map(([filter, text, label, count]) => (
    <button
      key={filter}
      type="button"
      aria-pressed={active === filter}
      disabled={count === 0}
      onClick={() => onFilter(filter, label)}
      className={`w-fit cursor-pointer rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${
        active === filter
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-secondary"
      }`}
    >
      {text} ({count})
    </button>
  ));
}
