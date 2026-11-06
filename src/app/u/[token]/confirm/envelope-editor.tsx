"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { AddressFields, type AddressFieldsHandle, type AddressPreview } from "@/components/address-fields";
import {
  changedLineCount,
  DoneButton,
  EnterHints,
  EnvelopeCard,
  EnvelopeCountry,
  openFields,
  Paper,
  useEnvelopeEditing,
  useFormChanges,
} from "@/components/envelope-card";
import {
  draftFromValues,
  envelopeInputClasses,
  envelopeLabelClasses,
  HouseholdInputs,
  pruneDraft,
  type Recipient,
} from "@/components/envelope-names";
import { envelopeRows } from "@/components/envelope-rows";
import { type EnabledFields } from "@/components/recipient-fields";
import { TurnstileWidget, type TurnstileStatus } from "@/components/turnstile-widget";
import { ownerVerb } from "@/lib/owner-name";
import { cn } from "@/lib/utils";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";
import { type TokenUpdateState } from "../actions";
import { type ConfirmState } from "./actions";
import { whatChanged, type Change, type ReplySnapshot } from "./what-changed";

type Saved = { lines: { text: string; changed: boolean }[]; changes: Change[] };

type EditorState = {
  error?: string;
  done?: true;
  fieldErrors?: TokenUpdateState["fieldErrors"];
};

type Props = {
  confirm: (state: ConfirmState, formData: FormData) => Promise<ConfirmState>;
  save: (state: TokenUpdateState, formData: FormData) => Promise<TokenUpdateState>;
  ownerName: string;
  senderNames: string;
  defaults: TokenUpdateValues;
  household: HouseholdValues;
  recipient: Recipient;
  enabled: EnabledFields;
  senderCountry: string;
  legacyCountry: string | null;
  seenAt: string;
  expiresAt: string;
};

function Postmark({ date }: { date: string }) {
  return (
    <svg
      viewBox="0 0 120 66"
      aria-hidden="true"
      className="postmark pointer-events-none absolute top-1.5 right-8 h-16 w-28 text-foreground/60"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="34" cy="33" r="26" />
      <text x="34" y="30" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7" fontWeight="600" letterSpacing="1">
        SEALED
      </text>
      <text x="34" y="42" textAnchor="middle" fill="currentColor" stroke="none" fontSize="6.5" fontWeight="600" letterSpacing="0.6">
        {date}
      </text>
      <path d="M64 22 q7 -5 14 0 t14 0 t14 0 t14 0" />
      <path d="M64 33 q7 -5 14 0 t14 0 t14 0 t14 0" />
      <path d="M64 44 q7 -5 14 0 t14 0 t14 0 t14 0" />
    </svg>
  );
}

function ChangeItem({ change }: { change: Change }) {
  const strong = (text: string) => <strong className="font-semibold text-foreground">{text}</strong>;
  switch (change.kind) {
    case "added":
      return <>Added {strong(change.name)}</>;
    case "removed":
      return <>Removed {strong(change.name)}</>;
    case "renamed":
      return (
        <>
          <span className="text-muted-foreground line-through">{change.from}</span> → {strong(change.to)}
        </>
      );
    case "address":
      return (
        <span className="flex flex-col">
          {change.from ? <span className="text-muted-foreground line-through">{change.from}</span> : null}
          <span>{change.to || "No address"}</span>
        </span>
      );
    case "email":
      return change.to ? <>Email: {strong(change.to)}</> : <>Removed your email</>;
    case "birthday":
      return change.to ? <>Birthday: {strong(change.to)}</> : <>Removed your birthday</>;
  }
}

