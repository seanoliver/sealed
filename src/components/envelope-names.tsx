"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { type EnabledFields } from "@/components/recipient-fields";
import { formatPerson } from "@/lib/names";
import { cn } from "@/lib/utils";
import {
  KIDS_MAX,
  NAME_MAX,
  type HouseholdFieldErrors,
  type HouseholdValues,
} from "@/lib/validation/household";

/** `added`: created by "+ Add" this visit. `follows`: the last name tracks the first person's until edited. */
export type Person = { key: number; first: string; last: string; added?: boolean; follows?: boolean };

/** The recipient's household while they edit it. Keys keep chips stable as people come and go. */
export type HouseholdDraft = { primary: Person; partner: Person | null; kids: Person[] };

export function draftFromValues(values: HouseholdValues): HouseholdDraft {
  return {
    primary: { key: 0, first: values.first_name, last: values.last_name },
    partner: values.partner
      ? { key: 1, ...values.partner, follows: values.partner.last === values.last_name }
      : null,
    kids: values.kids.map((kid, i) => ({ key: i + 2, ...kid, follows: kid.last === values.last_name })),
  };
}

export function valuesFromDraft(draft: HouseholdDraft): HouseholdValues {
  return {
    first_name: draft.primary.first,
    last_name: draft.primary.last,
    partner: draft.partner ? { first: draft.partner.first, last: draft.partner.last } : null,
    kids: draft.kids.map(({ first, last }) => ({ first, last })),
  };
}

// Saved people post even when blank, so the server's required-name error comes back instead of a silent removal.
const isAbandoned = (person: Person) => person.added === true && person.first.trim() === "";

/** Drops people added this visit and left without a first name, so an abandoned "+ Add" never posts a blank row. */
export function pruneDraft(draft: HouseholdDraft): HouseholdDraft {
  return {
    ...draft,
    partner: draft.partner && !isAbandoned(draft.partner) ? draft.partner : null,
    kids: draft.kids.filter((kid) => !isAbandoned(kid)),
  };
}

export function personWithError(
  draft: HouseholdDraft,
  errors: HouseholdFieldErrors | undefined,
): number | null {
  if (!errors) return null;
  if (errors.first_name || errors.last_name) return draft.primary.key;
  if ((errors.partner_first_name || errors.partner_last_name) && draft.partner) {
    return draft.partner.key;
  }
  const posted = pruneDraft(draft).kids;
  const kid = posted.findIndex((_, i) => errors[`kids.${i}.first`] || errors[`kids.${i}.last`]);
  return kid === -1 ? null : posted[kid].key;
}

/** What the form posts: the same keys the household builder posts, read by parseHouseholdForm. */
export function HouseholdInputs({
  draft,
  enabled,
}: {
  draft: HouseholdDraft;
  enabled: Pick<EnabledFields, "partner_name" | "kids_names">;
}) {
  return (
    <>
      <input type="hidden" name="first_name" value={draft.primary.first} />
      <input type="hidden" name="last_name" value={draft.primary.last} />
      {enabled.partner_name ? <input type="hidden" name="partner_section" value="1" /> : null}
      {enabled.partner_name && draft.partner ? (
        <>
          <input type="hidden" name="partner_first_name" value={draft.partner.first} />
          <input type="hidden" name="partner_last_name" value={draft.partner.last} />
        </>
      ) : null}
      {enabled.kids_names ? <input type="hidden" name="kids_section" value="1" /> : null}
      {enabled.kids_names
        ? draft.kids.map((kid) => (
            <Fragment key={kid.key}>
              <input type="hidden" name="kid_first" value={kid.first} />
              <input type="hidden" name="kid_last" value={kid.last} />
            </Fragment>
          ))
        : null}
    </>
  );
}

export const envelopeInputClasses =
  "h-11 w-full min-w-0 rounded-md border-2 border-primary/60 bg-card px-2.5 font-serif text-lg text-foreground shadow-sm outline-none transition-colors placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25";
export const envelopeLabelClasses = "font-sans text-xs font-medium text-muted-foreground";
const errorClasses = "font-sans text-xs text-destructive";
const addClasses =
  "inline-flex h-11 items-center gap-1 rounded-full border-[1.5px] border-dashed border-primary/60 px-3.5 font-sans text-sm font-medium text-primary transition-colors hover:bg-accent";

export type Role = { kind: "primary" } | { kind: "partner" } | { kind: "kid"; index: number };

