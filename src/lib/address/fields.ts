import { getCountry, type Country, type FormatField } from "./countries";

export const ADDRESS_FIELDS = [
  "address_line1",
  "address_line2",
  "district",
  "city",
  "state_region",
  "postal_code",
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export const ADDRESS_MAX_LENGTH: Record<AddressField, number> = {
  address_line1: 200,
  address_line2: 200,
  district: 120,
  city: 120,
  state_region: 120,
  postal_code: 20,
};

export type AddressFieldSpec = {
  name: AddressField;
  label: string;
  required: boolean;
  options: readonly (readonly [string, string])[] | null;
  autoComplete: string;
};

export type AddressRow = {
  fields: AddressFieldSpec[];
  wideOnly: boolean;
};

export type AddressLayout = {
  rows: AddressRow[];
  fields: ReadonlySet<AddressField>;
  line2OnlyWhenFilled: boolean;
};

const FIELD_FOR: Partial<Record<FormatField, AddressField>> = {
  D: "district",
  C: "city",
  S: "state_region",
  Z: "postal_code",
};

const TOKEN_FOR: Record<AddressField, FormatField> = {
  address_line1: "A",
  address_line2: "A",
  district: "D",
  city: "C",
  state_region: "S",
  postal_code: "Z",
};

const SHORT = new Set<AddressField>(["district", "city", "state_region", "postal_code"]);

const STREET_AND_NUMBER = new Set([
  "NL",
  "DE",
  "AT",
  "CH",
  "BE",
  "LU",
  "DK",
  "NO",
  "SE",
  "FI",
  "IS",
  "PL",
  "CZ",
  "SK",
  "HU",
  "SI",
  "HR",
  "IT",
  "ES",
  "PT",
  "GR",
  "EE",
  "LV",
  "LT",
]);
const FLAT_FIRST = new Set(["GB", "IE", "AU", "NZ"]);
const ONE_STREET_LINE = new Set(["NL", "CN", "TW", "HK", "MO", "JP", "KR"]);
const POSTCODE = new Set(["GB", "NL", "AU", "NZ", "ZA"]);

const STATE_LABELS: Record<string, string> = {
  area: "Area",
  county: "County",
  department: "Department",
  district: "District",
  do_si: "Province",
  emirate: "Emirate",
  island: "Island",
  oblast: "Oblast",
  parish: "Parish",
  prefecture: "Prefecture",
  province: "Province",
  state: "State",
};
const LOCALITY_LABELS: Record<string, string> = {
  city: "City",
  district: "District",
  post_town: "Post town",
  suburb: "Suburb",
};
const SUBLOCALITY_LABELS: Record<string, string> = {
  district: "District",
  neighborhood: "Neighborhood",
  suburb: "Suburb",
  townland: "Townland",
  village_township: "Village or township",
};

export function postcodeLabel(country: Country | null): string {
  if (country === null) return "Postal code";
  if (POSTCODE.has(country.code)) return "Postcode";
  return (
    { zip: "ZIP code", pin: "PIN code", eircode: "Eircode" }[country.zipNameType] ?? "Postal code"
  );
}

export function fieldLabel(field: AddressField, country: Country | null): string {
  switch (field) {
    case "address_line1":
      return country && STREET_AND_NUMBER.has(country.code)
        ? "Street and house number"
        : "Street address";
    case "address_line2":
      return country && FLAT_FIRST.has(country.code) ? "Flat, building" : "Apartment, suite";
    case "district":
      return SUBLOCALITY_LABELS[country?.sublocalityNameType ?? "suburb"] ?? "District";
    case "city":
      return LOCALITY_LABELS[country?.localityNameType ?? "city"] ?? "City";
    case "state_region":
      if (country?.code === "GB") return "County";
      return country ? (STATE_LABELS[country.stateNameType] ?? "Province") : "State / region";
    case "postal_code":
      return postcodeLabel(country);
  }
}

const UNKNOWN_FORMAT = "%A%n%C%n%S %Z";

export function addressLayout(code: string | null): AddressLayout {
  const country = getCountry(code);
  const format = country?.fmt ?? UNKNOWN_FORMAT;
  const lines = format
    .split("%n")
    .map((line) => [...line.matchAll(/%([A-Z])/g)].map((m) => m[1] as FormatField));
  const spec = (name: AddressField): AddressFieldSpec => ({
    name,
    label: fieldLabel(name, country),
    required:
      name === "address_line2"
        ? false
        : (country?.require.has(TOKEN_FOR[name]) ?? name === "address_line1"),
    options: name === "state_region" ? (country?.subdivisions ?? null) : null,
    autoComplete: {
      address_line1: "address-line1",
      address_line2: "address-line2",
      district: "address-level3",
      city: "address-level2",
      state_region: "address-level1",
      postal_code: "postal-code",
    }[name],
  });

  const streetAt = lines.findIndex((line) => line.includes("A"));
  const zipAt = lines.findIndex((line) => line.includes("Z"));
  const zipFirst = zipAt !== -1 && zipAt < streetAt;

  const groups: AddressField[][] = [];
  for (const line of lines) {
    if (line.includes("A")) {
      groups.push(["address_line1"], ["address_line2"]);
      continue;
    }
    const fields = line
      .filter((token) => !(zipFirst && token === "Z"))
      .map((token) => FIELD_FOR[token])
      .filter((field): field is AddressField => field !== undefined);
    if (fields.length === 3) {
      groups.push(
        ...(fields[0] === "state_region"
          ? [fields.slice(0, 2), fields.slice(2)]
          : [fields.slice(0, 1), fields.slice(1)]),
      );
    } else if (fields.length > 0) {
      groups.push(fields);
    }
  }
  if (zipFirst) groups.push(["postal_code"]);

  const rows: AddressRow[] = [];
  for (const group of groups) {
    const previous = rows.at(-1);
    if (
      group.length === 1 &&
      SHORT.has(group[0]) &&
      previous?.fields.length === 1 &&
      !previous.wideOnly &&
      SHORT.has(previous.fields[0].name)
    ) {
      previous.fields.push(spec(group[0]));
      previous.wideOnly = true;
      continue;
    }
    rows.push({ fields: group.map(spec), wideOnly: false });
  }
  return {
    rows,
    fields: new Set(rows.flatMap((row) => row.fields.map((field) => field.name))),
    line2OnlyWhenFilled: country !== null && ONE_STREET_LINE.has(country.code),
  };
}
