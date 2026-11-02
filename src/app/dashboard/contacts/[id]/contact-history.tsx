import { describeEvent, eventActor, recipientName, type HistoryEntry } from "@/lib/history";
import { type ContactDetail } from "@/lib/queries/contacts";

type Props = Pick<ContactDetail, "contact" | "events">;

const dateParts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;

// Recipients write diff values: render them as React text, never as HTML.
export function ContactHistory({ contact, events }: Props) {
  return (
    <section
      aria-label="History"
      className="mt-6 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-8"
    >
      <h2 className="text-base font-semibold tracking-tight text-foreground">History</h2>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No changes yet. Edits by you, your agents, and {recipientName(contact)} will show here.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-foreground">
                  {eventActor(event, contact)}
                </span>
                <time
                  dateTime={event.createdAt.toISOString()}
                  className="text-xs text-muted-foreground tabular-nums"
                >
                  <span className="sm:hidden">
                    {event.createdAt.toLocaleString("en-US", dateParts)}
                  </span>
                  <span className="hidden sm:inline">
                    {event.createdAt.toLocaleString("en-US", { ...dateParts, year: "numeric" })}
                  </span>
                </time>
              </div>
              <EventBody entry={describeEvent(event, { countryCode: contact.countryCode })} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EventBody({ entry }: { entry: HistoryEntry }) {
  switch (entry.kind) {
    case "confirmed":
      return (
        <span className="w-fit rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
          ✓ Confirmed, no changes
        </span>
      );
    case "created":
      return (
        <dl className={listClasses}>
          <dt className="text-muted-foreground">Added</dt>
          <dd className="min-w-0">Added this contact</dd>
        </dl>
      );
    case "unknown":
      return <p className="text-sm text-muted-foreground">Details changed</p>;
    case "changed":
      return (
        <>
          {entry.undo && <p className="text-sm text-muted-foreground">Undid an earlier change</p>}
          <dl className={listClasses}>
            {entry.rows.map((row, i) => (
              <div key={`${i}:${row.label}`} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 break-words">
                  <del className="text-muted-foreground">{row.before}</del>
                  <span aria-hidden className="px-1 text-muted-foreground">
                    →
                  </span>
                  <span className="sr-only"> changed to </span>
                  <ins className="no-underline">{row.after}</ins>
                </dd>
              </div>
            ))}
          </dl>
        </>
      );
  }
}

const listClasses =
  "grid grid-cols-[6.5rem_1fr] sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm text-foreground";
