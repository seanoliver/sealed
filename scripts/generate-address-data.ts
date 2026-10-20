import { writeFile } from "node:fs/promises";
import path from "node:path";
import { COUNTRY_ALIASES, countryKey } from "../src/lib/address/aliases";

const INDEX_URL = "https://chromium-i18n.appspot.com/ssl-address/data";
const DATA_URL =
  "https://www.gstatic.com/chrome/autofill/libaddressinput/chromium-i18n/ssl-address/data";
const OUT = path.join(__dirname, "../src/lib/address/data.json");

const NAME_OVERRIDES: Record<string, string> = {
  HK: "Hong Kong",
  MO: "Macao",
  MM: "Myanmar",
  CD: "Democratic Republic of the Congo",
  CG: "Republic of the Congo",
  PS: "Palestine",
  UM: "United States Minor Outlying Islands",
  GS: "South Georgia and the South Sandwich Islands",
  HM: "Heard Island and McDonald Islands",
};

// Changing a default without the matching fallback in getCountry misreads every country that omits the key.
const DEFAULTS = {
  fmt: "%N%n%O%n%A%n%C",
  require: "AC",
  upper: "C",
  zip_name_type: "postal",
  state_name_type: "province",
  locality_name_type: "city",
  sublocality_name_type: "suburb",
};

type Raw = Partial<Record<string, string>>;

export type CountryRecord = {
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

async function getJson(url: string): Promise<Raw> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as Raw;
    if (attempt === 3) throw new Error(`${res.status} ${url}`);
  }
}

// gstatic is the documented mirror but misses a few countries (KP); the
// appspot origin it redirects from still serves them.
async function getCountry(code: string): Promise<Raw> {
  try {
    return await getJson(`${DATA_URL}/${code}`);
  } catch {
    return getJson(`${INDEX_URL}/${code}`);
  }
}

function englishName(code: string, names: Intl.DisplayNames): string {
  const name = NAME_OVERRIDES[code] ?? names.of(code) ?? code;
  return name.replace(/\bSt\. /g, "Saint ").replace(/ & /g, " and ");
}

function compact(code: string, raw: Raw, names: Intl.DisplayNames): CountryRecord {
  const record: CountryRecord = { n: englishName(code, names) };
  const keep = <K extends keyof CountryRecord>(
    key: K,
    value: string | undefined,
    fallback?: string,
  ) => {
    if (value !== undefined && value !== fallback) (record as Record<string, unknown>)[key] = value;
  };
  keep("f", raw.fmt, DEFAULTS.fmt);
  keep("lf", raw.lfmt);
  keep("r", raw.require ?? (raw.fmt ? "" : undefined), DEFAULTS.require);
  keep("u", raw.upper ?? (raw.fmt ? "" : undefined), DEFAULTS.upper);
  if (raw.zip) {
    // Fail the run rather than ship a pattern JavaScript can't compile.
    new RegExp(`^(?:${raw.zip})$`, "i");
    record.z = raw.zip;
  }
  keep("x", raw.zipex?.split(",")[0]);
  keep("zn", raw.zip_name_type, DEFAULTS.zip_name_type);
  keep("sn", raw.state_name_type, DEFAULTS.state_name_type);
  keep("ln", raw.locality_name_type, DEFAULTS.locality_name_type);
  keep("dn", raw.sublocality_name_type, DEFAULTS.sublocality_name_type);
  if (code === "US" && raw.sub_keys && raw.sub_names) {
    const keys = raw.sub_keys.split("~");
    const subNames = raw.sub_names.split("~");
    record.s = keys.map((key, i) => [key, subNames[i]]);
  }
  return record;
}

function sqlRows(data: Record<string, CountryRecord>): string {
  const rows = new Map<string, string>();
  for (const [code, record] of Object.entries(data)) {
    rows.set(countryKey(code), code);
    rows.set(countryKey(record.n), code);
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) rows.set(countryKey(alias), code);
  return [...rows]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, code]) => `    ('${key.replace(/'/g, "''")}', '${code}')`)
    .join(",\n");
}

async function main() {
  if (process.argv.includes("--sql")) {
    const { default: data } = await import("../src/lib/address/data.json");
    console.log(sqlRows(data as unknown as Record<string, CountryRecord>));
    return;
  }
  const index = await getJson(INDEX_URL);
  const codes = (index.countries ?? "").split("~").filter(Boolean);
  if (codes.length < 200) throw new Error(`Only ${codes.length} countries in the index`);
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const data: Record<string, CountryRecord> = {};
  for (let i = 0; i < codes.length; i += 16) {
    const batch = codes.slice(i, i + 16);
    const raws = await Promise.all(batch.map(getCountry));
    batch.forEach((code, j) => (data[code] = compact(code, raws[j], names)));
  }
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([, a], [, b]) => a.n.localeCompare(b.n, "en")),
  );
  await writeFile(OUT, `${JSON.stringify(sorted)}\n`);
  console.log(
    `Wrote ${Object.keys(sorted).length} countries to ${path.relative(process.cwd(), OUT)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
