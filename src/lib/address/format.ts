import { getCountry, type Country, type FormatField } from "./countries";

export type PostalAddress = {
  addressLine1: string | null;
  addressLine2: string | null;
  district: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  countryCode: string | null;
  legacyCountry?: string | null;
};

type AddressColumns = Omit<PostalAddress, "legacyCountry"> & { legacyCountry: string | null };

export function rowAddress(row: AddressColumns): PostalAddress {
  return {
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    district: row.district,
    city: row.city,
    stateRegion: row.stateRegion,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
    legacyCountry: row.countryCode ? null : row.legacyCountry,
  };
}

export type EnvelopeLine = {
  text: string;
  uppercased: boolean;
};

export type Envelope = {
  lines: EnvelopeLine[];
  local: boolean;
  country: Country | null;
  domestic: boolean;
};

export type EnvelopeOptions = {
  name?: string | null;
  senderCountry: string;
  asTyped?: boolean;
};

const UNKNOWN_FMT = "%N%n%A%n%D%n%C, %S %Z";

const SUBPREMISE_FIRST = new Set(["GB", "IE", "AU", "NZ"]);

const NAME_SUFFIX: Record<string, string> = {
  CN: " 收",
  TW: " 收",
  HK: " 收",
  MO: " 收",
  JP: " 様",
  KR: " 귀하",
};

const clean = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ") ?? "";

export function isLocalScript(
  address: Pick<
    PostalAddress,
    "addressLine1" | "addressLine2" | "district" | "city" | "stateRegion"
  >,
): boolean {
  const text = [
    address.addressLine1,
    address.addressLine2,
    address.district,
    address.city,
    address.stateRegion,
  ].join("");
  for (const char of text) {
    if (/\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char)) return true;
  }
  return false;
}

type Part = { field: FormatField } | { literal: string };

function parseLine(line: string): Part[] {
  const parts: Part[] = [];
  const pattern = /%([A-Z])/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > last) parts.push({ literal: line.slice(last, match.index) });
    parts.push({ field: match[1] as FormatField });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ literal: line.slice(last) });
  return parts;
}

/**
 * One format line with empty fields removed: a literal between two printed
 * fields is kept, as is one that opens the line ("〒", "SINGAPORE ") when the
 * field after it prints. Separators next to an empty field are dropped.
 */
function renderLine(parts: Part[], value: (field: FormatField) => string): string {
  let out = "";
  let pending = "";
  let seenField = false;
  let printed = false;
  // After an empty field, the separator that follows the last printed field wins.
  let skipping = false;
  for (const part of parts) {
    if ("literal" in part) {
      if (!skipping) pending += part.literal;
      continue;
    }
    const text = value(part.field);
    if (text !== "") {
      if (printed || !seenField) out += pending;
      out += text;
      printed = true;
      pending = "";
      skipping = false;
    } else if (printed) {
      skipping = true;
    } else {
      pending = "";
    }
    seenField = true;
  }
  if (!seenField) out = pending;
  return out.trim();
}

export function formatEnvelope(
  address: PostalAddress,
  { name, senderCountry, asTyped = false }: EnvelopeOptions,
): Envelope | null {
  const line1 = clean(address.addressLine1);
  if (line1 === "") return null;
  const line2 = clean(address.addressLine2);
  const legacy = clean(address.legacyCountry);
  const known = getCountry(address.countryCode);
  const country = known ?? (legacy === "" ? getCountry(senderCountry) : null);
  const local = country?.lfmt != null && isLocalScript(address);
  const fmt = country === null ? UNKNOWN_FMT : local ? country.fmt : (country.lfmt ?? country.fmt);
  const upper = asTyped ? new Set<FormatField>() : (country?.upper ?? new Set<FormatField>());

  const street = local
    ? [line1, line2]
    : country !== null && SUBPREMISE_FIRST.has(country.code)
      ? [line2, line1]
      : [line1, line2];
  const suffix = local && country ? (NAME_SUFFIX[country.code] ?? "") : "";
  const city = clean(address.city);
  const state = clean(address.stateRegion);
  const values: Record<FormatField, string> = {
    N: clean(name) === "" ? "" : `${clean(name)}${suffix}`,
    O: "",
    A: "",
    D: clean(address.district),
    C: city,
    S: /%S%C|%C%S/.test(fmt) && state.toLowerCase() === city.toLowerCase() ? "" : state,
    Z: clean(address.postalCode),
  };
  // A stored value the format has no place for still prints, next to the street.
  const countryLine = (known?.name ?? legacy).toUpperCase();
  const slotless = (["D", "C", "S", "Z"] as const).filter(
    (field) =>
      values[field] !== "" &&
      !fmt.includes(`%${field}`) &&
      values[field].toUpperCase() !== countryLine,
  );
  const extra = slotless.map((field) => values[field]);
  values.A = (local ? [...extra, ...street] : [...street, ...extra])
    .filter(Boolean)
    .join(local ? "\n" : ", ");
  const raw = (field: FormatField) => values[field] ?? "";
  const cased = (field: FormatField) => (upper.has(field) ? raw(field).toUpperCase() : raw(field));

  let printsCountry = false;
  const lines: EnvelopeLine[] = [];
  for (const formatLine of fmt.split("%n")) {
    const parts = parseLine(formatLine);
    const typed = renderLine(parts, raw).split("\n");
    const printed = renderLine(parts, cased).split("\n");
    const fixedName = parts.some(
      (part) => "literal" in part && countryLine !== "" && part.literal.includes(countryLine),
    );
    printed.forEach((text, i) => {
      if (text.trim() === "") return;
      if (fixedName && text.includes(countryLine)) printsCountry = true;
      lines.push({ text: text.trim(), uppercased: text !== typed[i] });
    });
  }

  const domestic = known !== null ? known.code === senderCountry : legacy === "";
  if (!domestic && !printsCountry) lines.push({ text: countryLine, uppercased: false });
  return { lines, local, country, domestic };
}

export function envelopeLines(address: PostalAddress, options: EnvelopeOptions): string[] | null {
  return formatEnvelope(address, options)?.lines.map((line) => line.text) ?? null;
}

export function addressSummary(
  address: PostalAddress,
  { senderCountry }: { senderCountry: string },
): string {
  const lines = envelopeLines(address, { senderCountry });
  if (lines) return lines.join(", ");
  const country = getCountry(address.countryCode)?.name ?? address.legacyCountry;
  return [address.district, address.city, address.stateRegion, address.postalCode, country]
    .map(clean)
    .filter(Boolean)
    .join(", ");
}
