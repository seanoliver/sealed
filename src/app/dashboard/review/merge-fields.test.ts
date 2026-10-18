import { describe, expect, it } from "vitest";
import { definedFields, toInsertRow, type Snapshot } from "./merge";

describe("definedFields", () => {
  it("keeps only non-null fields", () => {
    const snap = { full_name: "Jen", city: null, kids: null, first_name: "Jen" } as unknown as Snapshot;
    expect(definedFields(snap)).toEqual({ full_name: "Jen", first_name: "Jen" });
  });
});

describe("toInsertRow", () => {
  it("writes a legacy payload's display names without structured names", () => {
    const row = toInsertRow({ full_name: "Old Style", partner_name: "Pat", city: "Lisbon" });
    expect(row).toMatchObject({ fullName: "Old Style", partnerName: "Pat", city: "Lisbon" });
    expect(row).not.toHaveProperty("firstName");
  });
});
