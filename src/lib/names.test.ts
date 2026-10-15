import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatKids,
  formatPerson,
  naiveSplit,
  splitKids,
  type Kid,
} from "./names";

type Fixture = {
  person: { first: string | null; last: string | null; expected: string | null }[];
  kids: { kids: Kid[] | null; family_last: string | null; expected: string | null }[];
};

// The same JSON drives the pgTAP parity test, so both derivations are
// checked against one set of expectations.
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
