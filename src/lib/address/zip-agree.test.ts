import { describe, expect, it } from "vitest";
import { zipDisagrees } from "./zip-agree";

const sf = { city: "San Francisco", state: "CA" };

describe("zipDisagrees", () => {
  it("agrees when city and state match", () => {
    expect(zipDisagrees(sf, { city: "San Francisco", state: "CA" })).toBe(false);
  });
  it("flags a state-only mismatch", () => {
    expect(zipDisagrees(sf, { city: "San Francisco", state: "OR" })).toBe(true);
  });
  it("flags a city-only mismatch", () => {
    expect(zipDisagrees(sf, { city: "Portland", state: "CA" })).toBe(true);
  });
  it("treats a blank city and state as agreeing", () => {
    expect(zipDisagrees(sf, { city: "", state: "" })).toBe(false);
    expect(zipDisagrees(sf, { city: "  ", state: "CA" })).toBe(false);
    expect(zipDisagrees(sf, { city: "San Francisco", state: " " })).toBe(false);
  });
  it("ignores case and punctuation", () => {
    const stl = { city: "St. Louis", state: "MO" };
    expect(zipDisagrees(stl, { city: "st louis", state: "mo" })).toBe(false);
    expect(zipDisagrees(stl, { city: "ST.LOUIS", state: " MO " })).toBe(false);
  });
});
