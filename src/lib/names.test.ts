import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareLastName,
  formatKids,
  formatPerson,
  householdLine,
  householdPrefill,
  kidsCount,
  kidsSummary,
  lastNameKey,
  naiveSplit,
  splitKids,
  type Kid,
  type StoredNames,
} from "./names";

type Fixture = {
  person: { first: string | null; last: string | null; expected: string | null }[];
  kids: { kids: Kid[] | null; family_last: string | null; expected: string | null }[];
};

function loadFixture(): Fixture {
  const sql = readFileSync(
    path.resolve(__dirname, "../../supabase/tests/database/03_household_names.sql"),
    "utf8",
  );
  const match = /\$fixture\$([\s\S]*?)\$fixture\$/.exec(sql);
  if (!match) throw new Error("parity fixture not found");
  return JSON.parse(match[1]) as Fixture;
}

const fixture = loadFixture();

describe("formatPerson (SQL parity)", () => {
  it.each(fixture.person)("$first + $last → $expected", ({ first, last, expected }) => {
    expect(formatPerson({ first, last })).toBe(expected);
  });
});

describe("formatKids (SQL parity)", () => {
  it.each(fixture.kids)(
    "%# family $family_last → $expected",
    ({ kids, family_last, expected }) => {
      expect(formatKids({ kids, familyLast: family_last })).toBe(expected);
    },
  );
});

describe("naiveSplit", () => {
  it.each([
    ["Jane Smith", { first: "Jane", last: "Smith" }],
    ["Mary Ann Smith", { first: "Mary Ann", last: "Smith" }],
    ["  Mary   Ann  Smith ", { first: "Mary Ann", last: "Smith" }],
    ["Cher", { first: "Cher", last: "" }],
    ["", { first: "", last: "" }],
  ])("%j", (input, expected) => {
    expect(naiveSplit(input)).toEqual(expected);
  });
});

describe("splitKids", () => {
  it.each([
    ["Zoe, Max", ["Zoe", "Max"]],
    ["Zoe and Max", ["Zoe", "Max"]],
    ["Zoe, Max, and Ivy", ["Zoe", "Max", "Ivy"]],
    ["Zoe And Max Smith", ["Zoe", "Max Smith"]],
    ["Alexandra", ["Alexandra"]],
    [" , ", []],
  ])("%j", (input, expected) => {
    expect(splitKids(input)).toEqual(expected);
  });
});

const legacy: StoredNames = {
  fullName: "Jen Holloway",
  partnerName: null,
  kidsNames: null,
  firstName: null,
  lastName: null,
  partnerFirstName: null,
  partnerLastName: null,
  kids: null,
};

const split: StoredNames = {
  ...legacy,
  firstName: "Jen",
  lastName: "Holloway",
};

describe("householdLine", () => {
  it.each<[string, StoredNames, string]>([
    ["contact alone", split, "Jen Holloway"],
    [
      "partner sharing the last name",
      { ...split, partnerFirstName: "Mark", partnerLastName: "Holloway" },
      "Jen & Mark Holloway",
    ],
    [
      "partner with no last name",
      { ...split, partnerFirstName: "Mark" },
      "Jen & Mark Holloway",
    ],
    [
      "partner with a different last name",
      {
        ...split,
        firstName: "Priya",
        lastName: "Raman",
        partnerFirstName: "Daniel",
        partnerLastName: "Okafor",
      },
      "Priya Raman & Daniel Okafor",
    ],
    ["legacy contact alone", { ...legacy, fullName: "Dr. J. Holloway" }, "Dr. J. Holloway"],
    [
      "legacy partner sharing the last word",
      { ...legacy, partnerName: "Mark Holloway" },
      "Jen & Mark Holloway",
    ],
    ["legacy partner by first name", { ...legacy, partnerName: "Mark" }, "Jen & Mark Holloway"],
    [
      "legacy partner with another last name",
      { ...legacy, partnerName: "Sam Lee" },
      "Jen Holloway & Sam Lee",
    ],
    [
      "single names",
      { ...legacy, fullName: "Cher", partnerName: "Sonny" },
      "Cher & Sonny",
    ],
  ])("%s", (_label, names, expected) => {
    expect(householdLine(names)).toBe(expected);
  });
});

describe("kidsCount and kidsSummary", () => {
  it("counts structured kids, else the legacy string", () => {
    expect(kidsCount({ ...split, kids: [{ first: "Zoe" }, { first: "Max" }] })).toBe(2);
    expect(kidsCount({ ...legacy, kidsNames: "Zoe, Max and Ivy" })).toBe(3);
    expect(kidsCount(legacy)).toBe(0);
  });

  it("labels the count", () => {
    expect(kidsSummary(0)).toBeNull();
    expect(kidsSummary(1)).toBe("1 kid");
    expect(kidsSummary(2)).toBe("2 kids");
  });
});

describe("householdPrefill", () => {
  it("uses the stored structure when present", () => {
    expect(
      householdPrefill({
        ...split,
        partnerFirstName: "Mark",
        kids: [{ first: "Zoe" }, { first: "Max", last: "Jones" }],
      }),
    ).toEqual({
      first_name: "Jen",
      last_name: "Holloway",
      partner: { first: "Mark", last: "" },
      kids: [
        { first: "Zoe", last: "Holloway" },
        { first: "Max", last: "Jones" },
      ],
    });
  });

  it("guesses from the display strings for a legacy contact", () => {
    expect(
      householdPrefill({
        ...legacy,
        fullName: "Mary Ann Smith",
        partnerName: "Pat",
        kidsNames: "Zoe and Max",
      }),
    ).toEqual({
      first_name: "Mary Ann",
      last_name: "Smith",
      partner: { first: "Pat", last: "Smith" },
      kids: [
        { first: "Zoe", last: "Smith" },
        { first: "Max", last: "Smith" },
      ],
    });
  });

  it("leaves out sections that are switched off", () => {
    expect(
      householdPrefill(
        { ...legacy, partnerName: "Pat", kidsNames: "Zoe" },
        { partner: false, kids: false },
      ),
    ).toEqual({ first_name: "Jen", last_name: "Holloway", partner: null, kids: [] });
  });

  it("caps legacy kids at ten", () => {
    const kidsNames = Array.from({ length: 12 }, (_, i) => `K${i}`).join(", ");
    expect(householdPrefill({ ...legacy, kidsNames }).kids).toHaveLength(10);
  });
});

describe("lastNameKey and compareLastName", () => {
  it("has no key for an unsplit contact", () => {
    expect(lastNameKey(legacy)).toBeUndefined();
    expect(lastNameKey(split)).toEqual({ last: "Holloway", first: "Jen" });
  });

  it("sorts by last name, then first name, ignoring case", () => {
    const keys = [
      { last: "okafor", first: "Daniel" },
      { last: "Holloway", first: "Mark" },
      { last: "Holloway", first: "Jen" },
      { last: "Abbott", first: "Zed" },
    ];
    expect([...keys].sort(compareLastName)).toEqual([
      { last: "Abbott", first: "Zed" },
      { last: "Holloway", first: "Jen" },
      { last: "Holloway", first: "Mark" },
      { last: "okafor", first: "Daniel" },
    ]);
  });
});