function roleOf(draft: HouseholdDraft, key: number): Role | null {
  if (draft.primary.key === key) return { kind: "primary" };
  if (draft.partner?.key === key) return { kind: "partner" };
  const index = draft.kids.findIndex((kid) => kid.key === key);
  return index === -1 ? null : { kind: "kid", index };
}

function personOf(draft: HouseholdDraft, role: Role): Person | null {
  if (role.kind === "primary") return draft.primary;
  if (role.kind === "partner") return draft.partner;
  return draft.kids[role.index] ?? null;
}

function withPerson(draft: HouseholdDraft, role: Role, person: Person): HouseholdDraft {
  if (role.kind === "primary") {
    const follow = (other: Person) => (other.follows ? { ...other, last: person.last } : other);
    return { primary: person, partner: draft.partner && follow(draft.partner), kids: draft.kids.map(follow) };
  }
  if (role.kind === "partner") return { ...draft, partner: person };
  return { ...draft, kids: draft.kids.map((kid, i) => (i === role.index ? person : kid)) };
}

function roleErrors(
  draft: HouseholdDraft,
  role: Role,
  key: number,
  errors: HouseholdFieldErrors,
): { first?: string; last?: string } {
  if (role.kind === "primary") return { first: errors.first_name, last: errors.last_name };
  if (role.kind === "partner") {
    return { first: errors.partner_first_name, last: errors.partner_last_name };
  }
  // The server's kids.N errors index the posted list, which skips abandoned rows.
  const index = pruneDraft(draft).kids.findIndex((kid) => kid.key === key);
  if (index === -1) return {};
  return { first: errors[`kids.${index}.first`], last: errors[`kids.${index}.last`] };
}

/** Who is editing: the person a link went to, or the book's owner. */
export type Recipient = "primary" | "partner" | "owner";

function isRecipient(role: Role, recipient: Recipient): boolean {
  return role.kind === recipient;
}

function rolePrefix(role: Role, crowded: boolean, recipient: Recipient): string {
  if (role.kind === "kid") return `Child ${role.index + 1}'s `;
  if (recipient === "owner") return role.kind === "partner" ? "Partner's " : "";
  if (isRecipient(role, recipient)) return crowded ? "Your " : "";
  // Only a partner's link reaches here for the first person, so it is labelled even when alone.
  return role.kind === "partner" ? "Second person's " : "First person's ";
}

// The server writes only the replier's own email, so removing anyone else's chip would leave their email under another name.
export function isRemovable(role: Role, recipient: Recipient): boolean {
  if (role.kind === "primary") return false;
  if (role.kind === "partner") return recipient !== "partner";
  return true;
}

const chipName = (person: Person) =>
  formatPerson({ first: person.first.trim(), last: person.last.trim() }) ?? "No name yet";

type NamesEditorProps = {
  draft: HouseholdDraft;
  onChange: (draft: HouseholdDraft) => void;
  enabled: Pick<EnabledFields, "partner_name" | "kids_names">;
  /** Who is editing: a partner's link opens on the second person. */
  recipient: Recipient;
  editing: number | null;
  onEdit: (key: number | null) => void;
  newKey: () => number;
  errors?: HouseholdFieldErrors;
  onDone: () => void;
};

