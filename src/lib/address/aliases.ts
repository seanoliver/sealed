/**
 * Names people type for a country besides its English name and code. Keys
 * are compared after `countryKey`, so case, accents, dots and a leading
 * "the" don't matter. The migration's private.country_code_for was
 * generated from this list plus the English names (see
 * scripts/generate-address-data.ts --sql); add new aliases here and in a
 * new migration together.
 */
export const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US",
  america: "US",
  "united states of america": "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  holland: "NL",
  nederland: "NL",
  prc: "CN",
  "peoples republic of china": "CN",
  "mainland china": "CN",
  中国: "CN",
  中國: "CN",
  中华人民共和国: "CN",
  korea: "KR",
  "republic of korea": "KR",
  "south korea": "KR",
  한국: "KR",
  대한민국: "KR",
  日本: "JP",
  台灣: "TW",
  台湾: "TW",
  香港: "HK",
  deutschland: "DE",
  espana: "ES",
  "russian federation": "RU",
  "czech republic": "CZ",
  turkey: "TR",
  swaziland: "SZ",
  macedonia: "MK",
  burma: "MM",
  "ivory coast": "CI",
  vatican: "VA",
  uae: "AE",
  "hong kong sar": "HK",
  "hong kong sar china": "HK",
  "macao sar china": "MO",
  macau: "MO",
  "palestinian territories": "PS",
  "cape verde": "CV",
  "east timor": "TL",
};

/** Lowercase, accent-free, dot-free, single-spaced, without a leading "the". */
export function countryKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[,()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}
