import { describe, expect, it } from "vitest";
import { householdToRow } from "./contact-row";

describe("householdToRow", () => {
  it("writes null display strings when the partner and kids are removed", () => {
    expect(householdToRow({ first_name: "Jen", last_name: "Holloway" })).toMatchObject({
      fullName: "Jen Holloway",
      partnerFirstName: null,
      partnerLastName: null,
      partnerName: null,
      kids: null,
      kidsNames: null,
    });
  });

  it("formats the partner and kids against the family last name", () => {
    expect(
      householdToRow({
        first_name: "Jen",
        last_name: "Holloway",
        partner_first_name: "Mark",
        partner_last_name: "Holloway",
        kids: [{ first: "Zoe", last: "Holloway" }, { first: "Max", last: "Lee" }],
      }),
    ).toMatchObject({ partnerName: "Mark Holloway", kidsNames: "Zoe, Max Lee" });
  });
});
