"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CircleAlert } from "lucide-react";
import { type AddressFieldsHandle, type AddressPreview } from "@/components/address-fields";
import {
  draftFromValues,
  NamesEditor,
  personWithError,
  pruneDraft,
  type HouseholdDraft,
  type Recipient,
} from "@/components/envelope-names";
import { envelopeRows, openRowIndex, streetLine, type Row } from "@/components/envelope-rows";
import { type EnabledFields } from "@/components/recipient-fields";
import { getCountry, type Country, type FormatField } from "@/lib/address/countries";
import { fieldLabel, type AddressField } from "@/lib/address/fields";
import { COUNTRY_LINE_AT } from "@/lib/address/format";
import { lookupZip } from "@/lib/address/zip-action";
import { normCity, zipDisagrees, type ZipPlace } from "@/lib/address/zip-agree";
import { cn } from "@/lib/utils";
import { type HouseholdFieldErrors, type HouseholdValues } from "@/lib/validation/household";

export type FormField = AddressField | "country_code";

export type Open =
  | { kind: "names" }
  | { kind: "details" }
  | { kind: "country" }
  | { kind: "address"; tokens: FormatField[]; at: number; slot: boolean };

const TOKEN_FIELDS: Record<FormatField, AddressField[]> = {
  N: [],
  O: [],
  A: ["address_line1", "address_line2"],
  D: ["district"],
  C: ["city"],
  S: ["state_region"],
  Z: ["postal_code"],
};

const NAME_KEY = /^(first_name|last_name|partner_(first_name|last_name|section)|kid_|kids_section)/;
const IGNORED_KEYS = new Set(["cf-turnstile-response", "seen_at", "id", "version"]);

export function openFields(open: Open & { kind: "address" | "country" }): FormField[] {
  return open.kind === "country" ? ["country_code"] : open.tokens.flatMap((token) => TOKEN_FIELDS[token]);
}

function lineKeys(tokens: FormatField[], at: number): (key: string) => boolean {
  if (at === COUNTRY_LINE_AT) return (key) => key === "country_code";
  if (tokens.includes("N")) return (key) => NAME_KEY.test(key);
  const fields = new Set<string>(tokens.flatMap((token) => TOKEN_FIELDS[token]));
  return (key) => fields.has(key);
}

export function changedLineCount(rows: Row[], changed: ReadonlySet<string>): number {
  return rows.filter((row) => row.kind === "line" && [...changed].some(lineKeys(row.tokens, row.at))).length;
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

function slotLabel(tokens: FormatField[], country: Country | null, recipient: Recipient): string {
  if (tokens.includes("N")) return recipient === "owner" ? "names" : "your names";
  return midSentence(lineTitle(tokens, 0, country));
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

/** The fields Return steps through in an open line, in order. */
function lineFields(block: HTMLElement | null): (HTMLInputElement | HTMLSelectElement)[] {
  if (!block) return [];
  return [...block.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=hidden]), select")].filter(
    (field) => field.getClientRects().length > 0,
  );
}

/** Labels the phone keyboard's Return key to match onOpenKeyDown: "next" until the line's last field. */
export function EnterHints({ within, last }: { within: RefObject<HTMLElement | null>; last: "next" | "done" }) {
  useEffect(() => {
    const fields = lineFields(within.current);
    fields.forEach((field, i) => {
      field.enterKeyHint = i === fields.length - 1 ? last : "next";
    });
  });
  return null;
}

export function Paper({
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

export function DoneButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 self-start rounded-lg bg-primary px-5 font-sans text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
    >
      {children}
    </button>
  );
}

/**
 * Which form keys differ from the form as it first rendered, so the country
 * prefill and state normalization never count as edits.
 */
export function useFormChanges(formRef: RefObject<HTMLFormElement | null>) {
  const baseline = useRef<Map<string, string> | null>(null);
  const dirtyRef = useRef(false);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    baseline.current = snapshot(new FormData(form));
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
      cancelAnimationFrame(frame);
      form.removeEventListener("input", measure);
      form.removeEventListener("change", measure);
      form.removeEventListener("click", measure);
    };
  }, [formRef]);

  return {
    changed,
    dirtyRef,
    isDirty(data: FormData): boolean {
      return baseline.current ? changedKeys(baseline.current, snapshot(data)).size > 0 : dirtyRef.current;
    },
    rebase() {
      if (formRef.current) baseline.current = snapshot(new FormData(formRef.current));
      dirtyRef.current = false;
      setChanged(new Set());
    },
  };
}

