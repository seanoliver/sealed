import { describe, expect, it } from "vitest";
import { countryCodeFor, countryName, getCountry } from "./countries";
import { addressLayout } from "./fields";
import { normalizeAddress, normalizePostcode, postcodeProblem } from "./rules";

describe("countryCodeFor", () => {
  it.each([
    ["United States", "US"],
    ["USA", "US"],
    ["usa", "US"],
    ["U.S.", "US"],
    ["US", "US"],
    ["CHINA", "CN"],
    ["PRC", "CN"],
    ["中国", "CN"],
    ["Netherlands", "NL"],
    ["The Netherlands", "NL"],
    ["holland", "NL"],
    ["United Kingdom", "GB"],
    ["UK", "GB"],
    ["Great Britain", "GB"],
    ["england", "GB"],
    ["gb", "GB"],
    ["Singapore", "SG"],
    ["Greece", "GR"],
    ["Spain", "ES"],
    ["España", "ES"],
    ["South Africa", "ZA"],
    ["Germany", "DE"],
    ["  germany  ", "DE"],
    ["Côte d’Ivoire", "CI"],
    ["Saint Kitts & Nevis", "KN"],
  ])("maps %s to %s", (text, code) => {
    expect(countryCodeFor(text)).toBe(code);
  });

  it("returns null for text it doesn't know", () => {
    expect(countryCodeFor("Atlantis")).toBeNull();
    expect(countryCodeFor("")).toBeNull();
    expect(countryCodeFor(null)).toBeNull();
  });

  it("names codes in English", () => {
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("HK")).toBe("Hong Kong");
    expect(getCountry("XX")).toBeNull();
  });
});

describe("postcodeProblem", () => {
  it("accepts postcodes that fit the country's pattern", () => {
    expect(postcodeProblem("NL", "1016 DZ")).toBeNull();
    expect(postcodeProblem("GB", "BS6 5QT")).toBeNull();
    expect(postcodeProblem("US", "97214-1234")).toBeNull();
    expect(postcodeProblem("CN", "201203")).toBeNull();
    expect(postcodeProblem("HK", "anything")).toBeNull();
    expect(postcodeProblem(null, "anything")).toBeNull();
    expect(postcodeProblem("NL", "")).toBeNull();
  });

  it("explains the pattern with an example", () => {
    expect(postcodeProblem("NL", "1016")).toBe(
      "A Dutch postcode is four digits and two letters, like 1234 AB.",
    );
    expect(postcodeProblem("US", "9721")).toBe("A US ZIP code is five digits, like 95014.");
    expect(postcodeProblem("GB", "BS6")).toBe("A UK postcode looks like EC1Y 8SY.");
    expect(postcodeProblem("BR", "1")).toBe(
      "A Brazilian postal code is five digits, a hyphen and three digits, like 40301-110.",
    );
    expect(postcodeProblem("PH", "1")).toBe("A postal code in the Philippines is four digits, like 1008.");
  });
});

describe("normalizePostcode", () => {
  it("formats UK, Canadian and Dutch postcodes", () => {
    expect(normalizePostcode("GB", "bs65qt")).toBe("BS6 5QT");
    expect(normalizePostcode("GB", " bs6   5qt ")).toBe("BS6 5QT");
    expect(normalizePostcode("CA", "k1a0b1")).toBe("K1A 0B1");
    expect(normalizePostcode("NL", "1016dz")).toBe("1016 DZ");
  });

  it("leaves a postcode that doesn't fit as typed, upper-cased", () => {
    expect(normalizePostcode("GB", "nope")).toBe("NOPE");
    expect(normalizePostcode("NL", "1016")).toBe("1016");
  });
});

describe("normalizeAddress", () => {
  it("trims, collapses spaces and codes US states", () => {
    expect(
      normalizeAddress({
        address_line1: "  1427   Linden Avenue ",
        city: "Portland",
        state_region: "oregon",
        postal_code: "97214",
        country_code: "US",
      }),
    ).toEqual({
      address_line1: "1427 Linden Avenue",
      city: "Portland",
      state_region: "OR",
      postal_code: "97214",
      country_code: "US",
    });
    expect(normalizeAddress({ state_region: "District of Columbia", country_code: "US" }).state_region).toBe("DC");
    expect(normalizeAddress({ state_region: "Oregon", country_code: "CA" }).state_region).toBe("Oregon");
  });
});

describe("addressLayout", () => {
  const rows = (code: string | null) =>
    addressLayout(code).rows.map((row) => row.fields.map((field) => field.label));

  it("orders and labels the US form", () => {
    expect(rows("US")).toEqual([
      ["Street address"],
      ["Apartment, suite"],
      ["City"],
      ["State", "ZIP code"],
    ]);
    const state = addressLayout("US").rows[3].fields[0];
    expect(state.options?.find(([code]) => code === "OR")).toEqual(["OR", "Oregon"]);
    expect(state.required).toBe(true);
  });

  it("asks the UK for a post town and postcode", () => {
    expect(rows("GB")).toEqual([
      ["Street address"],
      ["Flat, building"],
      ["Post town", "Postcode"],
    ]);
    expect(addressLayout("GB").rows[2].wideOnly).toBe(true);
  });

  it("puts the Dutch postcode and city on one row", () => {
    expect(rows("NL")).toEqual([["Street and house number"], ["Apartment, suite"], ["Postcode", "City"]]);
    expect(addressLayout("NL").line2OnlyWhenFilled).toBe(true);
  });

  it("asks China for province, city and district, then street, then postcode", () => {
    expect(rows("CN")).toEqual([
      ["Province", "City"],
      ["District"],
      ["Street address"],
      ["Apartment, suite"],
      ["Postal code"],
    ]);
  });

  it("has no city field for Singapore", () => {
    expect(addressLayout("SG").fields.has("city")).toBe(false);
  });

  it("shows every field for unrecognized countries", () => {
    expect([...addressLayout(null).fields].sort()).toEqual(
      ["address_line1", "address_line2", "city", "postal_code", "state_region"].sort(),
    );
  });
});
