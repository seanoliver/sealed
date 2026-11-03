"use client";

import {
  useActionState,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CircleAlert, Lock } from "lucide-react";
import {
  AddressFields,
  type AddressFieldsHandle,
  type AddressPreview,
} from "@/components/address-fields";
import { type EnabledFields } from "@/components/recipient-fields";
import { TurnstileWidget, type TurnstileStatus } from "@/components/turnstile-widget";
import { type Country, type FormatField } from "@/lib/address/countries";
import { fieldLabel, type AddressField } from "@/lib/address/fields";
import { COUNTRY_LINE_AT } from "@/lib/address/format";
import { normCity, zipDisagrees, type ZipPlace } from "@/lib/address/zip-agree";
import { ownerVerb } from "@/lib/owner-name";
import { cn } from "@/lib/utils";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";
import { type TokenUpdateState } from "../actions";
import { type ConfirmState } from "./actions";
import {
  draftFromValues,
  envelopeInputClasses,
  envelopeLabelClasses,
  HouseholdInputs,
  NamesEditor,
  personWithError,
  pruneDraft,
  valuesFromDraft,
  type HouseholdDraft,
  type Recipient,
} from "./envelope-names";
import { envelopeRows, openRowIndex, type Row } from "./envelope-rows";
import { whatChanged, type Change, type ReplySnapshot } from "./what-changed";
import { lookupZip } from "./zip-action";

type FormField = AddressField | "country_code";

type Open =
  | { kind: "names" }
  | { kind: "details" }
  | { kind: "address"; tokens: FormatField[]; at: number; slot: boolean };

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

const TOKEN_FIELDS: Record<FormatField, AddressField[]> = {
  N: [],
  O: [],
  A: ["address_line1", "address_line2"],
  D: ["district"],
  C: ["city"],
  S: ["state_region"],
  Z: ["postal_code"],
};

const NAME_KEY = /^(first_name|last_name|partner_|kid_|kids_section)/;
const IGNORED_KEYS = new Set(["cf-turnstile-response", "seen_at"]);

function openFields(open: Open & { kind: "address" }): FormField[] {
  if (open.at === COUNTRY_LINE_AT) return ["country_code"];
  const fields: FormField[] = open.tokens.flatMap((token) => TOKEN_FIELDS[token]);
  return open.slot && open.tokens.includes("A") ? ["country_code", ...fields] : fields;
}

function lineKeys(tokens: FormatField[], at: number): (key: string) => boolean {
  if (at === COUNTRY_LINE_AT) return (key) => key === "country_code";
  if (tokens.includes("N")) return (key) => NAME_KEY.test(key);
  const fields = new Set<string>(tokens.flatMap((token) => TOKEN_FIELDS[token]));
  return (key) => fields.has(key);
}

function lineTitle(tokens: FormatField[], at: number, country: Country | null): string {
  if (at === COUNTRY_LINE_AT) return "Country";
  if (tokens.includes("N")) return "Names on the envelope";
  const labels = tokens
    .filter((token) => TOKEN_FIELDS[token].length > 0)
    .map((token, i) => {
      const label = fieldLabel(TOKEN_FIELDS[token][0], country);
      return i === 0 || /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
    });
  if (labels.length <= 1) return labels[0] ?? "Address";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function snapshot(data: FormData): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of data) {
    if (IGNORED_KEYS.has(key)) continue;
    const text = String(value);
    out.set(key, out.has(key) ? `${out.get(key)}\u0000${text}` : text);
  }
  return out;
}

function changedKeys(base: Map<string, string>, now: Map<string, string>): Set<string> {
  const keys = new Set<string>();
  for (const key of new Set([...base.keys(), ...now.keys()])) {
    if ((base.get(key) ?? "") !== (now.get(key) ?? "")) keys.add(key);
  }
  return keys;
}

/** "City, state and ZIP code" → "city, state and ZIP code", for use mid-sentence. */
function midSentence(title: string): string {
  return /^[A-Z]{2}/.test(title) ? title : title.charAt(0).toLowerCase() + title.slice(1);
}

function slotLabel(tokens: FormatField[], country: Country | null): string {
  return tokens.includes("N") ? "your names" : midSentence(lineTitle(tokens, 0, country));
}

const ZIP5 = /^(\d{5})(-\d{4})?$/;