export function useEnvelopeEditing({
  formRef,
  household,
  state,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  household: HouseholdValues;
  state: { fieldErrors?: HouseholdFieldErrors };
}) {
  const envelopeRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);
  const nextKey = useRef(household.kids.length + 2);

  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<HouseholdDraft>(() => draftFromValues(household));
  const [editingPerson, setEditingPerson] = useState<number | null>(null);

  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const person = personWithError(draft, state.fieldErrors);
    if (person !== null) {
      setOpen({ kind: "names" });
      setEditingPerson(person);
    } else if (state.fieldErrors?.kids) {
      setOpen({ kind: "names" });
    }
  }

  // Keep the open line above the on-screen keyboard: put the envelope at the
  // top of the screen, then nudge the line back into view as the keyboard opens.
  useEffect(() => {
    if (!open) return;
    const block = openRef.current;
    const visible = (el: Element | null) => el !== null && el.getClientRects().length > 0;
    const active = document.activeElement;
    // The names editor may already have focused a person; Next keeps this block mounted, so focus on its button doesn't count.
    const settled = block?.contains(active) && active?.matches("input, select") && visible(active);
    if (block && !settled) {
      const first = (selector: string) =>
        [...block.querySelectorAll<HTMLElement>(selector)].find(visible);
      (first("input:not([type=hidden])") ?? first("select, button"))?.focus({ preventScroll: true });
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

  function show(next: Open, opener: HTMLElement | null) {
    returnTo.current = opener?.dataset.lineFocus ?? null;
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

  function onOpenKeyDown(event: KeyboardEvent<HTMLElement>, done: () => void) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    event.preventDefault();
    const fields = lineFields(event.currentTarget);
    const next = fields[fields.indexOf(field) + 1];
    if (next) next.focus();
    else done();
  }

  return {
    formRef,
    envelopeRef,
    openRef,
    shakeRef,
    nextKey,
    open,
    setOpen,
    draft,
    setDraft,
    editingPerson,
    setEditingPerson,
    show,
    close,
    onOpenKeyDown,
  };
}

export type EnvelopeEditing = ReturnType<typeof useEnvelopeEditing>;

export function revealPostcode(editing: EnvelopeEditing) {
  const { open, formRef, setOpen } = editing;
  if (open?.kind === "address" && open.tokens.includes("Z")) return;
  const line = formRef.current?.querySelector<HTMLElement>("[data-postcode-line]");
  if (line) line.click();
  else setOpen({ kind: "address", tokens: ["Z"], at: COUNTRY_LINE_AT - 1, slot: true });
}

type EnvelopeCardProps = {
  editing: EnvelopeEditing;
  addressRef: RefObject<AddressFieldsHandle | null>;
  fields: ReactNode;
  preview: AddressPreview;
  from: string;
  changed: ReadonlySet<string>;
  enabled: Pick<EnabledFields, "partner_name" | "kids_names">;
  recipient: Recipient;
  errors?: HouseholdFieldErrors;
  onOpenLine?: () => void;
  className?: string;
  scrollClassName?: string;
};

export function EnvelopeCard({
  editing,
  addressRef,
  fields,
  preview,
  from,
  changed,
  enabled,
  recipient,
  errors,
  onOpenLine,
  className,
  scrollClassName = "scroll-mt-3",
}: EnvelopeCardProps) {
  const { open, close, show, setOpen, draft, setDraft, editingPerson, setEditingPerson, formRef } = editing;
  const [zipPlaces, setZipPlaces] = useState<Record<string, ZipPlace | null>>({});
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());

  const openAddress = open?.kind === "address" ? open : null;
  const rows = envelopeRows(preview, openAddress);
  const openIndex = openRowIndex(rows, openAddress);
  const openAt = openIndex === -1 ? null : rows[openIndex].at;
  const missing = rows.filter((row) => row.kind === "slot");
  const nextSlot =
    open?.kind === "address" && open.slot
      ? missing.find((row) => row.at !== openAt && !row.tokens.includes("N"))
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
    onOpenLine?.();
    if (row.tokens.includes("N")) return show({ kind: "names" }, opener);
    if (row.at === COUNTRY_LINE_AT) return show({ kind: "country" }, opener);
    show({ kind: "address", tokens: row.tokens, at: row.at, slot: row.kind === "slot" }, opener);
  }

  function finish() {
    if (
      open?.kind === "address" &&
      open.tokens.includes("Z") &&
      addressRef.current?.validate() === false
    ) {
      const block = editing.shakeRef.current;
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

  const addressOpen = open?.kind === "address";

  return (
    <div ref={editing.envelopeRef} className={scrollClassName}>
      <Paper from={from} className={className}>
        <address
          className={cn(
            "mt-4 flex flex-col items-start gap-0.5 font-serif text-lg leading-relaxed not-italic text-foreground transition-[padding]",
            open?.kind === "names" || addressOpen ? "pl-1" : "pl-6",
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
                  ref={editing.openRef}
                  data-open-line={focusKey}
                  onKeyDown={(event) => editing.onOpenKeyDown(event, isNames ? close : finish)}
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
                      newKey={() => editing.nextKey.current++}
                      errors={errors}
                      onDone={close}
                    />
                  ) : (
                    <div ref={editing.shakeRef} className="w-full">
                      {fields}
                    </div>
                  )}
                  {!isNames && row.tokens.includes("Z") ? zipWarning : null}
                  <DoneButton onClick={isNames ? close : finish}>{nextSlot ? "Next" : "Done"}</DoneButton>
                  {isNames ? null : <EnterHints within={editing.openRef} last={nextSlot ? "next" : "done"} />}
                  {row.kind === "line" ? (
                    <span hidden data-print-line={kind}>
                      {row.text}
                    </span>
                  ) : null}
                </div>
              );
            }
            if (openAddress && !isNames && row.at === openAt) {
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
                  data-postcode-line={row.tokens.includes("Z") || undefined}
                  style={style}
                  onClick={(event) => openRow(row, event.currentTarget)}
                  className="my-0.5 min-h-11 rounded-md border-[1.5px] border-dashed border-primary/70 px-2.5 py-1 font-sans text-sm font-medium text-primary transition-colors hover:bg-accent"
                >
                  + Add {slotLabel(row.tokens, preview.country, recipient)}
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
      {addressOpen || open?.kind === "country" ? null : <div hidden>{fields}</div>}
    </div>
  );
}

type EnvelopeCountryProps = {
  editing: EnvelopeEditing;
  fields: ReactNode;
  preview: AddressPreview;
  changed: ReadonlySet<string>;
  legacyCountry?: string | null;
  senderCountry: string;
  onOpenLine?: () => void;
};

export function EnvelopeCountry({
  editing,
  fields,
  preview,
  changed,
  legacyCountry,
  senderCountry,
  onOpenLine,
}: EnvelopeCountryProps) {
  const { open, close, show, setOpen, openRef, onOpenKeyDown } = editing;

  // Any country change re-lays the envelope, so pick up at the street wherever that country prints it.
  function onCountryChange(event: ChangeEvent<HTMLElement>) {
    if (!(event.target instanceof HTMLSelectElement) || event.target.name !== "country_code") return;
    const code = event.target.value || (legacyCountry?.trim() ? null : senderCountry);
    setOpen({ kind: "address", ...streetLine(getCountry(code)), slot: preview.envelope === null });
  }

  if (open?.kind === "country") {
    return (
      <div
        ref={openRef}
        data-open-line="country"
        onKeyDown={(event) => onOpenKeyDown(event, close)}
        onChange={onCountryChange}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      >
        {fields}
        <DoneButton onClick={close}>Done</DoneButton>
      </div>
    );
  }

  const countryName = preview.country?.name ?? (legacyCountry?.trim() || "none yet");
  return (
    <button
      type="button"
      data-line-focus="country"
      onClick={(event) => {
        onOpenLine?.();
        show({ kind: "country" }, event.currentTarget);
      }}
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
        changed.has("country_code") && "text-accent-foreground",
      )}
    >
      <span className="min-w-0 truncate">
        Country: <span className="text-foreground">{countryName}</span>
      </span>
      <span className="shrink-0 font-semibold text-primary">Change</span>
    </button>
  );
}
