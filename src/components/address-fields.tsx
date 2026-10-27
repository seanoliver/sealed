"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import {
  CountrySelect,
  SELECT_CHEVRON_CLASSES,
  SELECT_CHEVRON_STYLE,
} from "@/components/country-select";
import { Envelope } from "@/components/envelope";
import { getCountry, type Country } from "@/lib/address/countries";
import {
  ADDRESS_FIELDS,
  ADDRESS_MAX_LENGTH,
  addressLayout,
  fieldLabel,
  type AddressField,
  type AddressFieldSpec,
} from "@/lib/address/fields";
import { formatEnvelope, type Envelope as EnvelopeModel } from "@/lib/address/format";
import { normalizePostcode, normalizeState, postcodeProblem } from "@/lib/address/rules";
import { formatPerson, householdLine } from "@/lib/names";

export type AddressValues = Record<AddressField | "country_code", string>;

export const BLANK_ADDRESS: AddressValues = {
  address_line1: "",
  address_line2: "",
  district: "",
  city: "",
  state_region: "",
  postal_code: "",
  country_code: "",
};

export type AddressFieldsHandle = {
  validate: () => boolean;
};

export type AddressFieldStyles = { input: string; label: string };

type AddressFieldsProps = {
  defaults: AddressValues;
  legacyCountry?: string | null;
  senderCountry: string;
  audience: { kind: "recipient"; ownerName: string } | { kind: "owner" };
  styles: AddressFieldStyles;
  errors?: { postal_code?: string; country_code?: string };
  /** Changes with each server response, so a repeated error shows again. */
  errorsKey?: unknown;
  preview: "below" | "beside";
  handleRef?: Ref<AddressFieldsHandle>;
  /** Off for a saved contact: prefilling there would save a country nobody picked. */
  prefillCountry?: boolean;
  requireStreet?: boolean;
};

const LANGUAGE: Record<string, string> = {
  CN: "Chinese",
  TW: "Chinese",
  HK: "Chinese",
  MO: "Chinese",
  JP: "Japanese",
  KR: "Korean",
  KP: "Korean",
  RU: "Russian",
  UA: "Ukrainian",
  TH: "Thai",
  VN: "Vietnamese",
  AE: "Arabic",
  EG: "Arabic",
  AM: "Armenian",
};
const SHORT_NAMES: Record<string, string> = { US: "the US", GB: "the UK" };
const WITH_THE =
  /^(United|Netherlands|Philippines|Bahamas|Gambia|Czech|Dominican|Central African|Maldives)/;

function placeName(country: Country): string {
  return (
    SHORT_NAMES[country.code] ??
    (WITH_THE.test(country.name) ? `the ${country.name}` : country.name)
  );
}

function initialValues(defaults: AddressValues): AddressValues {
  return {
    ...defaults,
    state_region: normalizeState(defaults.country_code, defaults.state_region),
  };
}

function useFormHousehold(anchor: React.RefObject<HTMLElement | null>): string {
  const [name, setName] = useState("");
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    let frame = 0;
    const read = () => {
      const data = new FormData(form);
      const get = (key: string) => String(data.get(key) ?? "").trim();
      const first = get("first_name");
      const last = get("last_name");
      const partnerFirst = get("partner_first_name");
      const partnerLast = get("partner_last_name");
      const full = formatPerson({ first, last }) ?? "";
      setName(
        householdLine({
          fullName: full,
          partnerName: formatPerson({ first: partnerFirst, last: partnerLast }),
          kidsNames: null,
          firstName: first || null,
          lastName: last || null,
          partnerFirstName: partnerFirst || null,
          partnerLastName: partnerLast || null,
          kids: null,
        }),
      );
    };
    // A partner's surname follows the household's after React re-renders, so read a frame later.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    read();
    form.addEventListener("input", schedule);
    form.addEventListener("click", schedule);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener("input", schedule);
      form.removeEventListener("click", schedule);
    };
  }, [anchor]);
  return name;
}

const UPPER_FIELDS = [
  ["city", "C"],
  ["state_region", "S"],
  ["postal_code", "Z"],
  ["district", "D"],
  ["address_line1", "A"],
] as const;