export function NamesEditor({
  draft,
  onChange,
  enabled,
  recipient,
  editing,
  onEdit,
  newKey,
  errors = {},
  onDone,
}: NamesEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const people = [
    draft.primary,
    ...(enabled.partner_name && draft.partner ? [draft.partner] : []),
    ...(enabled.kids_names ? draft.kids : []),
  ];
  const crowded = people.length > 1;

  useEffect(() => {
    if (editing === null) return;
    const person = rootRef.current?.querySelector(`[data-person="${editing}"]`);
    (
      person?.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ??
      person?.querySelector<HTMLInputElement>("input")
    )?.focus({ preventScroll: true });
  }, [editing]);

  function edit(key: number | null, next: HouseholdDraft = draft) {
    const pruned = pruneDraft(next);
    if (pruned !== next) onChange(pruned);
    setAdding(null);
    onEdit(key);
  }

  function remove(person: Person) {
    const role = roleOf(draft, person.key);
    if (!role || !isRemovable(role, recipient)) return;
    if (role.kind === "partner") {
      onChange({ ...draft, partner: null });
    } else {
      onChange({ ...draft, kids: draft.kids.filter((kid) => kid.key !== person.key) });
    }
    if (editing === person.key) onEdit(null);
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>("[data-person] button, [data-add]")?.focus(),
    );
  }

  function add(kind: "partner" | "kid") {
    const person: Person = { key: newKey(), first: "", last: draft.primary.last, added: true, follows: true };
    const next =
      kind === "partner"
        ? { ...pruneDraft(draft), partner: person }
        : { ...pruneDraft(draft), kids: [...pruneDraft(draft).kids, person] };
    onChange(next);
    setAdding(person.key);
    onEdit(person.key);
  }

  const canAddPartner = enabled.partner_name && !draft.partner;
  const canAddKid = enabled.kids_names && draft.kids.length < KIDS_MAX;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Names on the envelope"
      className="flex w-full flex-col gap-2 font-sans"
    >
      <div className="flex flex-wrap items-center gap-2">
        {people.map((person) => {
          const role = roleOf(draft, person.key);
          if (!role) return null;
          if (person.key !== editing) {
            const removable = isRemovable(role, recipient);
            return (
              <span
                key={person.key}
                data-person={person.key}
                className="inline-flex h-11 items-center rounded-full border border-border bg-card text-sm text-foreground shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => edit(person.key)}
                  aria-label={`Edit ${chipName(person)}`}
                  className={cn("h-full rounded-full pl-3.5 hover:text-primary", removable ? "pr-1" : "pr-3.5")}
                >
                  {chipName(person)}
                </button>
                {removable ? (
                  <button
                    type="button"
                    onClick={() => remove(person)}
                    aria-label={`Remove ${chipName(person)}`}
                    className="grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <span className="grid size-6 place-items-center rounded-full bg-muted">
                      <X className="size-3.5" aria-hidden="true" />
                    </span>
                  </button>
                ) : null}
              </span>
            );
          }
          const current = personOf(draft, role) ?? person;
          const prefix = rolePrefix(role, crowded, recipient);
          const fieldErrors = roleErrors(draft, role, person.key, errors);
          const ids =
            role.kind === "primary"
              ? ["first_name", "last_name"]
              : role.kind === "partner"
                ? ["partner_first", "partner_last"]
                : [`kid_${role.index}_first`, `kid_${role.index}_last`];
          const set = (patch: Partial<Person>) =>
            onChange(withPerson(draft, role, { ...current, ...patch }));
          return (
            <div key={person.key} data-person={person.key} className="flex basis-full flex-col gap-1.5">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                {(["first", "last"] as const).map((part, i) => {
                  const label = `${prefix}${part} name`;
                  const error = fieldErrors[part];
                  return (
                    <div key={part} className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={ids[i]} className={envelopeLabelClasses}>
                        {label.charAt(0).toUpperCase() + label.slice(1)}
                      </label>
                      <input
                        id={ids[i]}
                        type="text"
                        autoComplete={isRecipient(role, recipient) ? (part === "first" ? "given-name" : "family-name") : "off"}
                        maxLength={NAME_MAX}
                        value={current[part]}
                        onChange={(event) =>
                          set(
                            part === "first"
                              ? { first: event.target.value }
                              : { last: event.target.value, follows: false },
                          )
                        }
                        enterKeyHint={part === "first" ? "next" : "done"}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          if (part === "first") document.getElementById(ids[1])?.focus();
                          else if (adding === person.key) edit(null);
                          else onDone();
                        }}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${ids[i]}-error` : undefined}
                        className={cn(envelopeInputClasses, error && "border-destructive")}
                      />
                      {error ? (
                        <p id={`${ids[i]}-error`} className={errorClasses}>
                          {error}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {adding === person.key ? (
                <button
                  type="button"
                  onClick={() => edit(null)}
                  className="h-11 self-start rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground"
                >
                  Add
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {canAddPartner || canAddKid ? (
        <div className="flex flex-wrap gap-2">
          {canAddPartner ? (
            <button type="button" data-add onClick={() => add("partner")} className={addClasses}>
              <Plus className="size-4" aria-hidden="true" />
              Add a person
            </button>
          ) : null}
          {canAddKid ? (
            <button type="button" data-add onClick={() => add("kid")} className={addClasses}>
              <Plus className="size-4" aria-hidden="true" />
              Add kids
            </button>
          ) : null}
        </div>
      ) : null}
      {errors.kids ? <p className={errorClasses}>{errors.kids}</p> : null}
    </div>
  );
}
