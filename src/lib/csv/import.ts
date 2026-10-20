import Papa from "papaparse";
import { countryCodeFor } from "@/lib/address/countries";
import {
  checkAddress,
  CONTACT_FIELDS,
  contactSchema,
  type ContactField,
  type ContactInput,
  withoutSamePartnerEmail,
} from "@/lib/validation/contact";

// NOTE: keep this module dependency-clean (no server-only imports, no db/env
// access) — it runs in the browser for the import preview.

/** Hard cap on data rows per import; mirrors the server action's max(1000). */
export const CSV_ROW_LIMIT = 1000;

export type CsvRowError = {
  /** 1-based data row number (header row excluded); 0 for file-level errors. */
  row: number;
  message: string;
};

export type ParseContactsCsvResult = {
  valid: ContactInput[];
  errors: CsvRowError[];
};

/** Common export-header spellings → canonical contact fields. */
const HEADER_ALIASES: Record<string, ContactField> = {
  name: "full_name",
  name_on_envelope: "full_name",
  envelope_name: "full_name",
  partner: "partner_name",
  spouse: "partner_name",
  kids: "kids_names",
  children: "kids_names",
  zip: "postal_code",
  zipcode: "postal_code",
  postcode: "postal_code",
  state: "state_region",
  province: "state_region",
  region: "state_region",
  address: "address_line1",
  street: "address_line1",
  address1: "address_line1",
  street_address: "address_line1",
  address2: "address_line2",
  country: "country_code",
  nation: "country_code",
  suburb: "district",
  neighborhood: "district",
  neighbourhood: "district",
  "e-mail": "email",
  email_address: "email",
  email_2: "partner_email",
  second_email: "partner_email",
  dob: "birthday",
  date_of_birth: "birthday",
  note: "notes",
};

const headerKey = (header: string) => header.trim().toLowerCase().replace(/[\s_-]+/g, "");

const FIELD_BY_HEADER = new Map<string, ContactField>([
  ...Object.entries(HEADER_ALIASES).map(([alias, field]) => [headerKey(alias), field] as const),
  ...CONTACT_FIELDS.map((field) => [headerKey(field), field] as const),
]);

function resolveHeader(raw: string): ContactField | undefined {
  return FIELD_BY_HEADER.get(headerKey(raw));
}