function previewCaption(
  envelope: EnvelopeModel,
  values: AddressValues,
  audience: AddressFieldsProps["audience"],
): ReactNode {
  const { country } = envelope;
  const notes: string[] = [];
  if (country && envelope.local) {
    const fmt = country.fmt.replace(/^[^%]*/, "");
    const parts = [
      fmt.startsWith("%Z") && "postcode first",
      fmt.endsWith("%N") && "name last",
    ].filter(Boolean);
    if (parts.length > 0) {
      notes.push(`${LANGUAGE[country.code] ?? country.name} order: ${parts.join(", ")}.`);
    }
  }
  if (country && envelope.lines.some((line) => line.uppercased)) {
    const upper = UPPER_FIELDS.filter(
      ([field, token]) => country.upper.has(token) && values[field] !== values[field].toUpperCase(),
    ).map(([field]) => field);
    if (upper.length > 0) {
      const labels = upper.map((field, i) => {
        const label = fieldLabel(field, country);
        return i === 0 ? label : label.toLowerCase();
      });
      const list =
        labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
      notes.push(
        `${list} ${upper.length === 1 ? "prints" : "print"} in capitals${country.code === "GB" ? ", as Royal Mail asks" : ""}.`,
      );
    }
  }
  if (country && envelope.domestic && values.country_code !== "") {
    const sender =
      audience.kind === "owner" ? "you mail" : `${audience.ownerName || "the sender"} mails`;
    notes.push(`No country line: ${sender} from ${placeName(country)}.`);
  }
  return notes.length > 0 ? notes.join(" ") : null;
}

