import { describe, expect, it } from "vitest";
import { CSV_ROW_LIMIT, NOT_NAMES, parseContactsCsv, splitCouple } from "./import";

const CANONICAL_HEADER =
  "full_name,partner_name,kids_names,email,birthday,address_line1,address_line2,city,state_region,postal_code,country,notes";

describe("parseContactsCsv", () => {
  it("parses canonical headers into ContactInput rows", () => {
    const csv = [
      CANONICAL_HEADER,
      "Ada Lovelace,William King,Byron,ada@example.com,1815-12-10,12 St James Sq,Flat 2,London,Greater London,SW1Y 4JH,UK,met at a party",
      "Grace Hopper,,,grace@example.com,,,,Arlington,VA,22201,USA,",
    ].join("\n");

    const { valid, errors } = parseContactsCsv(csv);

    expect(errors).toEqual([]);
    expect(valid).toHaveLength(2);
    expect(valid[0]).toEqual({
      full_name: "Ada Lovelace",
      partner_name: "William King",
      kids_names: "Byron",
      email: "ada@example.com",
      birthday: "1815-12-10",
      address_line1: "12 St James Sq",
      address_line2: "Flat 2",
      city: "London",
      state_region: "Greater London",
      postal_code: "SW1Y 4JH",
      country: "UK",
      notes: "met at a party",
    });
    // Empty cells become undefined (stored as NULL), not "".
    expect(valid[1]).toEqual({
      full_name: "Grace Hopper",
      email: "grace@example.com",
      city: "Arlington",
      state_region: "VA",
      postal_code: "22201",
      country: "USA",
    });
  });

  describe("header aliases", () => {
    it.each([
      ["name", "full_name", "Ada"],
      ["partner", "partner_name", "William"],
      ["spouse", "partner_name", "William"],
      ["kids", "kids_names", "Byron"],
      ["children", "kids_names", "Byron"],
      ["zip", "postal_code", "94103"],
      ["zipcode", "postal_code", "94103"],
      ["postcode", "postal_code", "94103"],
      ["state", "state_region", "CA"],
      ["province", "state_region", "ON"],
      ["region", "state_region", "Bavaria"],
      ["address", "address_line1", "1 Main St"],
      ["street", "address_line1", "1 Main St"],
      ["address1", "address_line1", "1 Main St"],
      ["street_address", "address_line1", "1 Main St"],
      ["address2", "address_line2", "Unit 4"],
      ["e-mail", "email", "a@b.com"],
      ["email_address", "email", "a@b.com"],
      ["dob", "birthday", "1990-01-31"],
      ["date_of_birth", "birthday", "1990-01-31"],
      ["note", "notes", "hi"],
    ] as const)("maps %s → %s", (alias, canonical, value) => {
      const csv = `full_name,${alias}\nAda,${value}`;
      const { valid, errors } = parseContactsCsv(csv);
      expect(errors).toEqual([]);
      expect(valid).toHaveLength(1);
      expect(valid[0]?.[canonical]).toBe(value);
    });

    it("matches headers case-insensitively and tolerates surrounding whitespace", () => {
      const csv = ' Name , SPOUSE ,Zip\nAda,William,94103';
      const { valid, errors } = parseContactsCsv(csv);
      expect(errors).toEqual([]);
      expect(valid[0]).toEqual({
        full_name: "Ada",
        partner_name: "William",
        postal_code: "94103",
      });
    });
  });

  it("matches spreadsheet headers with spaces, like a holiday card list", () => {
    const csv =
      "Name on Envelope,Address 1,Address 2,Postal Code,Email\n" +
      "Ada Byron,1 Main St,Unit 4,94103,ada@example.com";
    const { valid, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    expect(valid[0]).toEqual({
      full_name: "Ada Byron",
      address_line1: "1 Main St",
      address_line2: "Unit 4",
      postal_code: "94103",
      email: "ada@example.com",
    });
  });

  it("splits a two-person name into the contact and partner", () => {
    const csv = "name,email\nAda & Will Byron,ada@example.com";
    expect(parseContactsCsv(csv).valid[0]).toMatchObject({
      full_name: "Ada Byron",
      partner_name: "Will Byron",
    });
  });

  it("matches hyphenated headers and the envelope name alias", () => {
    const csv = "Envelope Name,Postal-Code\nAda Byron,94103";
    expect(parseContactsCsv(csv).valid[0]).toEqual({ full_name: "Ada Byron", postal_code: "94103" });
  });

  it.each(['', '"  "'])("keeps a name when a later column for the same field is %s", (blank) => {
    const csv = `Name,Name on Envelope\nAda Byron,${blank}`;
    const { valid, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    expect(valid[0]).toEqual({ full_name: "Ada Byron" });
  });

  it.each(["", "  "])("splits a two-person name when the partner cell is %j", (partner) => {
    const csv = `name,partner\nAda & Will Byron,${partner}`;
    expect(parseContactsCsv(csv).valid[0]).toMatchObject({
      full_name: "Ada Byron",
      partner_name: "Will Byron",
    });
  });

  it("keeps a two-person name whole when the partner column has a value", () => {
    const csv = "name,partner\nAda & Will Byron,Will";
    expect(parseContactsCsv(csv).valid[0]).toMatchObject({
      full_name: "Ada & Will Byron",
      partner_name: "Will",
    });
  });

  it("tolerates a UTF-8 BOM before the header row (Excel exports)", () => {
    const csv = "﻿full_name,email\nAda,ada@example.com";
    const { valid, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    expect(valid).toEqual([{ full_name: "Ada", email: "ada@example.com" }]);
  });

  it("lets the last recognized column win when headers conflict", () => {
    // Both "name" (alias) and "full_name" (canonical) map to full_name;
    // columns are applied left-to-right, so the rightmost one wins.
    const csv = "name,full_name\nFrom Alias,From Canonical";
    const { valid, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    expect(valid).toEqual([{ full_name: "From Canonical" }]);
  });

  it("ignores unknown columns", () => {
    const csv = "full_name,favorite_color,email\nAda,mauve,ada@example.com";
    const { valid, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    expect(valid).toEqual([{ full_name: "Ada", email: "ada@example.com" }]);
  });

  it("reports invalid rows with 1-based data row numbers and keeps parsing", () => {
    const csv = [
      "full_name,email,birthday",
      "Ada,ada@example.com,1815-12-10", // row 1: ok
      "Grace,not-an-email,", // row 2: bad email
      ",missing@example.com,", // row 3: missing full_name
      "Katherine,katherine@example.com,1918-08-26", // row 4: ok
      "Annie,annie@example.com,2025-02-30", // row 5: calendar-invalid date
    ].join("\n");

    const { valid, errors } = parseContactsCsv(csv);

    expect(valid.map((v) => v.full_name)).toEqual(["Ada", "Katherine"]);
    expect(errors).toHaveLength(3);
    expect(errors[0]?.row).toBe(2);
    expect(errors[0]?.message).toContain("email");
    expect(errors[1]?.row).toBe(3);
    expect(errors[1]?.message).toContain("full_name");
    expect(errors[2]?.row).toBe(5);
    expect(errors[2]?.message).toContain("birthday");
  });

  it("caps at 1000 data rows with a single error entry", () => {
    const rows = Array.from({ length: 1500 }, (_, i) => `Person ${i + 1}`);
    const csv = ["full_name", ...rows].join("\n");

    const { valid, errors } = parseContactsCsv(csv);

    expect(valid).toHaveLength(CSV_ROW_LIMIT);
    expect(valid[0]?.full_name).toBe("Person 1");
    expect(valid[CSV_ROW_LIMIT - 1]?.full_name).toBe(`Person ${CSV_ROW_LIMIT}`);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("Row limit is 1000");
  });

  it("returns a single error explaining expected headers when none are recognizable", () => {
    const csv = "foo,bar,baz\n1,2,3\n4,5,6";
    const { valid, errors } = parseContactsCsv(csv);
    expect(valid).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("full_name");
  });

  it("returns a single error for an empty file", () => {
    for (const text of ["", "   \n  \n"]) {
      const { valid, errors } = parseContactsCsv(text);
      expect(valid).toEqual([]);
      expect(errors).toHaveLength(1);
    }
  });

  it("handles quoted fields containing commas and newlines", () => {
    const csv =
      'full_name,notes\n"Lovelace, Ada","line one\nline two, with comma"';
    const { valid, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { full_name: "Lovelace, Ada", notes: "line one\nline two, with comma" },
    ]);
  });
});

describe("splitCouple", () => {
  it.each([
    ["Ada & Will Byron", "Ada Byron", "Will Byron"],
    ["Ada Byron & Will King", "Ada Byron", "Will King"],
    ["Ada and Will Byron", "Ada Byron", "Will Byron"],
    ["Ada AND Will Byron", "Ada Byron", "Will Byron"],
    ["  Ada & Will Byron ", "Ada Byron", "Will Byron"],
    ["Ada & Will", "Ada", "Will"],
    ["Ada Byron & DJ King", "Ada Byron", "DJ King"],
    ["Zoë & Seán O'Brien-Lee", "Zoë O'Brien-Lee", "Seán O'Brien-Lee"],
  ])("splits %s", (name, fullName, partnerName) => {
    expect(splitCouple(name)).toEqual({ full_name: fullName, partner_name: partnerName });
  });

  it.each([
    "Ada Byron",
    "Ada",
    "The Byron Family",
    "Satya & Family",
    "Ada & Will Byron Family",
    "Ada & Will & Ida Byron",
    "Ada, Will & Ida Byron",
    "Ada, Will, and Ida Byron",
    "Ada & Will, Ida Byron",
    "Ada Mary Byron & Will King",
    "Mr. & Mrs. John Byron",
    "Mr and Mrs Byron",
    "Ada & Will Byron Jr.",
    "Ada & Will van der Berg",
    "Ada & Will Byron + kids",
    "Ada & the kids",
    "Ada & Kids",
    "Barnes & Noble Booksellers Inc",
    "Bob & Bob Jr",
    "Ada & Will III",
    "Ada & Will II",
    "Ada & Will VI",
    "Ada & Will JD",
    "Ada & Will DNR",
    "Ada & DJS",
    "Ada & Mr Byron",
    "Ada & Will IV",
    "Ada & Will Sr",
    "Ada & Will Esq",
    "Ada & Van Gogh",
    "Ada & De Silva",
    "Rev Ada & Will Byron",
    "Aunt Ada & Uncle Will",
    "The Byrons & The Kings",
    "Ada & Guest",
    "Ada & Baby Will",
    "Ada & Children",
    "Ada & Mrs Byron",
    "Ada & Ms Byron",
    "Ada & Mx Byron",
    "Ada & Dr Byron",
    "ADA & WILL BYRON",
    "Ada & Will Byron-",
    "Ada & will",
    "Ada Byron & will King",
    "Sandy Anderson",
  ])(
    "leaves %s alone",
    (name) => {
      expect(splitCouple(name)).toBeUndefined();
    },
  );

  it.each([...NOT_NAMES])("leaves a name with %s alone in either position", (word) => {
    const cap = word[0].toUpperCase() + word.slice(1);
    expect(splitCouple(`Ada & ${cap} Byron`)).toBeUndefined();
    expect(splitCouple(`${cap} Ada & Will Byron`)).toBeUndefined();
  });
});