function SavedView({ ownerName, saved, expiresAt }: { ownerName: string; saved: Saved; expiresAt: string }) {
  const until = new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const [date] = useState(() =>
    new Date()
      .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      .toUpperCase(),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-5">
      <h1 ref={headingRef} tabIndex={-1} className="font-serif text-[1.65rem] leading-tight text-foreground outline-none">
        Saved. Your card goes here.
      </h1>
      <Paper
        from={ownerName}
        className="envelope-rise"
        stamp={
          <span className="stamp-land absolute inset-0.5 grid place-items-center rounded-[2px] bg-primary font-serif text-base font-semibold text-primary-foreground outline-2 -outline-offset-[3px] outline-background outline-dotted">
            S
          </span>
        }
      >
        <Postmark date={date} />
        <address
          aria-label="Your envelope"
          className="mt-4 flex flex-col items-start gap-0.5 pl-6 font-serif text-lg leading-relaxed not-italic text-foreground"
        >
          {saved.lines.map((line, i) => (
            <span
              key={i}
              data-changed={line.changed || undefined}
              className={cn("block", line.changed && "-mx-1 rounded bg-accent px-1 text-accent-foreground")}
            >
              {line.text}
            </span>
          ))}
        </address>
      </Paper>
      {saved.changes.length > 0 ? (
        <section
          aria-labelledby="what-changed"
          className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground"
        >
          <h2 id="what-changed" className="mb-1 font-semibold">
            What changed
          </h2>
          <ul className="flex flex-col gap-1">
            {saved.changes.map((change, i) => (
              <li key={i}>
                <ChangeItem change={change} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          You confirmed this address. Nothing changed.
        </p>
      )}
      <p className="text-center text-sm leading-relaxed text-muted-foreground">
        Need to change something later? This link keeps working until {until}.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="h-11 self-center rounded-lg px-4 text-sm font-semibold text-primary transition-colors hover:bg-accent"
      >
        Edit again
      </button>
    </div>
  );
}

export function EnvelopeEditor({
  confirm,
  save,
  ownerName,
  senderNames,
  defaults,
  household,
  recipient,
  enabled,
  senderCountry,
  legacyCountry,
  seenAt,
  expiresAt,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const addressRef = useRef<AddressFieldsHandle>(null);
  const before = useRef<{ lines: string[]; address: string[] } | null>(null);
  const { changed, dirtyRef, isDirty } = useFormChanges(formRef);

  const [email, setEmail] = useState(defaults.email);
  const [birthday, setBirthday] = useState(defaults.birthday);
  const [touched, setTouched] = useState(false);
  const [turnstile, setTurnstile] = useState<TurnstileStatus>("checking");
  const [sent, setSent] = useState<Saved>({ lines: [], changes: [] });

  const [state, formAction, pending] = useActionState(
    async (previous: EditorState, formData: FormData): Promise<EditorState> => {
      try {
        const dirty = isDirty(formData);
        // Nothing changed: a plain confirm, which the owner sees as Confirmed.
        if (!dirty) {
          const result = await confirm({}, formData);
          return result.confirmed ? { done: true } : { error: result.error };
        }
        const result = await save({}, formData);
        return result.saved
          ? { done: true }
          : { error: result.error, fieldErrors: result.fieldErrors };
      } catch {
        return { ...previous, error: "The connection dropped. Tap again." };
      }
    },
    {},
  );

  const editing = useEnvelopeEditing({ formRef, household, state });
  const { open, draft, close, show, openRef, onOpenKeyDown } = editing;

  useEffect(() => {
    if (!state.fieldErrors?.postal_code) return;
    formRef.current?.querySelector<HTMLElement>("[data-postcode-line]")?.click();
  }, [state]);

  // Not a single read after mount: on a slow device the names line renders later
  // and would count as changed. Track the printed lines until the first interaction.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const read = (kind?: string) =>
      [...form.querySelectorAll(`[data-print-line${kind ? `="${kind}"` : ""}]`)].map(
        (line) => line.textContent ?? "",
      );
    let touched = false;
    let first = 0;
    const track = () => {
      if (touched) return;
      before.current = { lines: read(), address: read("address") };
      first = requestAnimationFrame(track);
    };
    first = requestAnimationFrame(track);
    const stop = () => {
      touched = true;
    };
    form.addEventListener("input", stop);
    form.addEventListener("change", stop);
    form.addEventListener("click", stop);
    return () => {
      cancelAnimationFrame(first);
      form.removeEventListener("input", stop);
      form.removeEventListener("change", stop);
      form.removeEventListener("click", stop);
    };
  }, []);

  if (state.done) return <SavedView ownerName={ownerName} saved={sent} expiresAt={expiresAt} />;

  const emailChanged = changed.has("email") || changed.has("birthday");

  const layout = ({ fields, preview }: { fields: ReactNode; preview: AddressPreview }) => {
    const rows = envelopeRows(preview, open?.kind === "address" ? open : null);
    const missing = rows.filter((row) => row.kind === "slot");
    // Only a missing street or name blocks sending: contacts imported with the
    // whole address in the street must still be able to confirm.
    const blocked = missing.some((row) => row.tokens.includes("A") || row.tokens.includes("N"));
    const count = changedLineCount(rows, changed) + (emailChanged ? 1 : 0);
    const label = pending
      ? "Saving…"
      : turnstile === "checking"
        ? "Checking you're human…"
        : blocked
          ? "Add your address to continue"
          : changed.size > 0
            ? count > 0
              ? `Send it here · ${count} change${count === 1 ? "" : "s"}`
              : "Save and send it here"
            : "Yes, send it here";

    return (
      <>
        <EnvelopeCard
          editing={editing}
          addressRef={addressRef}
          fields={fields}
          preview={preview}
          from={ownerName}
          changed={changed}
          enabled={enabled}
          recipient={recipient}
          errors={state.fieldErrors}
          onOpenLine={() => setTouched(true)}
          className="envelope-rise"
        />

        {touched || open ? null : (
          <p className="hint-nudge self-center text-xs font-medium text-muted-foreground">
            {blocked ? "Tap a dashed line to add it" : "Tap any line to fix it"}
          </p>
        )}

        <EnvelopeCountry
          editing={editing}
          fields={fields}
          preview={preview}
          changed={changed}
          legacyCountry={legacyCountry}
          senderCountry={senderCountry}
          onOpenLine={() => setTouched(true)}
        />

        {open?.kind === "details" ? (
          <div
            ref={openRef}
            data-open-line="details"
            onKeyDown={(event) => onOpenKeyDown(event, close)}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className={envelopeLabelClasses}>
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={cn(envelopeInputClasses, "font-sans text-base")}
              />
            </div>
            {enabled.birthday ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="birthday" className={envelopeLabelClasses}>
                  Birthday
                </label>
                <input
                  id="birthday"
                  name="birthday"
                  type="date"
                  value={birthday}
                  onChange={(event) => setBirthday(event.target.value)}
                  className={cn(envelopeInputClasses, "font-sans text-base")}
                />
              </div>
            ) : null}
            <DoneButton onClick={close}>Done</DoneButton>
            <EnterHints within={openRef} last="done" />
          </div>
        ) : (
          <>
            <input type="hidden" name="email" value={email} />
            {enabled.birthday ? <input type="hidden" name="birthday" value={birthday} /> : null}
            <button
              type="button"
              data-line-focus="details"
              onClick={(event) => {
                setTouched(true);
                show({ kind: "details" }, event.currentTarget);
              }}
              className={cn(
                "flex min-h-11 items-center justify-between gap-3 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
                emailChanged && "text-accent-foreground",
              )}
            >
              <span className="min-w-0 truncate">
                Email: <span className="text-foreground">{email || "none yet"}</span>
              </span>
              <span className="shrink-0 font-semibold text-primary">Change</span>
            </button>
          </>
        )}

        <button
          type="submit"
          disabled={pending || turnstile !== "ready" || blocked}
          className="h-12 rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
        >
          {label}
        </button>
      </>
    );
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      onSubmit={(event) => {
        if (dirtyRef.current && addressRef.current?.validate() === false) {
          event.preventDefault();
          if (!(open?.kind === "address" && open.tokens.includes("Z"))) {
            formRef.current?.querySelector<HTMLElement>("[data-postcode-line]")?.click();
            requestAnimationFrame(() => addressRef.current?.validate());
          }
          return;
        }
        const read = (kind?: string) =>
          [...event.currentTarget.querySelectorAll(`[data-print-line${kind ? `="${kind}"` : ""}]`)].map(
            (line) => line.textContent ?? "",
          );
        const lines = read();
        const start = before.current ?? { lines, address: read("address") };
        const reply = (snap: Omit<ReplySnapshot, "email" | "birthday">, from: TokenUpdateValues | null): ReplySnapshot => ({
          ...snap,
          email: from ? from.email : email,
          birthday: from ? from.birthday : birthday,
        });
        setSent({
          lines: lines.map((text) => ({ text, changed: !start.lines.includes(text) })),
          changes: whatChanged(
            reply({ household: draftFromValues(household), address: start.address }, defaults),
            reply({ household: pruneDraft(draft), address: read("address") }, null),
          ),
        });
      }}
      className="relative flex flex-col gap-5"
    >
      <header hidden={open !== null} className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">From {senderNames}</p>
        <h1 className="font-serif text-[1.65rem] leading-tight text-foreground">
          {defaults.address_line1
            ? "Will your holiday card reach you here?"
            : `Where should ${ownerName} send your card?`}
        </h1>
        <p className="mt-2 flex items-start gap-2 text-sm leading-snug text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {`Only ${senderNames} ${ownerVerb(senderNames, "sees", "see")} what you enter. It isn't sold or shared.`}
          </span>
        </p>
      </header>
      {state.error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.error}
        </div>
      ) : null}
      <AddressFields
        key={senderCountry}
        defaults={{
          address_line1: defaults.address_line1,
          address_line2: defaults.address_line2,
          district: defaults.district,
          city: defaults.city,
          state_region: defaults.state_region,
          postal_code: defaults.postal_code,
          country_code: defaults.country_code,
        }}
        legacyCountry={legacyCountry}
        senderCountry={senderCountry}
        audience={{ kind: "recipient", ownerName }}
        styles={{ input: envelopeInputClasses, label: envelopeLabelClasses }}
        errors={{ postal_code: state.fieldErrors?.postal_code }}
        errorsKey={state}
        preview={layout}
        focus={open?.kind === "address" || open?.kind === "country" ? new Set(openFields(open)) : null}
        handleRef={addressRef}
        postcodeFirstIn="US"
      />
      <HouseholdInputs draft={pruneDraft(draft)} enabled={enabled} />
      <input type="hidden" name="seen_at" value={seenAt} />
      <TurnstileWidget resetOn={state} onStatusChange={setTurnstile} />
    </form>
  );
}
