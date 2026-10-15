import { describe, expect, it } from "vitest";
import { CONTACT_FIELDS } from "@/lib/validation/contact";
import { CSV_COLUMNS, contactsToCsv } from "./export";
import { parseContactsCsv } from "./import";

const HEADER =
  "full_name,partner_name,kids_names,first_name,last_name,partner_first_name,partner_last_name,email,birthday,address_line1,address_line2,city,state_region,postal_code,country,notes";

/** Split a CSV string into records on CRLF, dropping the trailing empty entry. */
function records(csv: string): string[] {
  const parts = csv.split("\r\n");
  expect(parts.at(-1)).toBe(""); // file ends with CRLF
  return parts.slice(0, -1);
}

describe("contactsToCsv", () => {
  it("emits exactly the canonical header row for zero rows", () => {
    expect(contactsToCsv([])).toBe(`${HEADER}\r\n`);
    // The canonical CONTACT_FIELDS the importer reads, in order, with the
    // structured name columns after the display names (import ignores them).
    expect(CSV_COLUMNS.filter((c) => (CONTACT_FIELDS as readonly string[]).includes(c))).toEqual([
      ...CONTACT_FIELDS,
    ]);
  });

  it("serializes fields in canonical column order", () => {
    const csv = contactsToCsv([
      {
        full_name: "Ada Lovelace",
        partner_name: "William King",
        kids_names: "Byron",
        first_name: "Ada",
        last_name: "Lovelace",
        partner_first_name: "William",
        partner_last_name: "King",
        email: "ada@example.com",
        birthday: "1815-12-10",
        address_line1: "12 St James Sq",
        address_line2: "Flat 2",
        city: "London",
        state_region: "Greater London",
        postal_code: "SW1Y 4JH",
        country: "UK",
        notes: "met at a party",
      },
    ]);
    expect(records(csv)).toEqual([
      HEADER,
      "Ada Lovelace,William King,Byron,Ada,Lovelace,William,King,ada@example.com,1815-12-10,12 St James Sq,Flat 2,London,Greater London,SW1Y 4JH,UK,met at a party",
    ]);
  });

  it("uses CRLF line endings throughout, including a trailing one", () => {
    const csv = contactsToCsv([{ full_name: "Ada" }, { full_name: "Grace" }]);
    expect(csv).toBe(`${HEADER}\r\nAda,,,,,,,,,,,,,,,\r\nGrace,,,,,,,,,,,,,,,\r\n`);
    // No bare LFs anywhere (every \n is part of a \r\n).
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("renders null and missing fields as empty strings", () => {
    const csv = contactsToCsv([
      { full_name: "Grace Hopper", email: null, city: "Arlington" },
    ]);
    expect(records(csv)[1]).toBe("Grace Hopper,,,,,,,,,,,Arlington,,,,");
  });

  describe("RFC 4180 quoting", () => {
    it("quotes fields containing commas", () => {
      const csv = contactsToCsv([{ full_name: "Lovelace, Ada" }]);
      expect(records(csv)[1]).toBe('"Lovelace, Ada",,,,,,,,,,,,,,,');
    });

    it("quotes fields containing double quotes and doubles them", () => {
      const csv = contactsToCsv([{ full_name: 'Ada "The Countess" Lovelace' }]);
      expect(records(csv)[1]).toBe('"Ada ""The Countess"" Lovelace",,,,,,,,,,,,,,,');
    });

    it("quotes fields containing newlines (LF and CRLF)", () => {
      const csv = contactsToCsv([
        { full_name: "Ada", notes: "line one\nline two" },
        { full_name: "Grace", notes: "line one\r\nline two" },
      ]);
      expect(csv).toBe(
        `${HEADER}\r\n` +
          'Ada,,,,,,,,,,,,,,,"line one\nline two"\r\n' +
          'Grace,,,,,,,,,,,,,,,"line one\r\nline two"\r\n',
      );
    });

    it("leaves plain fields unquoted", () => {
      const csv = contactsToCsv([{ full_name: "Ada Lovelace" }]);
      expect(records(csv)[1]).toBe("Ada Lovelace,,,,,,,,,,,,,,,");
    });
  });

  describe("formula injection protection", () => {
    it.each([
      ["=", "=HYPERLINK(\"http://evil.test\",\"click\")"],
      ["+", "+1-555-0100"],
      ["-", "-2+3+cmd"],
      ["@", "@SUM(A1)"],
      ["tab", "\tleading tab"],
      ["CR", "\rleading cr"],
    ])("prefixes cells starting with %s with a single quote", (_label, value) => {
      const csv = contactsToCsv([{ full_name: "Ada", notes: value }]);
      const row = records(csv)[1] ?? "";
      // The serialized cell must start with ' (possibly inside RFC 4180 quotes).
      const cell = row.startsWith("Ada,,,,,,,,,,,,,,,")
        ? row.slice("Ada,,,,,,,,,,,,,,,".length)
        : "";
      const unquoted = cell.startsWith('"')
        ? cell.slice(1, -1).replace(/""/g, '"')
        : cell;
      expect(unquoted).toBe(`'${value}`);
    });

    it("does not prefix cells starting with safe characters", () => {
      const csv = contactsToCsv([
        { full_name: "Ada", notes: "safe =embedded, not leading" },
      ]);
      expect(records(csv)[1]).toBe('Ada,,,,,,,,,,,,,,,"safe =embedded, not leading"');
    });

    it("applies quoting after sanitizing (formula value with a comma)", () => {
      const csv = contactsToCsv([{ full_name: '=HYPERLINK("http://evil.test","x")' }]);
      expect(records(csv)[1]).toBe(
        '"\'=HYPERLINK(""http://evil.test"",""x"")",,,,,,,,,,,,,,,',
      );
    });
  });

  it("round-trips through parseContactsCsv losslessly (except formula prefixes)", () => {
    const rows = [
      {
        full_name: "Lovelace, Ada",
        partner_name: 'William "Will" King',
        kids_names: "Byron",
        first_name: "Ada",
        last_name: "Lovelace",
        partner_first_name: "William",
        partner_last_name: "King",
        email: "ada@example.com",
        birthday: "1815-12-10",
        address_line1: "12 St James Sq",
        address_line2: "Flat 2",
        city: "London",
        state_region: "Greater London",
        postal_code: "SW1Y 4JH",
        country: "UK",
        notes: "line one\nline two, with comma",
      },
      { full_name: "Grace Hopper", city: "Arlington" },
    ];

    const { valid, errors } = parseContactsCsv(contactsToCsv(rows));

    // The import reads the display names; the structured columns are ignored.
    const displayRow = Object.fromEntries(
      Object.entries(rows[0]).filter(([column]) => !/_(first|last)_name$|^(first|last)_name$/.test(column)),
    );
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      displayRow,
      { full_name: "Grace Hopper", city: "Arlington" },
    ]);
  });

  it("round-trip: formula-prefixed cells come back with the added quote", () => {
    // Documented tradeoff: injection protection wins over losslessness.
    // A cell that started with =, +, -, @, tab, or CR gains a leading '
    // that survives export → import. This is intentional (OWASP CSV
    // injection guidance) — the ' is what neutralizes the formula in
    // Excel/Numbers/Sheets.
    const { valid, errors } = parseContactsCsv(
      contactsToCsv([{ full_name: "=SUM(A1)", notes: "@cmd" }]),
    );

    expect(errors).toEqual([]);
    expect(valid).toEqual([{ full_name: "'=SUM(A1)", notes: "'@cmd" }]);
  });
});
