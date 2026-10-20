import { describe, it, expect } from "vitest";
import { bookSchema, senderCountrySchema } from "./book";

describe("bookSchema", () => {
  const valid = {
    display_name: "Sean",
    slug: "sean-oliver",
    partner_name: true,
    kids_names: false,
    birthday: true,
  };

  it("accepts a first name and trims it", () => {
    expect(bookSchema.parse({ ...valid, display_name: "  Sean  " })).toEqual(valid);
  });

  it.each(["ab", "-bad", "Bad Slug", "a".repeat(64), "sean_oliver"])(
    "rejects slug %s",
    (slug) => {
      expect(bookSchema.safeParse({ ...valid, slug }).success).toBe(false);
    },
  );

  it.each(["", "   "])("rejects empty owner name %j", (display_name) => {
    expect(bookSchema.safeParse({ ...valid, display_name }).success).toBe(false);
  });

  it("rejects an owner name over 200 characters", () => {
    expect(
      bookSchema.safeParse({ ...valid, display_name: "a".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("senderCountrySchema", () => {
  it("takes a country code on the list", () => {
    expect(senderCountrySchema.parse("GB")).toBe("GB");
    expect(senderCountrySchema.safeParse("XX").success).toBe(false);
    expect(senderCountrySchema.safeParse("United Kingdom").success).toBe(false);
  });
});
