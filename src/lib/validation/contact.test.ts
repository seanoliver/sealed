import { describe, it, expect } from "vitest";
import {
  checkAddress,
  contactSchema,
  readTokenDetails,
  TOKEN_UPDATE_FIELDS,
  tokenUpdateSchema,
} from "./contact";

/** Minimal valid input; spread overrides per test. */
const base = { full_name: "Ada Lovelace" };

describe("contactSchema", () => {
  it("accepts a minimal contact (full_name only)", () => {
    const result = contactSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts a fully-populated contact", () => {
    const result = contactSchema.safeParse({
      full_name: "Ada Lovelace",
      partner_name: "Charles Babbage",
      kids_names: "Byron, Anne, Ralph",
      email: "ada@example.com",
      birthday: "1815-12-10",
      address_line1: "12 St James's Square",
      address_line2: "Flat 2",
      city: "London",
      state_region: "Greater London",
      postal_code: "SW1Y 4JH",
      country_code: "GB",
      notes: "Wrote the first program.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing full_name", () => {
    expect(contactSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty/whitespace full_name", () => {
    expect(contactSchema.safeParse({ full_name: "" }).success).toBe(false);
    expect(contactSchema.safeParse({ full_name: "   " }).success).toBe(false);
  });

  it("trims strings", () => {
    const result = contactSchema.parse({
      full_name: "  Ada  ",
      city: "  London ",
    });
    expect(result.full_name).toBe("Ada");
    expect(result.city).toBe("London");
  });

  it("converts empty optional strings to undefined", () => {
    const result = contactSchema.parse({
      ...base,
      partner_name: "",
      email: "",
      birthday: "",
      notes: "   ",
    });
    expect(result.partner_name).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.birthday).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });

  // Max lengths mirror the SQL CHECK constraints in the core schema migration.
  it.each([
    ["full_name", 200],
    ["partner_name", 200],
    ["kids_names", 2000],
    ["address_line1", 200],
    ["address_line2", 200],
    ["city", 120],
    ["state_region", 120],
    ["postal_code", 20],
    ["district", 120],
    ["notes", 2000],
  ] as const)("enforces max length of %s = %i", (field, max) => {
    expect(
      contactSchema.safeParse({ ...base, [field]: "a".repeat(max) }).success,
    ).toBe(true);
    expect(
      contactSchema.safeParse({ ...base, [field]: "a".repeat(max + 1) }).success,
    ).toBe(false);
  });

  it("accepts a valid email and rejects an invalid one", () => {
    expect(
      contactSchema.safeParse({ ...base, email: "ada@example.com" }).success,
    ).toBe(true);
    expect(
      contactSchema.safeParse({ ...base, email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("rejects an email over 320 chars even if shaped like an email", () => {
    const email = `${"a".repeat(310)}@example.com`; // 322 chars
    expect(contactSchema.safeParse({ ...base, email }).success).toBe(false);
  });

  it("accepts YYYY-MM-DD birthday and rejects other formats", () => {
    expect(
      contactSchema.safeParse({ ...base, birthday: "1990-05-04" }).success,
    ).toBe(true);
    expect(
      contactSchema.safeParse({ ...base, birthday: "05/04/1990" }).success,
    ).toBe(false);
    expect(
      contactSchema.safeParse({ ...base, birthday: "1990-5-4" }).success,
    ).toBe(false);
  });

  it("rejects calendar-invalid birthdays that match the shape", () => {
    // Shape-valid but not real dates: these must never reach the Postgres
    // date cast (class-22 errors embed the input value in log messages).
    for (const birthday of ["2025-99-99", "2025-13-01", "2025-02-30", "0000-00-00"]) {
      expect(contactSchema.safeParse({ ...base, birthday }).success).toBe(false);
    }
  });
});

describe("tokenUpdateSchema", () => {
  it("accepts the same core fields as contactSchema", () => {
    const result = tokenUpdateSchema.safeParse({
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      birthday: "1815-12-10",
      city: "London",
    });
    expect(result.success).toBe(true);
  });

  it("strips a smuggled notes key (recipients can never write notes)", () => {
    const result = tokenUpdateSchema.parse({
      ...base,
      notes: "recipient-injected",
    });
    expect(result).not.toHaveProperty("notes");
  });

  it("still enforces field validation (bad email rejected)", () => {
    expect(
      tokenUpdateSchema.safeParse({ ...base, email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("requires full_name like the parent schema", () => {
    expect(tokenUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("TOKEN_UPDATE_FIELDS", () => {
  it("is CONTACT_FIELDS minus notes, in display order", () => {
    expect(TOKEN_UPDATE_FIELDS).toEqual([
      "full_name",
      "partner_name",
      "kids_names",
      "email",
      "birthday",
      "address_line1",
      "address_line2",
      "district",
      "city",
      "state_region",
      "postal_code",
      "country_code",
    ]);
    expect(TOKEN_UPDATE_FIELDS).not.toContain("notes");
  });
});

describe("readTokenDetails", () => {
  it("reads detail fields and leaves the name fields blank", () => {
    const form = new FormData();
    form.set("full_name", "Smuggled");
    form.set("partner_name", "Smuggled");
    form.set("city", "Lisbon");
    const values = readTokenDetails(form);
    expect(values.city).toBe("Lisbon");
    expect(values.email).toBe("");
    expect([values.full_name, values.partner_name, values.kids_names]).toEqual(["", "", ""]);
  });
});

describe("checkAddress", () => {
  it("normalizes and checks the postcode against the country", () => {
    expect(checkAddress({ postal_code: "bs6 5qt", country_code: "GB" })).toEqual({
      ok: true,
      data: { postal_code: "BS6 5QT", country_code: "GB" },
    });
    expect(checkAddress({ postal_code: "1016", country_code: "NL" })).toEqual({
      ok: false,
      field: "postal_code",
      error: "A Dutch postcode is four digits and two letters, like 1234 AB.",
    });
  });

  it("lets a postcode saved before the check through while it and the country are unchanged", () => {
    const stored = { postal_code: "1016", country_code: "NL" };
    expect(checkAddress({ postal_code: "1016", country_code: "NL" }, { stored }).ok).toBe(true);
    expect(checkAddress({ postal_code: "1017", country_code: "NL" }, { stored }).ok).toBe(false);
    expect(checkAddress({ postal_code: "1016", country_code: "BE" }, { stored }).ok).toBe(true);
    expect(checkAddress({ postal_code: "1016", country_code: "DE" }, { stored }).ok).toBe(false);
    expect(
      checkAddress({ postal_code: "NOPE", country_code: "GB" }, { stored: { postal_code: "nope", country_code: "GB" } }).ok,
    ).toBe(true);
  });

  it("only takes country codes on the list", () => {
    expect(contactSchema.safeParse({ full_name: "Ada", country_code: "gb" }).data?.country_code).toBe("GB");
    expect(contactSchema.safeParse({ full_name: "Ada", country_code: "XX" }).success).toBe(false);
    expect(contactSchema.safeParse({ full_name: "Ada", country_code: "United Kingdom" }).success).toBe(false);
  });
});
