import { describe, expect, it } from "vitest";
import type { ContactListRow } from "@/lib/queries/contacts";
import {
  changedValues,
  moveCursor,
  parseStoredLayout,
  STATUS_RANK,
  toSheetRow,
  type StatusKey,
} from "./contacts-sheet";

const listRow: ContactListRow = {
  id: "00000000-0000-0000-0000-000000000001",
  fullName: "Ada Lovelace",
  partnerName: null,
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
    expect(row.values.partner_name).toBe("");
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
        partner_name: "",
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
