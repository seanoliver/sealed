import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnBook } from "@/lib/queries/books";
import { listContacts, type SendStatus } from "@/lib/queries/contacts";
import { loadDuplicateReview, type DetectedDuplicate } from "@/lib/queries/duplicates";
import {
  listPendingSubmissions,
  type PendingSubmission,
} from "@/lib/queries/submissions";
import {
  TOKEN_UPDATE_FIELDS,
  type TokenUpdateField,
} from "@/lib/validation/contact";
import {
  CLEARABLE_FIELDS,
  DISPLAY_VALUE_MAX,
  parseSubmissionForDisplay,
  payloadNames,
  withoutInviteAddresses,
  submittedPeople,
  type EnabledFields,
  type SubmissionDisplayFields,
} from "@/lib/validation/submission";
import { countryName } from "@/lib/address";
import { birthday } from "@/lib/history";
import { planDuplicateMerge, type MergeLine } from "@/lib/duplicate-merge";
import { matchInBook, sameSlots } from "@/lib/household-match";
import { householdLine, pickStoredNames } from "@/lib/names";
import { NameWithReading } from "@/components/name-with-reading";
import { contactReadings, readingsForContact } from "@/lib/pinyin";
import { type Readings } from "@/lib/readings";
import { DuplicateCard, type DuplicateSide } from "./duplicate-card";
import { ReviewCardActions } from "./review-card-actions";

/**
 * Render-time safety (see the same note in review/actions.ts): every payload
 * value on this page is ATTACKER-CONTROLLED. Values pass through the lenient
 * display parser (unknown keys dropped, non-strings dropped, length-capped,
 * book-disabled fields removed) and are rendered EXCLUSIVELY as React text
 * nodes — default escaping applies, never dangerouslySetInnerHTML. A payload
 * that isn't a JSON object at all (scalar/array/null — pre-CHECK legacy or
 * hostile) renders as a "Malformed submission" card with only a Reject
 * button; parsing is per-submission and never throws, so one bad row can
 * never take down the page.
 */

type ReviewField = TokenUpdateField | "partner_email" | "partner_personal_email";


const REMOVED = "(removed)";

const MERGE_FIELDS: readonly ReviewField[] = [
  ...TOKEN_UPDATE_FIELDS,
  "partner_email",
  "partner_personal_email",
];

const FIELD_LABELS: Record<ReviewField, string> = {
  full_name: "Full name",
  partner_name: "Partner",
  kids_names: "Kids",
  email: "Email",
  partner_email: "Partner email",
  personal_email: "Personal email",
  partner_personal_email: "Partner personal email",
  birthday: "Birthday",
  address_line1: "Address line 1",
  address_line2: "Address line 2",
  district: "District",
  city: "City",
  state_region: "State / region",
  postal_code: "Postal code",
  country_code: "Country",
};

function forDisplay(fields: SubmissionDisplayFields): Partial<Record<ReviewField, string>> {
  const { country, ...rest } = fields;
  if (rest.country_code) return { ...rest, country_code: countryName(rest.country_code) };
  return country ? { ...rest, country_code: `${country} (not a country on the list)` } : rest;
}

/** Same cosmetic cap as the payload side, applied to current values. */
function capForDisplay(value: string): string {
  return value.length > DISPLAY_VALUE_MAX
    ? `${value.slice(0, DISPLAY_VALUE_MAX)}…`
    : value;
}

type FieldRow = { field: ReviewField; label: string; value: string };
type DiffRow = FieldRow & { current: string | null; changed: boolean };

const NAME_FIELDS: ReadonlySet<ReviewField> = new Set(["full_name", "partner_name"]);
const EMAIL_FIELDS: ReadonlySet<ReviewField> = new Set(["email", "partner_email"]);

type CardModel = { id: string; submittedAtLabel: string; readings: Readings } & (
  | { kind: "malformed" }
  | { kind: "new"; fields: FieldRow[]; nameMatch?: { name: string; address: string | null; comparable: boolean } }
  | {
      kind: "merge";
      contactName: string;
      rows: DiffRow[];
      comparing?: string;
    }
);

type BookContact = NonNullable<PendingSubmission["matchedContact"]>;

const addressLine = (contact: BookContact) =>
  [contact.addressLine1, contact.city, contact.stateRegion, contact.postalCode]
    .filter((part) => part !== null)
    .join(", ") || null;

const DUPLICATES_SHOWN = 50;

const SEND_LABELS: Record<SendStatus, string> = {
  none: "Never",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Failed",
  unconfirmed: "Unconfirmed",
};

const birthdayText = (value: string) => birthday(value, { year: true }) ?? value;

const readableLines = (lines: readonly MergeLine[]) =>
  lines.map((line) => (line.label === "Birthday" ? { ...line, value: birthdayText(line.value) } : line));

