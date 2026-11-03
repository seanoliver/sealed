import { describe, expect, it } from "vitest";
import { isPluralOwnerName, ownerVerb } from "./owner-name";

describe("isPluralOwnerName", () => {
  it.each([
    ["Sean", false],
    ["Sean Oliver", false],
    ["Andrea", false],
    ["Thomas", false],
    ["Sean & Tina", true],
    ["Sean and Tina", true],
    ["sean AND tina", true],
    ["Sean + Tina", true],
    ["Sean, Tina, and the kids", true],
    ["The Olivers", true],
    ["  Sean & Tina  ", true],
    ["Brandon", false],
  ])("%s → %s", (name, plural) => {
    expect(isPluralOwnerName(name)).toBe(plural);
  });
});

describe("ownerVerb", () => {
  it("agrees with a single name", () => {
    expect(ownerVerb("Sean", "is", "are")).toBe("is");
  });
  it("agrees with a couple", () => {
    expect(ownerVerb("Sean & Tina", "is", "are")).toBe("are");
  });
});