const NAME_WORD = /^\p{Lu}(?=.*\p{Ll})[\p{L}'’-]*\p{L}$/u;
const INITIALS = /^\p{Lu}{2}$/u;
export const NOT_NAMES = new Set([
  ...["family", "fam", "kids", "kid", "children", "child", "baby", "guest", "guests", "friends", "the"],
  ...["mr", "mrs", "ms", "mx", "dr", "rev", "prof", "sir", "dame", "lady", "lord", "miss", "fr", "hon"],
  ...["aunt", "uncle", "grandma", "grandpa", "nana", "papa", "mom", "dad"],
  ...["jr", "sr", "ii", "iv", "esq", "phd", "md"],
  ...["van", "von", "de", "da", "del", "der", "la", "le", "di", "du", "st"],
]);

export function splitCouple(
  name: string,
): { full_name: string; partner_name: string } | undefined {
  const words = name.trim().split(/\s+/);
  const separator = words.findIndex((word) => word === "&" || word.toLowerCase() === "and");
  if (separator < 1) return undefined;
  const left = words.slice(0, separator);
  const right = words.slice(separator + 1);
  const isName = (word: string, i: number) =>
    (NAME_WORD.test(word) || (i === 0 && INITIALS.test(word))) &&
    !NOT_NAMES.has(word.toLowerCase());
  if (!left.every(isName) || !right.every(isName)) return undefined;
  if (left.length === 1 && right.length === 1) {
    return { full_name: left[0], partner_name: right[0] };
  }
  if (left.length === 1 && right.length === 2) {
    return { full_name: `${left[0]} ${right[1]}`, partner_name: right.join(" ") };
  }
  if (left.length === 2 && right.length === 2) {
    return { full_name: left.join(" "), partner_name: right.join(" ") };
  }
  return undefined;
}

const EXPECTED_HEADERS_MESSAGE = `No recognizable columns found. Expected headers such as: ${CONTACT_FIELDS.join(", ")}.`;

/**
 * Parses CSV text into contact rows validated with `contactSchema`.
 *
 * - Headers match case-insensitively ignoring spaces, underscores and hyphens,
 *   and common aliases (name, spouse, zip, dob, ...) are accepted.
 * - Unknown columns are ignored; a file with no recognizable header at all
 *   yields a single file-level error.
 * - At most {@link CSV_ROW_LIMIT} data rows are parsed; anything beyond that
 *   is reported as one "Row limit" error, not one error per excess row.
 */
export function parseContactsCsv(text: string): ParseContactsCsvResult {
  // Excel prepends a UTF-8 BOM; without stripping it the first header would
  // parse as "﻿full_name" and never match.
  const input = text.replace(/^﻿/, "");
  if (input.trim() === "") {
    return { valid: [], errors: [{ row: 0, message: "The file is empty." }] };
  }

  // preview stops the parser after limit+1 rows, so a 100k-row file never
  // materializes beyond the cap; the +1 row is how we detect overflow.
  const parsed = Papa.parse<Record<string, string | undefined>>(input, {
    header: true,
    skipEmptyLines: true,
    preview: CSV_ROW_LIMIT + 1,
  });

  const columnMap: [source: string, target: ContactField][] = [];
  for (const field of parsed.meta.fields ?? []) {
    const target = resolveHeader(field);
    if (target) columnMap.push([field, target]);
  }
  if (columnMap.length === 0) {
    return { valid: [], errors: [{ row: 0, message: EXPECTED_HEADERS_MESSAGE }] };
  }

  const valid: ContactInput[] = [];
  const errors: CsvRowError[] = [];

  parsed.data.slice(0, CSV_ROW_LIMIT).forEach((row, i) => {
    const candidate: Partial<Record<ContactField, string>> = {};
    // Columns apply left-to-right, so when two headers map to the same field
    // (e.g. "name" and "full_name") the last non-blank one wins.
    for (const [source, target] of columnMap) {
      const value = row[source];
      // Short rows leave trailing columns undefined; omit those keys so
      // contactSchema's optionals apply instead of failing on undefined.
      if (typeof value === "string" && (value.trim() !== "" || !candidate[target])) {
        candidate[target] = value;
      }
    }
    if (!candidate.partner_name?.trim()) {
      const couple = splitCouple(candidate.full_name ?? "");
      if (couple) Object.assign(candidate, couple);
    }
    const country = candidate.country_code?.trim() ?? "";
    if (country !== "") {
      const code = countryCodeFor(country);
      if (code === null) {
        errors.push({
          row: i + 1,
          message: `country: "${country.slice(0, 60)}" isn't a country we know. Use its English name or two-letter code.`,
        });
        return;
      }
      candidate.country_code = code;
    }

    const result = contactSchema.safeParse(candidate);
    const address = result.success ? checkAddress(result.data) : null;
    if (address?.ok) {
      valid.push(withoutSamePartnerEmail(address.data));
    } else if (address) {
      errors.push({ row: i + 1, message: `${address.field}: ${address.error}` });
    } else if (!result.success) {
      const issue = result.error.issues[0];
      const message = issue
        ? [issue.path.join("."), issue.message].filter(Boolean).join(": ")
        : "Invalid row";
      errors.push({ row: i + 1, message });
    }
  });

  if (parsed.data.length > CSV_ROW_LIMIT) {
    errors.push({
      row: CSV_ROW_LIMIT + 1,
      message: `Row limit is ${CSV_ROW_LIMIT}. Rows past row ${CSV_ROW_LIMIT} were ignored.`,
    });
  }

  return { valid, errors };
}
