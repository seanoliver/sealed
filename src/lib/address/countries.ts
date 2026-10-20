import data from "./data.json";
import { COUNTRY_ALIASES, countryKey } from "./aliases";

export type FormatField = "N" | "O" | "A" | "D" | "C" | "S" | "Z";

export type Country = {
  code: string;
  name: string;
  fmt: string;
  lfmt: string | null;
  require: ReadonlySet<FormatField>;
  upper: ReadonlySet<FormatField>;
  zip: RegExp | null;
  zipExample: string | null;
  zipNameType: string;
  stateNameType: string;
  localityNameType: string;
  sublocalityNameType: string;
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

const UPPER_OVERRIDES: Record<string, string> = { US: "" };

const cache = new Map<string, Country>();

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
    upper: fieldSet(UPPER_OVERRIDES[code] ?? record.u ?? "C"),
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

export function countryName(code: string): string {
  return getCountry(code)?.name ?? code;
}

export const COUNTRY_OPTIONS: readonly (readonly [string, string])[] = Object.entries(RECORDS).map(
  ([code, record]) => [code, record.n] as const,
);

export function countryKeyEntries(
  records: Record<string, { n: string }> = RECORDS,
): [string, string][] {
  const keys = new Map<string, string>();
  const add = (text: string, code: string) => {
    const key = countryKey(text);
    keys.set(key, code);
    if (/\bsaint\b/.test(key)) keys.set(key.replace(/\bsaint\b/g, "st"), code);
  };
  for (const [code, record] of Object.entries(records)) {
    add(code, code);
    add(record.n, code);
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) add(alias, code);
  return [...keys];
}

let lookup: Map<string, string> | null = null;

function lookupTable(): Map<string, string> {
  lookup ??= new Map(countryKeyEntries());
  return lookup;
}

export function countryCodeFor(text: string | null | undefined): string | null {
  if (!text) return null;
  const key = countryKey(text);
  return key === "" ? null : (lookupTable().get(key) ?? null);
}

export function aliasesFor(code: string): string[] {
  return Object.entries(COUNTRY_ALIASES)
    .filter(([, target]) => target === code)
    .map(([alias]) => alias);
}
