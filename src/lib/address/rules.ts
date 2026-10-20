import { getCountry, type Country } from "./countries";
import { postcodeLabel } from "./fields";

const ADJECTIVES: Record<string, string> = {
  AT: "Austrian",
  AU: "Australian",
  BE: "Belgian",
  BR: "Brazilian",
  CA: "Canadian",
  CH: "Swiss",
  CN: "Chinese",
  DE: "German",
  DK: "Danish",
  ES: "Spanish",
  FI: "Finnish",
  FR: "French",
  GB: "UK",
  GR: "Greek",
  IE: "Irish",
  IN: "Indian",
  IT: "Italian",
  JP: "Japanese",
  KR: "Korean",
  MX: "Mexican",
  NL: "Dutch",
  NO: "Norwegian",
  NZ: "New Zealand",
  PL: "Polish",
  PT: "Portuguese",
  SE: "Swedish",
  SG: "Singapore",
  TW: "Taiwanese",
  US: "US",
  ZA: "South African",
};

const WITH_THE =
  /^(United|Netherlands|Philippines|Bahamas|Gambia|Czech|Dominican|Central African|Maldives|Marshall|Solomon|Comoros|Cayman|Falkland|Faroe|Cook|British|U\.S\.|Democratic|Republic|Vatican|Turks|Northern Mariana|Cocos|Caribbean)/;

const NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function count(n: number, noun: string): string {
  return `${NUMBERS[n] ?? n} ${noun}${n === 1 ? "" : "s"}`;
}

function shapeOf(example: string): string | null {
  const parts: string[] = [];
  for (const token of example.split(/([ -])/)) {
    if (token === " " || token === "") continue;
    if (token === "-") parts.push("a hyphen");
    else if (/^\d+$/.test(token)) parts.push(count(token.length, "digit"));
    else if (/^[A-Z]+$/.test(token)) parts.push(count(token.length, "letter"));
    else return null;
  }
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function postcodeNoun(country: Country): string {
  const label = postcodeLabel(country);
  const noun =
    label === "ZIP code" || label === "PIN code" || label === "Eircode"
      ? label
      : label.toLowerCase();
  const adjective = ADJECTIVES[country.code];
  if (adjective) return `${/^[AEIO]/.test(adjective) ? "An" : "A"} ${adjective} ${noun}`;
  const name = WITH_THE.test(country.name) ? `the ${country.name}` : country.name;
  return `${/^[aeio]/i.test(noun) ? "An" : "A"} ${noun} in ${name}`;
}

export function postcodeProblem(
  countryCode: string | null | undefined,
  postcode: string | null | undefined,
): string | null {
  const country = getCountry(countryCode);
  const value = postcode?.trim() ?? "";
  if (country?.zip == null || value === "" || country.zip.test(value)) return null;
  const noun = postcodeNoun(country);
  const example = country.zipExample;
  if (example === null) return `${noun} doesn't look like that. Check it and try again.`;
  const shape = shapeOf(example);
  return shape ? `${noun} is ${shape}, like ${example}.` : `${noun} looks like ${example}.`;
}

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

export function normalizePostcode(
  countryCode: string | null | undefined,
  postcode: string,
): string {
  const value = collapse(postcode).toUpperCase();
  const country = getCountry(countryCode);
  if (country === null) return value;
  const compact = value.replace(/ /g, "");
  let formatted = value;
  if ((country.code === "GB" || country.code === "CA") && compact.length > 3) {
    formatted = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  } else if (country.code === "IE" && compact.length === 7) {
    formatted = `${compact.slice(0, 3)} ${compact.slice(3)}`;
  } else if (country.code === "NL") {
    const match = /^(\d{4})([A-Z]{2})$/.exec(compact);
    if (match) formatted = `${match[1]} ${match[2]}`;
  }
  return country.zip === null || country.zip.test(formatted) ? formatted : value;
}

export function normalizeState(countryCode: string | null | undefined, state: string): string {
  const value = collapse(state);
  const subdivisions = getCountry(countryCode)?.subdivisions;
  if (!subdivisions) return value;
  const key = value.replace(/\./g, "").toLowerCase();
  const match = subdivisions.find(
    ([code, name]) => code.toLowerCase() === key || name.toLowerCase() === key,
  );
  return match ? match[0] : value;
}

export type AddressInput = {
  address_line1?: string;
  address_line2?: string;
  district?: string;
  city?: string;
  state_region?: string;
  postal_code?: string;
  country_code?: string;
};

export function normalizeAddress<T extends AddressInput>(input: T): T {
  const out: AddressInput = { ...input };
  const country = input.country_code;
  for (const field of ["address_line1", "address_line2", "district", "city"] as const) {
    if (out[field] !== undefined) out[field] = collapse(out[field]);
  }
  if (out.state_region !== undefined) out.state_region = normalizeState(country, out.state_region);
  if (out.postal_code !== undefined) out.postal_code = normalizePostcode(country, out.postal_code);
  for (const field of Object.keys(out) as (keyof AddressInput)[]) {
    if (out[field] === "") out[field] = undefined;
  }
  return out as T;
}
