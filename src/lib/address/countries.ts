import data from "./data.json";
import { COUNTRY_ALIASES, countryKey } from "./aliases";

/** A field token in a libaddressinput format string. */
export type FormatField = "N" | "O" | "A" | "D" | "C" | "S" | "Z";

export type Country = {
  code: string;
  /** English name, as menus show it. */
  name: string;
  fmt: string;
  /** Latin-script format, for countries whose `fmt` is in a local script. */
  lfmt: string | null;
  require: ReadonlySet<FormatField>;
  upper: ReadonlySet<FormatField>;
  zip: RegExp | null;
  zipExample: string | null;
  zipNameType: string;
  stateNameType: string;
  localityNameType: string;
  sublocalityNameType: string;
  /** [code, name] pairs where states are picked from a list (US). */
  subdivisions: readonly (readonly [string, string])[] | null;
};

type CountryRecord = {
  n: string;
  f?: string;
  lf?: string;
  r?: string;
  u?: string;
  z?: string;
  x?: string;
  zn?: string;
  sn?: string;
  ln?: string;
  dn?: string;
  s?: [string, string][];
};

const RECORDS = data as unknown as Record<string, CountryRecord>;

const fieldSet = (letters: string) => new Set(letters.split("") as FormatField[]);

const cache = new Map<string, Country>();

/** Metadata for a two-letter code, or null for anything else. */
export function getCountry(code: string | null | undefined): Country | null {
  if (!code) return null;
  const hit = cache.get(code);
  if (hit) return hit;
  const record = Object.hasOwn(RECORDS, code) ? RECORDS[code] : undefined;
  if (!record) return null;
  const country: Country = {
    code,
    name: record.n,
    fmt: record.f ?? "%N%n%O%n%A%n%C",
    lfmt: record.lf ?? null,
    require: fieldSet(record.r ?? "AC"),
    upper: fieldSet(record.u ?? "C"),
    zip: record.z ? new RegExp(`^(?:${record.z})$`, "i") : null,
    zipExample: record.x ?? null,
    zipNameType: record.zn ?? "postal",
    stateNameType: record.sn ?? "province",
    localityNameType: record.ln ?? "city",
    sublocalityNameType: record.dn ?? "suburb",
    subdivisions: record.s ?? null,
  };
  cache.set(code, country);
  return country;
}

export function isCountryCode(code: unknown): code is string {
  return typeof code === "string" && Object.hasOwn(RECORDS, code);
}

/** English name for a code; the code itself when it isn't one we know. */
export function countryName(code: string): string {
  return getCountry(code)?.name ?? code;
}

/** Every country as [code, English name], sorted by name. */
export const COUNTRY_OPTIONS: readonly (readonly [string, string])[] = Object.entries(RECORDS).map(
  ([code, record]) => [code, record.n] as const,
);

let lookup: Map<string, string> | null = null;

function lookupTable(): Map<string, string> {
  if (lookup) return lookup;
  lookup = new Map();
  for (const [code, record] of Object.entries(RECORDS)) {
    lookup.set(countryKey(code), code);
    lookup.set(countryKey(record.n), code);
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) lookup.set(countryKey(alias), code);
  return lookup;
}

/**
 * The code for a country name, alias or code as people type it ("usa",
 * "United Kingdom", "CHINA", "nl"), or null when it isn't one we recognize.
 */
export function countryCodeFor(text: string | null | undefined): string | null {
  if (!text) return null;
  const key = countryKey(text);
  return key === "" ? null : (lookupTable().get(key) ?? null);
}

/** Aliases that point at a code, for type-to-filter matching. */
export function aliasesFor(code: string): string[] {
  return Object.entries(COUNTRY_ALIASES)
    .filter(([, target]) => target === code)
    .map(([alias]) => alias);
}