function duplicateSide(
  contact: BookContact & { version: string },
  other: BookContact,
  lastSent: SendStatus,
): DuplicateSide {
  const plan = planDuplicateMerge(contact, other);
  return {
    id: contact.id,
    version: contact.version,
    name: householdLine(pickStoredNames(contact)),
    address: addressLine(contact),
    email: contact.email,
    birthday: contact.birthday && birthdayText(contact.birthday),
    lastSent: SEND_LABELS[lastSent],
    plan: { carried: readableLines(plan.carried), notKept: readableLines(plan.notKept) },
  };
}

async function toDuplicateModel(
  { first, second, match }: DetectedDuplicate,
  sends: ReadonlyMap<string, SendStatus>,
) {
  return {
    key: `${first.id}:${second.id}`,
    match,
    first: duplicateSide(first, second, sends.get(first.id) ?? "none"),
    second: duplicateSide(second, first, sends.get(second.id) ?? "none"),
    readings: { ...(await readingsForContact(first)), ...(await readingsForContact(second)) },
  };
}

async function toCardModel(
  { submission, matchedContact: linkedContact }: PendingSubmission,
  enabled: EnabledFields,
  { contacts, compare }: { contacts: readonly BookContact[]; compare?: string },
): Promise<CardModel> {
  const base = {
    readings: {},
    id: submission.id,
    submittedAtLabel: submission.createdAt.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  };

  // Lenient parse + gate; null ⇒ non-object payload ⇒ reject-only card.
  const display = parseSubmissionForDisplay(
    submission.source === "token" ? submission.payload : withoutInviteAddresses(submission.payload),
    enabled,
  );
  if (display === null) return { ...base, kind: "malformed" };
  const parsed = forDisplay(display);

  // Value-bearing fields only (legit payloads never store "", and a hostile
  // empty string carries no information worth a row).
  const present = (fields: readonly ReviewField[]) =>
    fields.filter((field) => parsed[field] !== undefined && parsed[field] !== "");

  const people = submittedPeople(submission.payload, enabled);
  // Worked out here, on the owner's read, so the public submit path never sees it.
  const names =
    submission.source === "permalink" && !linkedContact
      ? payloadNames(submission.payload, enabled)
      : null;
  const [best] = names ? matchInBook(names, contacts) : [];
  const namedContact = best && contacts.find((contact) => contact.id === best.id);
  const comparable = namedContact && names ? sameSlots(namedContact, names) : false;
  const comparing = comparable && compare === submission.id ? namedContact : undefined;
  const matchedContact = linkedContact ?? comparing ?? null;
  if (!matchedContact) {
    return {
      ...base,
      readings: await contactReadings({ people }),
      kind: "new",
      nameMatch: namedContact && {
        name: householdLine(pickStoredNames(namedContact)),
        address: addressLine(namedContact),
        comparable,
      },
      fields: present(TOKEN_UPDATE_FIELDS).map((field) => ({
        field,
        label: FIELD_LABELS[field],
        // `?? ""` is unreachable (present filter) but keeps types exact.
        value: parsed[field] ?? "",
      })),
    };
  }

  const currentByField: Record<ReviewField, string | null> = {
    full_name: matchedContact.fullName,
    partner_name: matchedContact.partnerName,
    kids_names: matchedContact.kidsNames,
    email: matchedContact.email,
    partner_email: matchedContact.partnerEmail,
    personal_email: matchedContact.personalEmail,
    partner_personal_email: matchedContact.partnerPersonalEmail,
    birthday: matchedContact.birthday,
    address_line1: matchedContact.addressLine1,
    address_line2: matchedContact.addressLine2,
    district: matchedContact.district,
    city: matchedContact.city,
    state_region: matchedContact.stateRegion,
    postal_code: matchedContact.postalCode,
    country_code: matchedContact.countryCode && countryName(matchedContact.countryCode),
  };

  return {
    ...base,
    readings: await readingsForContact(matchedContact, { extra: people }),
    kind: "merge",
    contactName: matchedContact.fullName,
    comparing: comparing?.id,
    rows: [
      ...present(MERGE_FIELDS),
      ...(submission.source === "token"
        ? MERGE_FIELDS.filter(
            (field) =>
              parsed[field] === "" &&
              currentByField[field] !== null &&
              (CLEARABLE_FIELDS as readonly string[]).includes(field),
          )
        : []),
    ]
      // A name match never brings an email; approveMergeAs drops these too.
      .filter((field) => !(comparing && EMAIL_FIELDS.has(field)))
      .map((field) => {
      const value = parsed[field] || REMOVED;
      const current =
        currentByField[field] === null
          ? null
          : capForDisplay(currentByField[field]);
      return {
        field,
        label: FIELD_LABELS[field],
        value,
        current,
        // Both sides are display-capped, so the comparison is symmetric.
        changed: value !== (current ?? ""),
      };
    }),
  };
}

