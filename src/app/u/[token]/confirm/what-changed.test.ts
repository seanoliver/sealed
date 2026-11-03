import { describe, expect, it } from "vitest";
import { whatChanged, type ReplySnapshot } from "./what-changed";

const before: ReplySnapshot = {
  household: {
    first_name: "Maya",
    last_name: "Chen",
    partner: { first: "Jordan", last: "Lee" },
    kids: [{ first: "Ivy", last: "Chen" }],
  },
  address: ["2217 Alder Street", "Portland, OR 97214"],
  email: "maya@example.test",
  birthday: "",
};

describe("whatChanged", () => {
  it("is empty for a plain confirm", () => {
    expect(whatChanged(before, structuredClone(before))).toEqual([]);
  });

  it("lists added, removed and renamed people", () => {
    const after = structuredClone(before);
    after.household.last_name = "Lee";
    after.household.partner = null;
    after.household.kids.push({ first: "Theo", last: "Lee" });
    expect(whatChanged(before, after)).toEqual([
      { kind: "renamed", from: "Maya Chen", to: "Maya Lee" },
      { kind: "removed", name: "Jordan Lee" },
      { kind: "added", name: "Theo Lee" },
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

  it("ignores whitespace-only name edits and reordered kids", () => {
    const start = { ...before, household: { ...before.household, kids: [{ first: "A", last: "" }, { first: "B", last: "" }] } };
    const after = structuredClone(start);
    after.household.first_name = " Maya ";
    after.household.kids.reverse();
    expect(whatChanged(start, after)).toEqual([]);
  });
});