/** Looks a ZIP up once per mount; key it by ZIP. */
function ZipLookup({ zip, onPlace }: { zip: string; onPlace: (place: ZipPlace | null) => void }) {
  const report = useEffectEvent(onPlace);
  useEffect(() => {
    let live = true;
    lookupZip(zip).then(
      (place) => {
        if (live) report(place);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [zip]);
  return null;
}

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

function Paper({
  children,
  from,
  stamp,
  className,
}: {
  children: ReactNode;
  from: string;
  stamp?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg border border-border bg-card px-4 pt-3.5 pb-6 shadow-[0_14px_26px_-18px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="pt-0.5 text-[11px] text-muted-foreground">{from}</span>
        <div aria-hidden="true" className="relative h-11 w-9 shrink-0 rounded-sm border border-dashed border-border">
          {stamp}
        </div>
      </div>
      {children}
    </div>
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
  const envelopeRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);
  const baseline = useRef<Map<string, string> | null>(null);
  const before = useRef<{ lines: string[]; address: string[] } | null>(null);
  const dirtyRef = useRef(false);
  const nextKey = useRef(household.kids.length + 2);

  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<HouseholdDraft>(() => draftFromValues(household));
  const [editingPerson, setEditingPerson] = useState<number | null>(null);
  const [email, setEmail] = useState(defaults.email);
  const [birthday, setBirthday] = useState(defaults.birthday);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const [turnstile, setTurnstile] = useState<TurnstileStatus>("checking");
  const [zipPlaces, setZipPlaces] = useState<Record<string, ZipPlace | null>>({});
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [sent, setSent] = useState<Saved>({ lines: [], changes: [] });

  const [state, formAction, pending] = useActionState(
    async (previous: EditorState, formData: FormData): Promise<EditorState> => {
      try {
        const dirty = baseline.current
          ? changedKeys(baseline.current, snapshot(formData)).size > 0
          : dirtyRef.current;
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

  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const person = personWithError(draft, state.fieldErrors);
    if (person !== null) {
      setOpen({ kind: "names" });
      setEditingPerson(person);
    }
  }

  useEffect(() => {
    if (!state.fieldErrors?.postal_code) return;
    formRef.current?.querySelector<HTMLElement>("[data-postcode-line]")?.click();
  }, [state]);

  // Changes are measured against the form as it first rendered, so the
  // country prefill and state normalization never count as edits.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    baseline.current = snapshot(new FormData(form));
    const first = requestAnimationFrame(() => {
      // The names line fills in a render after mount.
      const read = (kind?: string) =>
        [...form.querySelectorAll(`[data-print-line${kind ? `="${kind}"` : ""}]`)].map(
          (line) => line.textContent ?? "",
        );
      before.current = { lines: read(), address: read("address") };
    });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      // Rows re-render after a click, so read a frame later.
      frame = requestAnimationFrame(() => {
        if (!baseline.current) return;
        const keys = changedKeys(baseline.current, snapshot(new FormData(form)));
        dirtyRef.current = keys.size > 0;
        setChanged(keys);
      });
    };
    form.addEventListener("input", measure);
    form.addEventListener("change", measure);
    form.addEventListener("click", measure);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(frame);
      form.removeEventListener("input", measure);
      form.removeEventListener("change", measure);
      form.removeEventListener("click", measure);
    };
  }, []);

  // Keep the open line above the on-screen keyboard: put the envelope at the
  // top of the screen, then nudge the line back into view as the keyboard opens.
  useEffect(() => {
    if (!open) return;
    const block = openRef.current;
    // The names editor may already have focused the person it opened on.
    if (block && !block.contains(document.activeElement)) {
      [...block.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, button")]
        .find((el) => el.getClientRects().length > 0)
        ?.focus({ preventScroll: true });
    }
    envelopeRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keepVisible = () => {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : block;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (rect.bottom > viewport.height - 8 || rect.top < 0) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    viewport.addEventListener("resize", keepVisible);
    return () => viewport.removeEventListener("resize", keepVisible);
  }, [open]);

  if (state.done) return <SavedView ownerName={ownerName} saved={sent} expiresAt={expiresAt} />;

  const emailChanged = changed.has("email") || changed.has("birthday");

  function show(next: Open, opener: HTMLElement | null) {
    returnTo.current = opener?.dataset.lineFocus ?? null;
    setTouched(true);
    setDraft((current) => pruneDraft(current));
    if (next.kind === "names") {
      const alone = !draft.partner && draft.kids.length === 0;
      setEditingPerson(alone || draft.primary.first === "" ? draft.primary.key : null);
    }
    setOpen(next);
  }

  function close() {
    shakeRef.current?.classList.remove("shake-x");
    setDraft((current) => pruneDraft(current));
    setEditingPerson(null);
    setOpen(null);
    const focusKey = returnTo.current;
    // The opener may have become a line (a filled slot); refocus whatever is there now.
    requestAnimationFrame(() => {
      const form = formRef.current;
      const target =
        (focusKey && form?.querySelector<HTMLElement>(`[data-line-focus="${focusKey}"]`)) ||
        form?.querySelector<HTMLElement>("[data-envelope-line]");
      target?.focus();
    });
  }

  function onOpenKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }

  const layout = ({ fields, preview }: { fields: ReactNode; preview: AddressPreview }) => {
    const openAddress = open?.kind === "address" ? open : null;
    const rows = envelopeRows(preview, openAddress);
    const openIndex = openRowIndex(rows, openAddress);
    const missing = rows.filter((row) => row.kind === "slot");
    // Only a missing street or name blocks sending: contacts imported with the
    // whole address in the street must still be able to confirm.
    const blocked = missing.some((row) => row.tokens.includes("A") || row.tokens.includes("N"));
    const changedLines = rows.filter(
      (row) => row.kind === "line" && [...changed].some(lineKeys(row.tokens, row.at)),
    ).length;
    const count = changedLines + (emailChanged ? 1 : 0);
    const nextSlot =
      open?.kind === "address" && open.slot
        ? missing.find((row) => row.at !== open.at && !row.tokens.includes("N"))
        : undefined;

    const { values } = preview;
    const us = preview.country?.code === "US";
    const zip = us ? (values.postal_code.trim().match(ZIP5)?.[1] ?? null) : null;
    const zipOpen = open?.kind === "address" && open.tokens.includes("Z");
    const lookUp = zip !== null && !(zip in zipPlaces) && (zipOpen || changed.has("postal_code"));
    const place = zip ? (zipPlaces[zip] ?? null) : null;
    const where = { city: values.city, state: values.state_region };
    const keepKey = `${zip}|${normCity(where.city)}|${where.state}`;
    const mismatch = place !== null && zipDisagrees(place, where) && !kept.has(keepKey) ? place : null;

    function onPlace(found: ZipPlace | null) {
      if (zip === null) return;
      setZipPlaces((current) => ({ ...current, [zip]: found }));
      if (found && where.city.trim() === "" && where.state.trim() === "") {
        applyZipPlace(found);
      }
    }

    function applyZipPlace(found: ZipPlace) {
      addressRef.current?.set({ city: found.city, state_region: found.state });
      // A fill isn't an input event: tell the change counter.
      requestAnimationFrame(() =>
        formRef.current?.dispatchEvent(new Event("change", { bubbles: true })),
      );
    }

    const zipWarning = mismatch ? (
      <div role="status" className="flex w-full flex-col gap-2 py-1 font-sans text-sm">
        <p className="flex items-center gap-1.5 text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {zip} is in {mismatch.city}, {mismatch.state}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyZipPlace(mismatch)}
            className="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/70"
          >
            Use {mismatch.city}, {mismatch.state}
          </button>
          <button
            type="button"
            onClick={() => setKept((current) => new Set(current).add(keepKey))}
            className="h-11 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Keep mine
          </button>
        </div>
      </div>
    ) : null;

    function openRow(row: Row, opener: HTMLElement) {
      if (row.tokens.includes("N")) return show({ kind: "names" }, opener);
      show({ kind: "address", tokens: row.tokens, at: row.at, slot: row.kind === "slot" }, opener);
    }

    function finish() {
      if (
        open?.kind === "address" &&
        open.tokens.includes("Z") &&
        addressRef.current?.validate() === false
      ) {
        const block = shakeRef.current;
        block?.classList.remove("shake-x");
        void block?.offsetWidth;
        block?.classList.add("shake-x");
        block?.addEventListener("animationend", () => block.classList.remove("shake-x"), { once: true });
        return;
      }
      if (nextSlot) {
        setOpen({ kind: "address", tokens: nextSlot.tokens, at: nextSlot.at, slot: true });
        return;
      }
      close();
    }

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

    const doneButton = (text: string, onClick: () => void) => (
      <button
        type="button"
        onClick={onClick}
        className="h-11 self-start rounded-lg bg-primary px-5 font-sans text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
      >
        {text}
      </button>
    );

    const addressOpen = open?.kind === "address";

    return (
      <>
        <div ref={envelopeRef} className="scroll-mt-3">
          <Paper from={ownerName} className="envelope-rise">
            <address
              className={cn(
                "mt-4 flex flex-col items-start gap-0.5 font-serif text-lg leading-relaxed not-italic text-foreground transition-[padding]",
                open && open.kind !== "details" ? "pl-1" : "pl-6",
              )}
            >
              {rows.map((row, i) => {
                const style = { "--i": i } as CSSProperties;
                const isNames = row.tokens.includes("N");
                const isOpen = (open?.kind === "names" && isNames) || i === openIndex;
                const focusKey = isNames ? "names" : String(row.at);
                const kind = isNames ? "names" : "address";
                if (isOpen) {
                  return (
                    <div
                      key="open"
                      ref={openRef}
                      data-open-line={focusKey}
                      onKeyDown={onOpenKeyDown}
                      className="my-1 flex w-full flex-col gap-3 font-sans"
                    >
                      {isNames ? (
                        <NamesEditor
                          draft={draft}
                          onChange={setDraft}
                          enabled={enabled}
                          recipient={recipient}
                          editing={editingPerson}
                          onEdit={setEditingPerson}
                          newKey={() => nextKey.current++}
                          errors={state.fieldErrors}
                          onDone={close}
                        />
                      ) : (
                        <div ref={shakeRef} className="w-full">
                          {fields}
                        </div>
                      )}
                      {!isNames && row.tokens.includes("Z") ? zipWarning : null}
                      {doneButton(nextSlot ? "Next" : "Done", isNames ? close : finish)}
                      {row.kind === "line" ? (
                        <span hidden data-print-line={kind}>
                          {row.text}
                        </span>
                      ) : null}
                    </div>
                  );
                }
                if (openAddress && !isNames && row.at === openAddress.at) {
                  return row.kind === "line" ? (
                    <span key={`line-${row.at}-${i}`} data-print-line={kind} style={style} className="block">
                      {row.text}
                    </span>
                  ) : null;
                }
                if (row.kind === "slot") {
                  return (
                    <button
                      key={`slot-${row.at}-${row.tokens.join("")}`}
                      type="button"
                      data-envelope-slot
                      data-line-focus={focusKey}
                      style={style}
                      onClick={(event) => openRow(row, event.currentTarget)}
                      className="my-0.5 min-h-11 rounded-md border-[1.5px] border-dashed border-primary/70 px-2.5 py-1 font-sans text-sm font-medium text-primary transition-colors hover:bg-accent"
                    >
                      + Add {slotLabel(row.tokens, preview.country)}
                    </button>
                  );
                }
                const isChanged = [...changed].some(lineKeys(row.tokens, row.at));
                const isError = preview.postcodeError !== null && row.tokens.includes("Z");
                return (
                  <div key={`line-${row.at}-${i}`} className="flex flex-col items-start">
                    <button
                      type="button"
                      data-envelope-line
                      data-line-focus={focusKey}
                      data-print-line={kind}
                      data-postcode-line={row.tokens.includes("Z") || undefined}
                      style={style}
                      aria-label={`${row.text}. Edit ${midSentence(lineTitle(row.tokens, row.at, preview.country))}`}
                      onClick={(event) => openRow(row, event.currentTarget)}
                      className={cn(
                        "-mx-1 min-h-11 cursor-pointer rounded px-1 text-left underline decoration-primary/40 decoration-dotted decoration-[1.5px] underline-offset-[6px] transition-colors duration-300 hover:bg-accent hover:text-accent-foreground",
                        isChanged && "bg-accent text-accent-foreground",
                        isError && "decoration-destructive decoration-wavy",
                      )}
                    >
                      {row.text}
                    </button>
                    {row.tokens.includes("Z") && !addressOpen ? zipWarning : null}
                  </div>
                );
              })}
            </address>
            {preview.caption && !open ? (
              <p className="mt-3 pl-6 text-xs text-muted-foreground">{preview.caption}</p>
            ) : null}
          </Paper>
          {lookUp && zip ? <ZipLookup key={zip} zip={zip} onPlace={onPlace} /> : null}
          {/* Every address field stays mounted, so closed lines still post. */}
          {addressOpen ? null : <div hidden>{fields}</div>}
        </div>

        {touched || open ? null : (
          <p className="hint-nudge self-center text-xs font-medium text-muted-foreground">
            {blocked ? "Tap a dashed line to add it" : "Tap any line to fix it"}
          </p>
        )}

        {open?.kind === "details" ? (
          <div
            ref={openRef}
            data-open-line="details"
            onKeyDown={onOpenKeyDown}
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
            {doneButton("Done", close)}
          </div>
        ) : (
          <>
            <input type="hidden" name="email" value={email} />
            {enabled.birthday ? <input type="hidden" name="birthday" value={birthday} /> : null}
            <button
              type="button"
              data-line-focus="details"
              onClick={(event) => show({ kind: "details" }, event.currentTarget)}
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
            reply({ household, address: start.address }, defaults),
            reply({ household: valuesFromDraft(pruneDraft(draft)), address: read("address") }, null),
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
            {`Only ${ownerName} ${ownerVerb(ownerName, "sees", "see")} what you enter. It isn't sold or shared.`}
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
        focus={open?.kind === "address" ? new Set(openFields(open)) : null}
        handleRef={addressRef}
        postcodeFirstIn="US"
      />
      <HouseholdInputs draft={pruneDraft(draft)} enabled={enabled} />
      <input type="hidden" name="seen_at" value={seenAt} />
      <TurnstileWidget resetOn={state} onStatusChange={setTurnstile} />
    </form>
  );
}
