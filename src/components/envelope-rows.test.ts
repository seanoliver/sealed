import { describe, expect, it } from "vitest";
import { envelopeSlots, formatEnvelope } from "@/lib/address/format";
import { getCountry } from "@/lib/address/countries";
import { envelopeRows, openRowIndex, streetLine } from "./envelope-rows";

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

  it("keeps partial lines visible when no street prints an envelope", () => {
    const rows = envelopeRows({
      envelope: null,
      name: "Cora",
      slots: [{ tokens: ["A"], at: 1 }],
      partial: [{ text: "London", uppercased: false, tokens: ["C", "S", "Z"], at: 2 }],
    });
    expect(rows.map((row) => row.kind)).toEqual(["line", "slot", "line"]);
    expect(rows[2]).toMatchObject({ kind: "line", text: "London", tokens: ["C", "S", "Z"] });
  });

  it("puts out-of-order slots and the open row in print order", () => {
    const rows = envelopeRows(
      {
        envelope: null,
        name: "Cora",
        slots: [
          { tokens: ["Z"], at: 4 },
          { tokens: ["A"], at: 2 },
        ],
      },
      { tokens: ["C"], at: 3, slot: true },
    );
    expect(rows.map((row) => row.at)).toEqual([0, 2, 3, 4]);
    expect(rows.map((row) => row.tokens[0])).toEqual(["N", "A", "C", "Z"]);
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
    const open = { tokens: street[0].tokens, at: street[0].at };
    expect(street.every((row) => row.at === open.at)).toBe(true);
    expect(openRowIndex(rows, open)).toBe(rows.indexOf(street[0]));
  });

  it("never opens the names row for an address line", () => {
    const rows = envelopeRows({ envelope: null, name: "Cora", slots: [{ tokens: ["C"], at: 0 }] });
    expect(rows[openRowIndex(rows, { tokens: ["C"], at: 0 })]).toEqual({ kind: "slot", tokens: ["C"], at: 0 });
  });

  it("finds the open street on the street's row after a country change moves it", () => {
    const hungary = { ...blank, countryCode: "HU" };
    const rows = envelopeRows({
      envelope: null,
      name: "Hana",
      slots: envelopeSlots(hungary, { senderCountry: "US" }),
    });
    // A street opened in the US layout, where it sits at line 2; Hungary prints the city there.
    const open = { tokens: ["A" as const], at: 2, slot: true };
    expect(rows[openRowIndex(rows, open)]).toEqual({ kind: "slot", tokens: ["A"], at: 3 });
    expect(envelopeRows({ envelope: null, name: "Hana", slots: envelopeSlots(hungary, { senderCountry: "US" }) }, open)).toEqual(rows);
  });
});

describe("streetLine", () => {
  it("is the line the country prints the street on, with whatever shares it", () => {
    expect(streetLine(getCountry("US"))).toEqual({ tokens: ["A"], at: 2 });
    expect(streetLine(getCountry("HU"))).toEqual({ tokens: ["A"], at: 3 });
    expect(streetLine(getCountry("GN"))).toEqual({ tokens: ["Z", "A", "C"], at: 2 });
    expect(streetLine(getCountry("JP")).tokens).toEqual(["A", "S"]);
    expect(streetLine(null)).toEqual({ tokens: ["A"], at: 0 });
  });
});
