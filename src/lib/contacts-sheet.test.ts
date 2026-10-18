import { describe, expect, it } from "vitest";
import type { ContactListRow } from "@/lib/queries/contacts";
import {
  changedValues,
  draftFromNames,
  draftToValues,
  householdEdited,
  householdPatchInput,
  moveCursor,
  namesFromValues,
  parseStoredLayout,
  sheetName,
  STATUS_RANK,
  toSheetRow,
  validateHousehold,
  type HouseholdDraft,
  type StatusKey,
} from "./contacts-sheet";

const listRow: ContactListRow = {
  id: "00000000-0000-0000-0000-000000000001",
  fullName: "Ada Lovelace",
  partnerName: null,
  kidsNames: null,
  firstName: null,
  lastName: null,
  partnerFirstName: null,
  partnerLastName: null,
  kids: null,
  email: "ada@example.test",
  addressLine1: "12 St James's Square",
  city: "London",
  stateRegion: null,
  postalCode: "SW1Y 4JH",
  country: "United Kingdom",
  sendStatus: "delivered",
  updatedAfterSend: false,
  updatedAt: new Date("2026-10-01T12:00:00Z"),
};

describe("toSheetRow", () => {
  it("turns nulls into empty strings", () => {
    const row = toSheetRow(listRow, () => "Oct 1, 2026");
    expect(row.values.state_region).toBe("");
    expect(row.values.postal_code).toBe("SW1Y 4JH");
    expect(row.updatedAtIso).toBe("2026-10-01T12:00:00.000Z");
    expect(row.updatedAtLabel).toBe("Oct 1, 2026");
  });

  it("shows a recipient update over the delivery status", () => {
    expect(toSheetRow(listRow, String).status).toBe("delivered");
    expect(
      toSheetRow({ ...listRow, updatedAfterSend: true }, String).status,
    ).toBe("updated");
  });
});

describe("changedValues", () => {
  it("keeps only the draft fields that differ from the row", () => {
    const { values } = toSheetRow(listRow, String);
    expect(
      changedValues(values, {
        city: "Paris",
        country: "United Kingdom",
        state_region: "",
      }),
    ).toEqual({ city: "Paris" });
    expect(changedValues(values, { email: "" })).toEqual({ email: "" });
    expect(changedValues(values, {})).toEqual({});
  });
});

describe("moveCursor", () => {
  it("moves and clamps to the row range", () => {
    expect(moveCursor("ArrowDown", 0, 3)).toBe(1);
    expect(moveCursor("ArrowDown", 2, 3)).toBe(2);
    expect(moveCursor("ArrowUp", 0, 3)).toBe(0);
    expect(moveCursor("End", 0, 3)).toBe(2);
    expect(moveCursor("Home", 2, 3)).toBe(0);
    expect(moveCursor("PageDown", 0, 25)).toBe(10);
    expect(moveCursor("PageUp", 4, 25)).toBe(0);
  });

  it("returns -1 when there are no rows", () => {
    expect(moveCursor("ArrowDown", 0, 0)).toBe(-1);
  });
});

describe("parseStoredLayout", () => {
  it("drops columns the sheet no longer has", () => {
    expect(
      parseStoredLayout(
        JSON.stringify({
          columnVisibility: { partner_name: false, city: false },
          columnSizing: { partner_name: 120, full_name: 200 },
        }),
        { columnIds: ["full_name", "city"] },
      ),
    ).toEqual({
      columnVisibility: { city: false },
      columnSizing: { full_name: 200 },
    });
  });

  it("returns a well-formed layout", () => {
    expect(
      parseStoredLayout(
        JSON.stringify({
          columnVisibility: { city: false },
          columnSizing: { city: 140 },
        }),
      ),
    ).toEqual({
      columnVisibility: { city: false },
      columnSizing: { city: 140 },
    });
  });

  it("drops malformed parts instead of throwing", () => {
    expect(parseStoredLayout(null)).toEqual({});
    expect(parseStoredLayout("{not json")).toEqual({});
    expect(parseStoredLayout('"text"')).toEqual({});
    expect(
      parseStoredLayout(
        JSON.stringify({
          columnVisibility: { city: "no" },
          columnSizing: { city: -5 },
        }),
      ),
    ).toEqual({ columnVisibility: undefined, columnSizing: undefined });
  });
});

describe("STATUS_RANK", () => {
  it("puts delivery problems first and updates last", () => {
    const keys = Object.keys(STATUS_RANK) as StatusKey[];
    expect(keys.sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])).toEqual([
      "bounced",
      "complained",
      "none",
      "sent",
      "delivered",
      "opened",
      "updated",
    ]);
  });
});

