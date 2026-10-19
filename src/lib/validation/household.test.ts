import { describe, expect, it } from "vitest";
import {
  exceedsCaps,
  FIRST_NAME_REQUIRED,
  KIDS_MAX,
  NAME_MAX,
  ROW_FIRST_NAME_REQUIRED,
  householdSchema,
  lastNameRequired,
  parseHouseholdForm,
} from "./household";

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

const owner = { ownerName: "Sean" };

describe("parseHouseholdForm", () => {
  it("parses the recipient, a partner, and kids", () => {
    const result = parseHouseholdForm(
      form([
        ["first_name", " Jane "],
        ["last_name", "Smith"],
        ["partner_section", "1"],
        ["partner_first_name", "Sam"],
        ["partner_last_name", ""],
        ["kids_section", "1"],
        ["kid_first", "Zoe"],
        ["kid_last", "Smith"],
        ["kid_first", "Max"],
        ["kid_last", "Jones"],
      ]),
      owner,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      first_name: "Jane",
      last_name: "Smith",
      partner_first_name: "Sam",
      kids: [
        { first: "Zoe", last: "Smith" },
        { first: "Max", last: "Jones" },
      ],
    });
  });

  it("ignores partner and kid rows when their section marker is absent", () => {
    const result = parseHouseholdForm(
      form([
        ["first_name", "Jane"],
        ["last_name", "Smith"],
        ["partner_first_name", "Sam"],
        ["kid_first", "Zoe"],
        ["kid_last", "Smith"],
      ]),
      owner,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { first_name: "Jane", last_name: "Smith" },
    });
    if (result.ok) {
      expect(result.data.partner_first_name).toBeUndefined();
      expect(result.data.kids).toBeUndefined();
    }
  });

  it("treats an enabled section with no rows as no partner and no kids", () => {
    const result = parseHouseholdForm(
      form([
        ["first_name", "Jane"],
        ["last_name", "Smith"],
        ["partner_section", "1"],
        ["kids_section", "1"],
      ]),
      owner,
    );
    expect(result).toEqual({
      ok: true,
      values: { first_name: "Jane", last_name: "Smith", partner: null, kids: [] },
      data: { first_name: "Jane", last_name: "Smith" },
    });
  });

  it("rejects mismatched kid first/last counts", () => {
    const result = parseHouseholdForm(
      form([
        ["first_name", "Jane"],
        ["last_name", "Smith"],
        ["kids_section", "1"],
        ["kid_first", "Zoe"],
        ["kid_first", "Max"],
        ["kid_last", "Smith"],
      ]),
      owner,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it("reports required names at their field paths and echoes the rows", () => {
    const result = parseHouseholdForm(
      form([
        ["first_name", ""],
        ["last_name", " "],
        ["partner_section", "1"],
        ["partner_first_name", ""],
        ["partner_last_name", "Smith"],
        ["kids_section", "1"],
        ["kid_first", "Zoe"],
        ["kid_last", "Smith"],
        ["kid_first", ""],
        ["kid_last", "Smith"],
      ]),
      owner,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Check the names below.");
    expect(result.fieldErrors).toEqual({
      first_name: FIRST_NAME_REQUIRED,
      last_name: lastNameRequired("Sean"),
      partner_first_name: ROW_FIRST_NAME_REQUIRED,
      "kids.1.first": ROW_FIRST_NAME_REQUIRED,
    });
    expect(lastNameRequired("Sean")).toBe(
      "Add your last name so Sean can address your mail.",
    );
    expect(result.values).toEqual({
      first_name: "",
      last_name: " ",
      partner: { first: "", last: "Smith" },
      kids: [
        { first: "Zoe", last: "Smith" },
        { first: "", last: "Smith" },
      ],
    });
  });

  it("rejects more than 10 kids", () => {
    const kids: [string, string][] = [];
    for (let i = 0; i < 11; i++) kids.push(["kid_first", `K${i}`], ["kid_last", ""]);
    const result = parseHouseholdForm(
      form([["first_name", "Jane"], ["last_name", "Smith"], ["kids_section", "1"], ...kids]),
      owner,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors ?? {})).toEqual(["kids"]);
  });

  it("caps each name part at 80 characters", () => {
    const long = "x".repeat(81);
    const result = parseHouseholdForm(
      form([
        ["first_name", long],
        ["last_name", "x".repeat(80)],
        ["partner_section", "1"],
        ["partner_first_name", "Sam"],
        ["partner_last_name", long],
        ["kids_section", "1"],
        ["kid_first", "Zoe"],
        ["kid_last", long],
      ]),
      owner,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual([
        "first_name",
        "kids.0.last",
        "partner_last_name",
      ]);
    }
  });
});

describe("householdSchema", () => {
  it("lets the owner save a contact without a last name, but not a recipient", () => {
    expect(householdSchema().safeParse({ first_name: "Cher", last_name: "" })).toMatchObject({
      success: true,
      data: { first_name: "Cher", last_name: undefined },
    });
    expect(householdSchema(owner).safeParse({ first_name: "Cher", last_name: "" }).success).toBe(
      false,
    );
  });

  const schema = householdSchema(owner);

  it("rejects unknown keys and extra kid keys", () => {
    expect(
      schema.safeParse({ first_name: "A", last_name: "B", notes: "x" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        first_name: "A",
        last_name: "B",
        kids: [{ first: "Zoe", middle: "Q" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a partner last name without a partner first name", () => {
    const result = schema.safeParse({
      first_name: "A",
      last_name: "B",
      partner_last_name: "C",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["partner_first_name"]);
  });
});

describe("exceedsCaps", () => {
  const base = { first_name: "Jen", last_name: "Holloway", partner: null, kids: [] };
  const kid = { first: "Ada", last: "Holloway" };

  it("passes values inside the caps", () => {
    expect(exceedsCaps({ ...base, kids: Array(KIDS_MAX).fill(kid) })).toBe(false);
  });

  it.each([
    ["too many kids", { ...base, kids: Array(KIDS_MAX + 1).fill(kid) }],
    ["a long first name", { ...base, first_name: "x".repeat(NAME_MAX + 1) }],
    ["a long partner name", { ...base, partner: { first: "Pat", last: "y".repeat(NAME_MAX + 1) } }],
    ["a long kid name", { ...base, kids: [{ first: "z".repeat(NAME_MAX + 1), last: "" }] }],
  ])("flags %s", (_, values) => {
    expect(exceedsCaps(values)).toBe(true);
  });
});
