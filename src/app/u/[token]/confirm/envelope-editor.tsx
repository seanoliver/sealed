"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AddressFields,
  type AddressFieldsHandle,
  type AddressPreview,
} from "@/components/address-fields";
import { HouseholdFields } from "@/components/household-fields";
import { type EnabledFields } from "@/components/recipient-fields";
import { inputClasses, labelClasses } from "@/components/recipient-field-styles";
import { TurnstileWidget, type TurnstileStatus } from "@/components/turnstile-widget";
import { type Country, type FormatField } from "@/lib/address/countries";
import { fieldLabel, type AddressField } from "@/lib/address/fields";
import { COUNTRY_LINE_AT } from "@/lib/address/format";
import { cn } from "@/lib/utils";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";
import { type TokenUpdateState } from "../actions";
import { type ConfirmState } from "./actions";

type FormField = AddressField | "country_code";

type Sheet =
  | { kind: "names" }
  | { kind: "details" }
  | { kind: "address"; tokens: FormatField[]; at: number; slot: boolean };

type EditorState = {
  error?: string;
  done?: true;
  values?: TokenUpdateValues;
  household?: HouseholdValues;
  fieldErrors?: TokenUpdateState["fieldErrors"];
};

type Props = {
  confirm: (state: ConfirmState, formData: FormData) => Promise<ConfirmState>;
  save: (state: TokenUpdateState, formData: FormData) => Promise<TokenUpdateState>;
  ownerName: string;
  defaults: TokenUpdateValues;
  household: HouseholdValues;
  enabled: EnabledFields;
  senderCountry: string;
  legacyCountry: string | null;
  seenAt: string;
  fullFormHref: string;
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

function sheetFields(sheet: Sheet & { kind: "address" }): FormField[] {
  if (sheet.at === COUNTRY_LINE_AT) return ["country_code"];
  const fields: FormField[] = sheet.tokens.flatMap((token) => TOKEN_FIELDS[token]);
  return sheet.slot && sheet.tokens.includes("A") ? ["country_code", ...fields] : fields;
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

type Row =
  | { kind: "line"; text: string; tokens: FormatField[]; at: number; uppercased: boolean }
  | { kind: "slot"; tokens: FormatField[]; at: number };

function envelopeRows(preview: AddressPreview): Row[] {
  const rows: Row[] = preview.envelope
    ? preview.envelope.lines.map((line) => ({ kind: "line", ...line }))
    : preview.name
      ? [{ kind: "line", text: preview.name, tokens: ["N"], at: 0, uppercased: false }]
      : [];
  if (!rows.some((row) => row.tokens.includes("N"))) rows.unshift({ kind: "slot", tokens: ["N"], at: 0 });
  for (const slot of preview.slots) rows.push({ kind: "slot", ...slot });
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.at - b.row.at || a.i - b.i)
    .map(({ row }) => row);
}

/** "City, state and ZIP code" → "city, state and ZIP code", for use mid-sentence. */
function midSentence(title: string): string {
  return /^[A-Z]{2}/.test(title) ? title : title.charAt(0).toLowerCase() + title.slice(1);
}

function slotLabel(tokens: FormatField[], country: Country | null): string {
  return tokens.includes("N") ? "your names" : midSentence(lineTitle(tokens, 0, country));
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

function Paper({ children, stamp, className }: { children: ReactNode; stamp?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-lg border border-border bg-background px-4 pt-4 pb-5 shadow-[0_14px_26px_-18px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      <div aria-hidden="true" className="relative ml-auto h-11 w-9 rounded-sm border border-dashed border-border">
        {stamp}
      </div>
      {children}
    </div>
  );
}

function DoneCard({ ownerName, lines }: { ownerName: string; lines: string[] }) {
  const [date] = useState(() =>
    new Date()
      .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      .toUpperCase(),
  );
  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-7 shadow-sm">
      <Paper
        className="envelope-rise"
        stamp={
          <span className="stamp-land absolute inset-0.5 grid place-items-center rounded-[2px] bg-primary font-serif text-base font-semibold text-primary-foreground outline-2 -outline-offset-[3px] outline-background outline-dotted">
            S
          </span>
        }
      >
        <Postmark date={date} />
        <address className="mt-3 pl-6 font-serif text-lg leading-relaxed not-italic text-foreground">
          {lines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </address>
      </Paper>
      <div className="fade-in-late flex flex-col gap-2 text-center">
        <h1 className="font-serif text-2xl leading-tight text-foreground">You&apos;re on the list</h1>
        <p className="text-sm text-muted-foreground">
          {ownerName}&apos;s card will go to this envelope. You can close this page.
        </p>
      </div>
    </div>
  );
}

export function EnvelopeEditor({
  confirm,
  save,
  ownerName,
  defaults,
  household,
  enabled,
  senderCountry,
  legacyCountry,
  seenAt,
  fullFormHref,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const addressRef = useRef<AddressFieldsHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const baseline = useRef<Map<string, string> | null>(null);
  const dirtyRef = useRef(false);
  const titleId = useId();

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [chain, setChain] = useState<{ step: number; total: number } | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const [sentLines, setSentLines] = useState<string[]>([]);
  const [turnstile, setTurnstile] = useState<TurnstileStatus>("checking");

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
          : {
              error: result.error,
              values: result.values,
              household: result.household,
              fieldErrors: result.fieldErrors,
            };
      } catch {
        // React resets uncontrolled inputs after the action; echo them back.
        const values = { ...(previous.values ?? defaults), email: String(formData.get("email") ?? "") };
        if (formData.has("birthday")) values.birthday = String(formData.get("birthday"));
        return { ...previous, values, error: "The connection dropped. Tap again." };
      }
    },
    {},
  );

  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const nameError = Object.entries(state.fieldErrors ?? {}).some(
      ([key, message]) => key !== "postal_code" && message,
    );
    if (nameError) {
      setChain(null);
      setSheet({ kind: "names" });
    }
  }

  // Changes are measured against the form as it first rendered, so the
  // country prefill and state normalization never count as edits.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    baseline.current = snapshot(new FormData(form));
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      // Household rows re-render after a click, so read a frame later.
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
      cancelAnimationFrame(frame);
      form.removeEventListener("input", measure);
      form.removeEventListener("change", measure);
      form.removeEventListener("click", measure);
    };
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const first = visibleFocusables(panelRef.current)[0];
    first?.focus({ preventScroll: true });
  }, [sheet]);

  if (state.done) return <DoneCard ownerName={ownerName} lines={sentLines} />;

  const values = state.values ?? defaults;
  const emailChanged = changed.has("email") || changed.has("birthday");

  function open(next: Sheet, opener: HTMLElement | null, step: typeof chain = null) {
    if (opener) openerRef.current = opener;
    setTouched(true);
    setChain(step);
    setSheet(next);
  }

  function close() {
    shakeRef.current?.classList.remove("shake-x");
    setSheet(null);
    setChain(null);
    const opener = openerRef.current;
    // The opener may have become a line (a filled slot); refocus whatever is there now.
    requestAnimationFrame(() => {
      const target = opener?.isConnected
        ? opener
        : formRef.current?.querySelector<HTMLElement>("[data-envelope-line]");
      target?.focus();
    });
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = visibleFocusables(panelRef.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const layout = ({ fields, preview }: { fields: ReactNode; preview: AddressPreview }) => {
    const rows = envelopeRows(preview);
    const missing = rows.filter((row) => row.kind === "slot");
    // Only a missing street or name blocks sending: contacts imported with the
    // whole address in the street must still be able to confirm.
    const blocked = missing.some((row) => row.tokens.includes("A") || row.tokens.includes("N"));
    const changedLines = rows.filter(
      (row) => row.kind === "line" && [...changed].some(lineKeys(row.tokens, row.at)),
    ).length;
    const count = changedLines + (emailChanged ? 1 : 0);
    const activeAt = sheet?.kind === "address" ? sheet.at : sheet?.kind === "names" ? 0 : null;
    const title =
      sheet?.kind === "names"
        ? "Names on the envelope"
        : sheet?.kind === "details"
          ? "Email"
          : sheet
            ? lineTitle(sheet.tokens, sheet.at, preview.country)
            : "";
    const nextSlot =
      sheet?.kind === "address" && sheet.slot
        ? missing.find((row) => row.at !== sheet.at && !row.tokens.includes("N"))
        : undefined;

    function openRow(row: Row, opener: HTMLElement) {
      if (row.tokens.includes("N")) return open({ kind: "names" }, opener);
      const slot = row.kind === "slot";
      const remaining = missing.filter((other) => !other.tokens.includes("N")).length;
      open(
        { kind: "address", tokens: row.tokens, at: row.at, slot },
        opener,
        slot && remaining > 1 ? { step: 1, total: remaining } : null,
      );
    }

    function finish() {
      if (
        sheet?.kind === "address" &&
        sheet.tokens.includes("Z") &&
        addressRef.current?.validate() === false
      ) {
        const panel = shakeRef.current;
        panel?.classList.remove("shake-x");
        void panel?.offsetWidth;
        panel?.classList.add("shake-x");
        panel?.addEventListener("animationend", () => panel.classList.remove("shake-x"), { once: true });
        return;
      }
      if (nextSlot) {
        setChain((current) =>
          current ? { step: current.step + 1, total: Math.max(current.total, current.step + 1) } : null,
        );
        setSheet({ kind: "address", tokens: nextSlot.tokens, at: nextSlot.at, slot: true });
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

    return (
      <>
        <div
          className={cn(
            "relative transition-transform duration-300 ease-out",
            sheet && "z-50 -translate-y-1 scale-[1.02]",
          )}
        >
          <Paper className="envelope-rise">
            <address className="mt-3 flex flex-col items-start pl-6 font-serif text-lg leading-relaxed not-italic text-foreground">
              {rows.map((row, i) => {
                const style = { "--i": i } as CSSProperties;
                if (row.kind === "slot") {
                  return (
                    <button
                      key={`slot-${row.at}-${row.tokens.join("")}`}
                      type="button"
                      data-envelope-slot
                      style={style}
                      onClick={(event) => openRow(row, event.currentTarget)}
                      className="my-0.5 rounded-md border-[1.5px] border-dashed border-primary/70 px-2 py-0.5 font-sans text-sm font-medium text-primary transition-colors hover:bg-accent"
                    >
                      + Add {slotLabel(row.tokens, preview.country)}
                    </button>
                  );
                }
                const isChanged = [...changed].some(lineKeys(row.tokens, row.at));
                const isError = preview.postcodeError !== null && row.tokens.includes("Z");
                const isActive = activeAt !== null && (row.at === activeAt || (activeAt === 0 && row.tokens.includes("N")));
                return (
                  <button
                    key={`line-${row.at}-${i}`}
                    type="button"
                    data-envelope-line
                    data-postcode-line={row.tokens.includes("Z") || undefined}
                    style={style}
                    aria-label={`${row.text}. Edit ${midSentence(lineTitle(row.tokens, row.at, preview.country))}`}
                    onClick={(event) => openRow(row, event.currentTarget)}
                    className={cn(
                      "-mx-1 cursor-pointer rounded px-1 text-left underline decoration-muted-foreground/50 decoration-dotted decoration-1 underline-offset-[5px] transition-colors duration-300 hover:bg-accent hover:text-accent-foreground",
                      (isChanged || (row.uppercased && isActive)) && "bg-accent text-accent-foreground",
                      isActive && "ring-2 ring-accent",
                      isError && "decoration-destructive decoration-wavy decoration-[1.5px]",
                    )}
                  >
                    {row.text}
                  </button>
                );
              })}
            </address>
            {preview.caption ? <p className="mt-3 pl-6 text-xs text-muted-foreground">{preview.caption}</p> : null}
          </Paper>
        </div>

        {touched ? null : (
          <p className="hint-nudge self-center rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            {blocked ? "Tap a dashed line to add it" : "Tap any line to fix it"}
          </p>
        )}

        <button
          type="button"
          onClick={(event) => open({ kind: "details" }, event.currentTarget)}
          className={cn(
            "flex items-baseline justify-between gap-3 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
            emailChanged && "text-accent-foreground",
          )}
        >
          <span className="min-w-0 truncate">
            Email: <span className="text-foreground">{values.email || "none yet"}</span>
          </span>
          <span className="shrink-0 font-semibold text-primary">Change</span>
        </button>

        <button
          type="submit"
          disabled={pending || turnstile !== "ready" || blocked}
          className="h-12 rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
        >
          {label}
        </button>

        {sheet ? (
          <div aria-hidden="true" onClick={close} className="sheet-backdrop fixed inset-0 z-40 bg-foreground/30 xl:bg-foreground/10" />
        ) : null}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          hidden={!sheet}
          onKeyDown={onPanelKeyDown}
          className="sheet-panel fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-card px-6 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-14px_30px_-12px_rgb(0_0_0/0.3)] xl:absolute xl:inset-auto xl:top-24 xl:left-full xl:ml-6 xl:w-80 xl:rounded-2xl xl:border xl:border-border xl:pt-5"
        >
          <div aria-hidden="true" className="h-1 w-10 self-center rounded-full bg-border xl:hidden" />
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={titleId} className="font-serif text-xl leading-tight text-foreground">
              {title}
            </h2>
            {chain ? (
              <span className="text-xs font-medium text-muted-foreground">
                {chain.step} of {chain.total}
              </span>
            ) : null}
          </div>
          <div ref={shakeRef} className="flex flex-col gap-5">
            <div hidden={sheet?.kind !== "names"}>
              <HouseholdFields
                defaults={state.household ?? household}
                enabled={enabled}
                errors={state.fieldErrors}
              />
            </div>
            <div hidden={sheet?.kind !== "address"}>{fields}</div>
            <div hidden={sheet?.kind !== "details"} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className={labelClasses}>
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  maxLength={320}
                  defaultValue={values.email}
                  className={inputClasses}
                />
              </div>
              {enabled.birthday ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="birthday" className={labelClasses}>
                    Birthday
                  </label>
                  <input
                    id="birthday"
                    name="birthday"
                    type="date"
                    defaultValue={values.birthday}
                    className={inputClasses}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={finish}
            className="h-11 shrink-0 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
          >
            {nextSlot ? "Next" : "Done"}
          </button>
          <a href={fullFormHref} className="text-center text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
            Use the full form instead
          </a>
        </div>
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
          if (!(sheet?.kind === "address" && sheet.tokens.includes("Z"))) {
            formRef.current?.querySelector<HTMLElement>("[data-postcode-line]")?.click();
            requestAnimationFrame(() => addressRef.current?.validate());
          }
          return;
        }
        const lines = [...event.currentTarget.querySelectorAll("[data-envelope-line]")].map(
          (line) => line.textContent ?? "",
        );
        setSentLines(lines);
      }}
      className="relative flex flex-col gap-5 rounded-xl border border-border bg-card p-7 shadow-sm"
    >
      <h1 className="font-serif text-2xl leading-tight text-foreground">
        {defaults.address_line1
          ? `Send ${ownerName}'s card to this envelope?`
          : `Where should ${ownerName} send your card?`}
      </h1>
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
          address_line1: values.address_line1,
          address_line2: values.address_line2,
          district: values.district,
          city: values.city,
          state_region: values.state_region,
          postal_code: values.postal_code,
          country_code: values.country_code,
        }}
        legacyCountry={legacyCountry}
        senderCountry={senderCountry}
        audience={{ kind: "recipient", ownerName }}
        styles={{ input: inputClasses, label: labelClasses }}
        errors={{ postal_code: state.fieldErrors?.postal_code }}
        errorsKey={state}
        preview={layout}
        focus={sheet?.kind === "address" ? new Set(sheetFields(sheet)) : null}
        handleRef={addressRef}
      />
      <input type="hidden" name="seen_at" value={seenAt} />
      <TurnstileWidget resetOn={state} onStatusChange={setTurnstile} />
    </form>
  );
}

function visibleFocusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [
    ...root.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea, button, a[href]"),
  ].filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
}