const holloway: ContactListRow = {
  ...listRow,
  fullName: "Jen Holloway",
  partnerName: "Mark Holloway",
  kidsNames: "Zoe, Max",
  firstName: "Jen",
  lastName: "Holloway",
  partnerFirstName: "Mark",
  partnerLastName: "Holloway",
  kids: [{ first: "Zoe" }, { first: "Max", last: "Holloway" }],
};

describe("sheetName", () => {
  it("summarizes the household for the Name cell", () => {
    expect(sheetName(toSheetRow(holloway, String).names)).toEqual({
      line: "Jen & Mark Holloway",
      kids: "2 kids",
      split: true,
    });
    expect(sheetName(toSheetRow(listRow, String).names)).toEqual({
      line: "Ada Lovelace",
      kids: null,
      split: false,
    });
  });
});

describe("namesFromValues", () => {
  it("derives the stored names, dropping blank kids and blank last names", () => {
    expect(
      namesFromValues({
        first_name: " Jen ",
        last_name: "Holloway",
        partner: { first: "Mark", last: "" },
        kids: [
          { first: "", last: "Holloway" },
          { first: "Zoe", last: "" },
          { first: "Max", last: "Jones" },
        ],
      }),
    ).toEqual({
      fullName: "Jen Holloway",
      partnerName: "Mark",
      kidsNames: "Zoe, Max Jones",
      firstName: "Jen",
      lastName: "Holloway",
      partnerFirstName: "Mark",
      partnerLastName: null,
      kids: [{ first: "Zoe" }, { first: "Max", last: "Jones" }],
    });
  });

  it("has no partner or kids when none are given", () => {
    expect(
      namesFromValues({ first_name: "Jen", last_name: "Holloway", partner: null, kids: [] }),
    ).toMatchObject({ partnerName: null, partnerFirstName: null, kids: null, kidsNames: null });
  });
});

describe("household drafts", () => {
  it("round-trips a stored household with following last names", () => {
    const draft = draftFromNames(holloway);
    expect(draft.kids.map((kid) => kid.lastEdited)).toEqual([false, false]);
    expect(draftToValues({ ...draft, last_name: "Holloway-Ng" })).toEqual({
      first_name: "Jen",
      last_name: "Holloway-Ng",
      partner: { first: "Mark", last: "Holloway-Ng" },
      kids: [
        { first: "Zoe", last: "Holloway-Ng" },
        { first: "Max", last: "Holloway-Ng" },
      ],
    });
  });

  it("keeps an edited last name", () => {
    const draft: HouseholdDraft = {
      first_name: "Priya",
      last_name: "Raman",
      partner: { first: "Daniel", last: "Okafor", lastEdited: true },
      kids: [{ first: "Asha", last: "Okafor", lastEdited: true }],
    };
    expect(draftToValues(draft).kids).toEqual([{ first: "Asha", last: "Okafor" }]);
  });

  it("is unedited until it differs from a split contact's names", () => {
    expect(householdEdited(holloway, draftFromNames(holloway))).toBe(false);
    const draft = draftFromNames(holloway);
    expect(
      householdEdited(holloway, { ...draft, kids: draft.kids.slice(0, 1) }),
    ).toBe(true);
    expect(householdEdited(listRow, draftFromNames(listRow))).toBe(true);
  });

  it("builds the patch the server validates", () => {
    expect(
      householdPatchInput({
        first_name: "Jen",
        last_name: "Holloway",
        partner: null,
        kids: [],
      }),
    ).toEqual({ first_name: "Jen", last_name: "Holloway" });
    expect(
      householdPatchInput({
        first_name: "Jen",
        last_name: "Holloway",
        partner: { first: "Mark", last: "" },
        kids: [{ first: "Zoe", last: "Holloway" }],
      }),
    ).toEqual({
      first_name: "Jen",
      last_name: "Holloway",
      partner_first_name: "Mark",
      partner_last_name: "",
      kids: [{ first: "Zoe", last: "Holloway" }],
    });
  });

  it("reports missing required names by field", () => {
    expect(
      validateHousehold({
        first_name: "Cher",
        last_name: " ",
        partner: { first: "", last: "" },
        kids: [{ first: "Zoe", last: "" }],
      }),
    ).toEqual({
      ok: false,
      errors: {
        partner_first_name: "Add a first name, or remove this row.",
      },
    });
    expect(
      validateHousehold({ first_name: "Cher", last_name: "Sarkisian", partner: null, kids: [] }),
    ).toMatchObject({ ok: true });
  });
});
