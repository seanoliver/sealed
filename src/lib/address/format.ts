import { getCountry, type Country, type FormatField } from "./countries";

export type PostalAddress = {
  addressLine1: string | null;
  addressLine2: string | null;
  district: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  countryCode: string | null;
  /** Country text from before codes that no code matched; printed as typed. */
  legacyCountry?: string | null;
};

type AddressColumns = Omit<PostalAddress, "legacyCountry"> & { legacyCountry: string | null };

/** A contacts row's address. Leftover country text only counts while no code is set. */
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
  /** The format capitalized something the person typed in lower case. */
  uppercased: boolean;
};

export type Envelope = {
  lines: EnvelopeLine[];
  /** Written in the country's own script and order (postcode first in China). */
  local: boolean;
  country: Country | null;
  /** The sender's own country, so the envelope has no country line. */
  domestic: boolean;
};

export type EnvelopeOptions = {
  /** The household line. Omitted, the envelope has address lines only. */
  name?: string | null;
  /** Code of the country the owner mails from. */
  senderCountry: string;
  /** Skip the country's upper-case rules, to compare against what was typed. */
  asTyped?: boolean;
};

// The old US-order layout, for country text no code matches.
const UNKNOWN_FMT = "%N%n%A%n%D%n%C, %S %Z";

// Countries where the flat or unit is written before the street.
const SUBPREMISE_FIRST = new Set(["GB", "IE", "AU", "NZ"]);

// Added after the name in a local-script envelope.
const NAME_SUFFIX: Record<string, string> = {
  CN: " 收",
  TW: " 收",
  HK: " 收",
  MO: " 收",
  JP: " 様",
  KR: " 귀하",
};

const clean = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ") ?? "";

/** True when a letter in the address is from a non-Latin script (汉字, かな, 한글, Кириллица…). */
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

/** The envelope for an address, or null when there is no street line to mail to. */
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
  const values: Record<FormatField, string> = {
    N: clean(name) === "" ? "" : `${clean(name)}${suffix}`,
    O: "",
    A: street.filter(Boolean).join(local ? "\n" : ", "),
    D: clean(address.district),
    C: clean(address.city),
    // A city that is its own province (上海市, Madrid) prints once.
    S:
      clean(address.stateRegion).toLowerCase() === clean(address.city).toLowerCase()
        ? ""
        : clean(address.stateRegion),
    Z: clean(address.postalCode),
  };
  const raw = (field: FormatField) => values[field] ?? "";
  const cased = (field: FormatField) => (upper.has(field) ? raw(field).toUpperCase() : raw(field));

  const lines: EnvelopeLine[] = [];
  for (const formatLine of fmt.split("%n")) {
    const parts = parseLine(formatLine);
    const typed = renderLine(parts, raw).split("\n");
    const printed = renderLine(parts, cased).split("\n");
    printed.forEach((text, i) => {
      if (text.trim() !== "") lines.push({ text: text.trim(), uppercased: text !== typed[i] });
    });
  }

  const domestic = known !== null ? known.code === senderCountry : legacy === "";
  if (!domestic) {
    const countryLine = (known?.name ?? legacy).toUpperCase();
    const named = new RegExp(`(^|\\s)${countryLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
    if (!lines.some((line) => named.test(line.text))) {
      lines.push({ text: countryLine, uppercased: false });
    }
  }
  return { lines, local, country, domestic };
}

/** Envelope lines as text, or null when there is no street line. */
export function envelopeLines(address: PostalAddress, options: EnvelopeOptions): string[] | null {
  return formatEnvelope(address, options)?.lines.map((line) => line.text) ?? null;
}

/**
 * The address on one line ("Flat 2, 14 Kestrel Lane, BRISTOL, BS6 5QT, UNITED KINGDOM").
 * Without a street, whatever parts there are, so a contact is still recognizable.
 */
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
