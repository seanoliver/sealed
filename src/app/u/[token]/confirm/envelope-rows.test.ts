import { describe, expect, it } from "vitest";
import { envelopeSlots, formatEnvelope } from "@/lib/address/format";
import { envelopeRows, openRowIndex } from "./envelope-rows";

const blank = {
  addressLine1: "",
  addressLine2: "",
  district: "",
  city: "",
  stateRegion: "",
  postalCode: "",
  countryCode: null,
  legacyCountry: null,
};

describe("envelopeRows", () => {
  it("keeps a row for the open street after line 1 is cleared while line 2 is set", () => {
    const address = { ...blank, addressLine2: "Apt 4B", city: "Portland", stateRegion: "OR", postalCode: "97214", countryCode: "US" };
    const preview = {
      envelope: formatEnvelope(address, { name: "Cora Confirm", senderCountry: "US" }),
      name: "Cora Confirm",
      slots: envelopeSlots(address, { senderCountry: "US" }),
    };
    expect(preview.envelope).toBeNull();
    const open = { tokens: ["A" as const], at: 2, slot: false };
    const rows = envelopeRows(preview, open);
    expect(openRowIndex(rows, open)).not.toBe(-1);
    expect(rows[openRowIndex(rows, open)]).toEqual({ kind: "slot", tokens: ["A"], at: 2 });
  });

  it("adds no row when nothing is open", () => {
    const rows = envelopeRows({ envelope: null, name: "Cora", slots: [] });
    expect(rows).toEqual([{ kind: "line", text: "Cora", tokens: ["N"], at: 0, uppercased: false }]);
  });
});

describe("openRowIndex", () => {
  it("opens only the first of a local-script street's rows", () => {
    const address = {
      ...blank,
      addressLine1: "千代田1-1",
      addressLine2: "101号室",
      city: "千代田区",
      stateRegion: "東京都",
      postalCode: "100-0001",
      countryCode: "JP",
    };
    const envelope = formatEnvelope(address, { name: "山田太郎", senderCountry: "JP" });
    expect(envelope?.local).toBe(true);
    const rows = envelopeRows({ envelope, name: "山田太郎", slots: [] });
    const street = rows.filter((row) => row.tokens.includes("A"));
    expect(street.length).toBeGreaterThan(1);
    const open = { at: street[0].at };
    expect(street.every((row) => row.at === open.at)).toBe(true);
    expect(openRowIndex(rows, open)).toBe(rows.indexOf(street[0]));
  });

  it("never opens the names row for an address line", () => {
    const rows = envelopeRows({ envelope: null, name: "Cora", slots: [{ tokens: ["A"], at: 0 }] });
    expect(rows[openRowIndex(rows, { at: 0 })]).toEqual({ kind: "slot", tokens: ["A"], at: 0 });
  });
});
