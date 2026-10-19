import { describe, expect, it } from "vitest";
import { addressLines } from "./address";

const blank = {
  addressLine1: null,
  addressLine2: null,
  city: null,
  stateRegion: null,
  postalCode: null,
  country: null,
};

describe("addressLines", () => {
  it("formats a full address as envelope lines", () => {
    expect(
      addressLines({
        addressLine1: "1428 Alder St",
        addressLine2: "Apt 3",
        city: "Portland",
        stateRegion: "OR",
        postalCode: "97214",
        country: "United States",
      }),
    ).toEqual(["1428 Alder St, Apt 3", "Portland, OR 97214", "United States"]);
  });

  it("drops blank parts", () => {
    expect(
      addressLines({
        ...blank,
        addressLine1: " 9 Rue Cler ",
        city: "Paris",
        postalCode: "75007",
      }),
    ).toEqual(["9 Rue Cler", "Paris, 75007"]);
  });

  it("is null without a street line", () => {
    expect(addressLines(blank)).toBeNull();
    expect(
      addressLines({ ...blank, city: "Oslo", addressLine2: "Apt 3" }),
    ).toBeNull();
  });
});
