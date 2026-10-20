/**
 * Adding an alias needs a new migration regenerating private.country_code_for
 * (scripts/generate-address-data.ts --sql), or the database maps it to no code.
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
  "korea republic of": "KR",
  "republic of south korea": "KR",
  "korea democratic peoples republic of": "KP",
  "viet nam": "VN",
  "republic of ireland": "IE",
  eire: "IE",
  brasil: "BR",
  "pr china": "CN",
  "china peoples republic of": "CN",
  "taiwan roc": "TW",
  "republic of china": "TW",
  "taiwan province of china": "TW",
  "n ireland": "GB",
  "united kingdom of great britain and northern ireland": "GB",
  bosnia: "BA",
  "bosnia herzegovina": "BA",
  "iran islamic republic of": "IR",
  "syrian arab republic": "SY",
  "tanzania united republic of": "TZ",
  "moldova republic of": "MD",
  "bolivia plurinational state of": "BO",
  "venezuela bolivarian republic of": "VE",
  "lao peoples democratic republic": "LA",
  "micronesia federated states of": "FM",
  "congo the democratic republic of the": "CD",
  "democratic republic of congo": "CD",
  drc: "CD",
  "congo republic of": "CG",
  "macedonia the former yugoslav republic of": "MK",
  "brunei darussalam": "BN",
  "cabo verde": "CV",
  "holy see": "VA",
  "holy see vatican city state": "VA",
  "palestine state of": "PS",
  "virgin islands british": "VG",
  "virgin islands us": "VI",
  "us virgin islands": "VI",
  "libyan arab jamahiriya": "LY",
  "slovak republic": "SK",
  "kyrgyz republic": "KG",
  "the gambia": "GM",
  "the bahamas": "BS",
};

/** private.country_code_for repeats this normalization in SQL; change both, or they disagree on which text names a country. */
export function countryKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[,()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}