const cardClasses = "rounded-xl border border-border bg-card p-6 shadow-sm ";
const valueClasses = "break-words text-sm text-foreground";
const sectionHeadingClasses =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string | string[] }>;
}) {
  const claims = await requireUser();
  const book = await getOwnBook(claims);
  // Onboarding: no book yet → set one up first (same rule as the dashboard).
  if (!book) redirect("/onboarding");

  const { compare: compareParam } = await searchParams;
  const compare = Array.isArray(compareParam) ? compareParam[0] : compareParam;

  const [pending, { pairs, contacts }, sendRows] = await Promise.all([
    listPendingSubmissions(claims),
    loadDuplicateReview(claims),
    listContacts(claims),
  ]);
  const cards = await Promise.all(
    pending.map((item) => toCardModel(item, book.enabledFields, { contacts, compare })),
  );
  const sends = new Map(sendRows.map((row) => [row.id, row.sendStatus]));
  const duplicates = await Promise.all(
    pairs.slice(0, DUPLICATES_SHOWN).map((pair) => toDuplicateModel(pair, sends)),
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <h1 className="font-serif text-2xl leading-tight text-foreground">
        Review
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Detected duplicates, and people who added their details through your
        public link.
      </p>

      {duplicates.length > 0 ? (
        <section aria-labelledby="duplicates-heading" className="mt-6">
          <h2 id="duplicates-heading" className={sectionHeadingClasses}>
            Detected duplicates · {pairs.length}
          </h2>
          <ol className="mt-3 flex flex-col gap-4">
            {duplicates.map(({ key, ...pair }) => (
              <DuplicateCard key={key} {...pair} />
            ))}
          </ol>
          {pairs.length > duplicates.length ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Showing the first {duplicates.length}. Resolve these to see the rest.
            </p>
          ) : null}
        </section>
      ) : null}

      {duplicates.length > 0 && cards.length > 0 ? (
        <h2 className={`${sectionHeadingClasses} mt-8`}>Submissions · {cards.length}</h2>
      ) : null}

      {cards.length === 0 ? (
        duplicates.length > 0 ? null : (
          <p className="mt-6 rounded-xl border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground   ">
            No duplicates detected. No pending submissions.
          </p>
        )
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {cards.map((card) => (
            <li key={card.id} className={cardClasses}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {card.kind === "merge" ? (
                    <>
                      Possible update to existing contact:{" "}
                      <NameWithReading text={card.contactName} readings={card.readings} />
                    </>
                  ) : card.kind === "new"
                      ? "New contact"
                      : "Malformed submission"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Submitted {card.submittedAtLabel}
                </span>
              </div>

              {card.kind === "new" && card.nameMatch ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Possible match by name: <span className="font-medium">{card.nameMatch.name}</span>
                  {card.nameMatch.address ? `, ${card.nameMatch.address}` : ""}.
                  {card.nameMatch.comparable
                    ? null
                    : " The names sit differently, so edit that contact by hand if this is them."}
                </p>
              ) : null}
              {card.kind === "merge" && card.comparing ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Matched by name only, so this could be someone else. Any email in this reply is ignored.
                </p>
              ) : null}

              {card.kind === "malformed" ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  This submission could not be read and can only be rejected.
                </p>
              ) : card.kind === "new" ? (
                card.fields.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No recognizable fields in this submission.
                  </p>
                ) : (
                  <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {card.fields.map((row) => (
                      <div key={row.field}>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {row.label}
                        </dt>
                        <dd className={valueClasses}>
                          {NAME_FIELDS.has(row.field) ? (
                            <NameWithReading text={row.value} readings={card.readings} />
                          ) : (
                            row.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[28rem]">
                    <thead>
                      <tr className="border-b border-border ">
                        <th className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Field
                        </th>
                        <th className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Current
                        </th>
                        <th className="py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Submitted
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {card.rows.map((row) => (
                        <tr key={row.field}>
                          <td className="py-2 pr-4 text-sm text-muted-foreground">
                            {row.label}
                          </td>
                          <td className={`py-2 pr-4 ${valueClasses}`}>
                            {row.current === null ? (
                              <span className="text-muted-foreground/70">
                                —
                              </span>
                            ) : NAME_FIELDS.has(row.field) ? (
                              <NameWithReading text={row.current} readings={card.readings} />
                            ) : (
                              row.current
                            )}
                          </td>
                          <td className={`py-2 ${valueClasses}`}>
                            {row.changed ? (
                              <mark className="rounded bg-amber-100 px-1 py-0.5 text-foreground dark:bg-amber-900/60 ">
                                {NAME_FIELDS.has(row.field) ? (
                                  <NameWithReading text={row.value} readings={card.readings} />
                                ) : (
                                  row.value
                                )}
                              </mark>
                            ) : NAME_FIELDS.has(row.field) ? (
                              <NameWithReading text={row.value} readings={card.readings} />
                            ) : (
                              row.value
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <ReviewCardActions
                submissionId={card.id}
                compareHref={
                  card.kind === "new" && card.nameMatch?.comparable
                    ? `/dashboard/review?compare=${card.id}`
                    : undefined
                }
                contactId={card.kind === "merge" ? card.comparing : undefined}
                backHref={card.kind === "merge" && card.comparing ? "/dashboard/review" : undefined}
                approve={
                  card.kind === "merge"
                    ? "merge"
                    : card.kind === "new"
                      ? "new"
                      : undefined
                }
              />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
