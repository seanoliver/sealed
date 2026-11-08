import { describe, expect, it } from "vitest";
import { draftFromValues, type HouseholdDraft } from "@/components/envelope-names";
import { whatChanged, type ReplySnapshot } from "./what-changed";

const before: ReplySnapshot = {
  household: draftFromValues({
    first_name: "Maya",
    last_name: "Chen",
    partner: { first: "Jordan", last: "Lee" },
    kids: [{ first: "Ivy", last: "Chen" }],
  }),
  address: ["2217 Alder Street", "Portland, OR 97214"],
  email: "maya@example.test",
  personalEmail: "",
  birthday: "",
};

const withHousehold = (snap: ReplySnapshot, household: HouseholdDraft): ReplySnapshot => ({ ...snap, household });

describe("whatChanged", () => {
  it("is empty for a plain confirm", () => {
    expect(whatChanged(before, structuredClone(before))).toEqual([]);
  });

  it("lists a new personal email", () => {
    const after = { ...structuredClone(before), personalEmail: " maya.chen@gmail.com " };
    expect(whatChanged(before, after)).toEqual([
      { kind: "personal_email", from: "", to: "maya.chen@gmail.com" },
    ]);
  });

  it("lists added, removed and renamed people", () => {
    const after = structuredClone(before);
    after.household.primary.last = "Lee";
    after.household.partner = null;
    after.household.kids.push({ key: 9, first: "Theo", last: "Lee" });
    expect(whatChanged(before, after)).toEqual([
      { kind: "renamed", from: "Maya Chen", to: "Maya Lee" },
      { kind: "removed", name: "Jordan Lee" },
      { kind: "added", name: "Theo Lee" },
    ]);
  });

  it("reports a last name that followed the household as renames, not remove and add", () => {
    const start = withHousehold(
      before,
      draftFromValues({
        first_name: "Ana",
        last_name: "Olivr",
        partner: { first: "Ben", last: "Olivr" },
        kids: [{ first: "Kit", last: "Olivr" }],
      }),
    );
    const after = structuredClone(start);
    for (const person of [after.household.primary, after.household.partner!, ...after.household.kids]) {
      person.last = "Oliver";
    }
    expect(whatChanged(start, after)).toEqual([
      { kind: "renamed", from: "Ana Olivr", to: "Ana Oliver" },
      { kind: "renamed", from: "Ben Olivr", to: "Ben Oliver" },
      { kind: "renamed", from: "Kit Olivr", to: "Kit Oliver" },
    ]);
  });

  it("reports a removed kid and a new kid with the same name as remove and add", () => {
    const after = structuredClone(before);
    after.household.kids = [{ key: 9, first: "Ivy", last: "Chen" }];
    expect(whatChanged(before, after)).toEqual([
      { kind: "removed", name: "Ivy Chen" },
      { kind: "added", name: "Ivy Chen" },
    ]);
  });

  it("shows the whole address before and after, and email changes", () => {
    const after = {
      ...before,
      address: ["41 Westwood Drive", "San Francisco, CA 94112"],
      email: " maya.new@example.test ",
    };
    expect(whatChanged(before, after)).toEqual([
      {
        kind: "address",
        from: "2217 Alder Street, Portland, OR 97214",
        to: "41 Westwood Drive, San Francisco, CA 94112",
      },
      { kind: "email", from: "maya@example.test", to: "maya.new@example.test" },
    ]);
  });

  it("ignores whitespace-only name edits", () => {
    const after = structuredClone(before);
    after.household.primary.first = " Maya ";
    after.household.kids[0].last = "Chen ";
    expect(whatChanged(before, after)).toEqual([]);
  });
});
