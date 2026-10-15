import { describe, expect, it } from "vitest";
import { sameJsonb } from "./jsonb";

describe("sameJsonb", () => {
  it("ignores object key order, as jsonb does", () => {
    expect(
      sameJsonb([{ first: "Zoe", last: "Smith" }], [{ last: "Smith", first: "Zoe" }]),
    ).toBe(true);
  });

  it("keeps array order and values significant", () => {
    expect(sameJsonb([{ first: "Zoe" }, { first: "Max" }], [{ first: "Max" }, { first: "Zoe" }])).toBe(false);
    expect(sameJsonb({ first: "Zoe" }, { first: "Zoey" })).toBe(false);
    expect(sameJsonb(null, undefined)).toBe(false);
  });
});