export function AddressFields({
  defaults,
  legacyCountry,
  senderCountry,
  audience,
  styles,
  errors,
  errorsKey,
  preview,
  handleRef,
  prefillCountry = true,
  requireStreet = false,
}: AddressFieldsProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const initial = useRef(initialValues(defaults));
  const unrecognized = legacyCountry?.trim() ? legacyCountry.trim() : null;
  const [values, setValues] = useState<AddressValues>(() => ({
    ...initial.current,
    country_code:
      initial.current.country_code || (unrecognized || !prefillCountry ? "" : senderCountry),
  }));
  const startCode = useRef(values.country_code);
  const [stash, setStash] = useState<Partial<AddressValues>>({});
  const [showLine2, setShowLine2] = useState(initial.current.address_line2 !== "");
  // Until the country changes, fields the layout hides aren't posted, so a save leaves them alone.
  const [countryChanged, setCountryChanged] = useState(false);
  const [postcodeError, setPostcodeError] = useState<{ text: string; fromServer: boolean } | null>(
    errors?.postal_code ? { text: errors.postal_code, fromServer: true } : null,
  );
  const [seenErrorsKey, setSeenErrorsKey] = useState(errorsKey);
  if (errorsKey !== seenErrorsKey) {
    setSeenErrorsKey(errorsKey);
    setPostcodeError(errors?.postal_code ? { text: errors.postal_code, fromServer: true } : null);
  }
  const name = useFormHousehold(anchor);

  const layoutCode = values.country_code || (unrecognized ? null : senderCountry);
  const country = getCountry(layoutCode);
  const layout = addressLayout(layoutCode);
  const [extraFields] = useState(() =>
    ADDRESS_FIELDS.filter(
      (field) => !layout.fields.has(field) && initial.current[field].trim() !== "",
    ),
  );

  function problem(next: AddressValues = values): string | null {
    const postcode = normalizePostcode(next.country_code, next.postal_code);
    const unchanged =
      postcode === normalizePostcode(initial.current.country_code, initial.current.postal_code) &&
      next.country_code === initial.current.country_code;
    return unchanged ? null : postcodeProblem(next.country_code, postcode);
  }

  const clientError = (text: string | null) =>
    setPostcodeError(text === null ? null : { text, fromServer: false });

  useImperativeHandle(handleRef, () => ({
    validate() {
      const found = problem();
      clientError(found);
      if (found) {
        const field = document.getElementById("postal_code");
        field?.scrollIntoView({ block: "center", behavior: "smooth" });
        field?.focus({ preventScroll: true });
      }
      return found === null;
    },
  }));

  function changeCountry(code: string) {
    const nextCode = code || (unrecognized ? null : senderCountry);
    const nextLayout = addressLayout(nextCode);
    const nextCountry = getCountry(nextCode);
    // A list of states (US) can't show text that isn't one of them.
    const fit = (field: AddressField, value: string): string | null => {
      const state = field === "state_region" ? normalizeState(nextCode, value) : value;
      const listed =
        field !== "state_region" ||
        !nextCountry?.subdivisions ||
        value === "" ||
        nextCountry.subdivisions.some(([sub]) => sub === state);
      return listed ? state : null;
    };
    const backToStart = code === startCode.current;
    const kept: Partial<AddressValues> = {};
    const dropped: Partial<AddressValues> = {};
    for (const field of ADDRESS_FIELDS) {
      const value = values[field];
      const fitted = nextLayout.fields.has(field) ? fit(field, value) : null;
      if (fitted !== null && fitted !== "") kept[field] = fitted;
      else if (value !== "") dropped[field] = value;
    }
    const restored: Partial<AddressValues> = {};
    for (const field of ADDRESS_FIELDS) {
      if (kept[field]) continue;
      const source =
        backToStart && extraFields.includes(field)
          ? initial.current[field]
          : nextLayout.fields.has(field)
            ? stash[field]
            : undefined;
      const fitted = source ? fit(field, source) : null;
      if (fitted) restored[field] = fitted;
    }
    const next = { ...BLANK_ADDRESS, ...kept, ...restored, country_code: code } as AddressValues;
    setStash({ ...stash, ...dropped });
    setValues(next);
    setCountryChanged(!backToStart);
    if (nextLayout.line2OnlyWhenFilled) setShowLine2(next.address_line2 !== "");
    clientError(postcodeError ? problem(next) : null);
  }

  function setField(field: AddressField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === "postal_code" && postcodeError) setPostcodeError(null);
  }

  const typed = {
    addressLine1: values.address_line1,
    addressLine2: values.address_line2,
    district: values.district,
    city: values.city,
    stateRegion: values.state_region,
    postalCode: values.postal_code,
    countryCode: values.country_code || null,
    legacyCountry: values.country_code ? null : unrecognized,
  };
  const printed = formatEnvelope(
    { ...typed, postalCode: normalizePostcode(values.country_code, values.postal_code) },
    { name, senderCountry },
  );
  const asTyped = formatEnvelope(typed, { name, senderCountry, asTyped: true });
  const envelope = printed && {
    ...printed,
    lines: printed.lines.map((line, i) => ({
      text: line.text,
      uppercased: line.text !== asTyped?.lines[i]?.text,
    })),
  };

  const visible = (spec: AddressFieldSpec) =>
    spec.name !== "address_line2" || !layout.line2OnlyWhenFilled || showLine2;
  const extraRows = countryChanged
    ? []
    : extraFields.map((name) => ({
        fields: [
          {
            name,
            label: fieldLabel(name, country),
            required: false,
            options: null,
            autoComplete: "off",
          } satisfies AddressFieldSpec,
        ],
        wideOnly: false,
      }));
  const rows = [...layout.rows, ...extraRows];
  const shown = new Set(
    rows.flatMap((row) => row.fields.filter(visible).map((field) => field.name)),
  );

  const label = (spec: AddressFieldSpec) => (
    <label htmlFor={spec.name} className={styles.label}>
      {spec.label}
      {spec.required ? null : (
        <span className="font-normal text-muted-foreground"> (optional)</span>
      )}
    </label>
  );

  const control = (spec: AddressFieldSpec) => {
    const invalid = spec.name === "postal_code" && postcodeError !== null;
    const common = {
      id: spec.name,
      name: spec.name,
      autoComplete: spec.autoComplete,
      required: (requireStreet && spec.name === "address_line1") || undefined,
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? "postal_code-error" : undefined,
      className: `${styles.input} w-full min-w-0 ${invalid ? "border-destructive focus-visible:border-destructive" : ""}`,
    };
    if (spec.options) {
      const value = values[spec.name];
      const listed = value === "" || spec.options.some(([code]) => code === value);
      return (
        <select
          {...common}
          value={value}
          onChange={(event) => setField(spec.name, event.target.value)}
          className={`${common.className} ${SELECT_CHEVRON_CLASSES}`}
          style={SELECT_CHEVRON_STYLE}
        >
          <option value="">Select…</option>
          {listed ? null : <option value={value}>{value}</option>}
          {spec.options.map(([code, optionName]) => (
            <option key={code} value={code}>
              {optionName}
            </option>
          ))}
        </select>
      );
    }
    const numeric =
      spec.name === "postal_code" &&
      /^\d+$/.test(country?.zipExample ?? "") &&
      !/-| |\\s/.test(country?.zip?.source ?? "-");
    return (
      <input
        {...common}
        type="text"
        maxLength={ADDRESS_MAX_LENGTH[spec.name]}
        value={values[spec.name]}
        inputMode={numeric ? "numeric" : undefined}
        autoCapitalize={spec.name === "postal_code" ? "characters" : undefined}
        onChange={(event) => setField(spec.name, event.target.value)}
        onBlur={spec.name === "postal_code" ? () => clientError(problem()) : undefined}
      />
    );
  };

  const fields = (
    <div ref={anchor} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="country_code" className={styles.label}>
          Country
        </label>
        <CountrySelect
          id="country_code"
          name="country_code"
          value={values.country_code}
          onChange={changeCountry}
          className={styles.input}
          allowBlank={startCode.current === ""}
          invalid={Boolean(errors?.country_code)}
          describedBy={
            [
              unrecognized && !values.country_code ? "country_code-hint" : null,
              errors?.country_code ? "country_code-error" : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {unrecognized && !values.country_code ? (
          <p id="country_code-hint" className="text-xs text-amber-700 dark:text-amber-300">
            Saved as “{unrecognized}”, which isn&apos;t on the list. Pick the country so the
            envelope prints right.
          </p>
        ) : null}
        {errors?.country_code ? (
          <p id="country_code-error" className="text-xs text-destructive">
            {errors.country_code}
          </p>
        ) : null}
      </div>

      {rows.map((row) => {
        const specs = row.fields.filter(visible);
        if (specs.length === 0) return null;
        const hasPostcode = specs.some((spec) => spec.name === "postal_code");
        return (
          <div key={specs.map((spec) => spec.name).join("+")} className="flex flex-col gap-1.5">
            <div
              className={
                specs.length === 1
                  ? "flex flex-col gap-1.5"
                  : row.wideOnly
                    ? "grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-3"
                    : "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3"
              }
            >
              {specs.map((spec) => (
                <div key={spec.name} className="flex min-w-0 flex-col gap-1.5">
                  {label(spec)}
                  {control(spec)}
                </div>
              ))}
            </div>
            {hasPostcode && postcodeError ? (
              // The form's own alert already reads a server error out.
              <p
                id="postal_code-error"
                role={postcodeError.fromServer ? undefined : "alert"}
                className="text-xs text-destructive"
              >
                {postcodeError.text}
              </p>
            ) : null}
          </div>
        );
      })}

      {countryChanged
        ? ADDRESS_FIELDS.filter((field) => !shown.has(field)).map((field) => (
            <input key={field} type="hidden" name={field} value="" />
          ))
        : null}
    </div>
  );

  const card = envelope ? (
    <Envelope
      lines={envelope.lines}
      highlight
      caption={previewCaption(envelope, values, audience)}
    />
  ) : (
    <div className="rounded-md border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
      {audience.kind === "owner"
        ? "The envelope fills in once there's a street address."
        : "Your envelope fills in as you type your street address."}
    </div>
  );

  if (preview === "beside") {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        {fields}
        <section
          aria-labelledby="envelope-preview-heading"
          className="flex flex-col gap-1.5 lg:sticky lg:top-6 lg:self-start"
        >
          <h2 id="envelope-preview-heading" className={styles.label}>
            On the envelope
          </h2>
          {card}
        </section>
      </div>
    );
  }
  return (
    <>
      {fields}
      <section aria-label="Envelope preview">{card}</section>
    </>
  );
}
